import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SalesStatus, PaymentStatus, TaskStatus } from '@prisma/client';
import { WalletService } from '../wallet/wallet.service';
import { DeviceAssignmentService } from 'src/device/services/device-assignment.service';

@Injectable()
export class SaleReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly deviceAssignmentService: DeviceAssignmentService,
  ) {}

  async undoSaleCreation(
    saleId: string,
    performedBy: string,
  ) {
    const details: string[] = [];

    // Step 1: Fetch sale with all related data
    const sale = await this.prisma.sales.findUnique({
      where: { id: saleId },
      include: {
        saleItems: {
          include: {
            devices: { select: { id: true, serialNumber: true } },
          },
        },
        batchAllocations: true,
        payment: true,
        installerTasks: true,
      },
    });

    if (!sale) {
      throw new NotFoundException(`Sale ${saleId} not found`);
    }

    // Step 2: Validate sale can be reversed
    this.validateSaleCanBeReversed(sale);

    let inventoryRestored = 0;
    let walletCredited = 0;
    let devicesUnassigned = 0;
    // let paymentsReversed = 0;

    // Step 3: Execute reversals in atomic transaction
    await this.prisma.$transaction(
      async (tx) => {
        // REVERSAL 1: Restore inventory batches
        inventoryRestored = await this.restoreInventoryBatches(
          sale,
          tx,
          details,
        );

        // REVERSAL 2: Restore agent wallet
        const walletRestoreAmount = await this.restoreAgentWallet(
          sale,
          tx,
          details,
        );
        walletCredited = walletRestoreAmount;

        // REVERSAL 3: Unassign devices
        devicesUnassigned = await this.unassignDevices(
          sale,
          performedBy,
          details,
        );

        // REVERSAL 4: Reverse payments
        //   paymentsReversed = await this.reversePayments(
        //     sale,
        //     tx,
        //     performedBy,
        //     reason,
        //     details,
        //   );

        // REVERSAL 5: Cancel installer task
        if (sale.installerTasks && sale.installerTasks.length > 0) {
          for (const task of sale.installerTasks) {
            await tx.installerTask.update({
              where: { id: task.id },
              data: {
                status: TaskStatus.CANCELLED,
              },
            });
            details.push(`Installer task ${task.id} cancelled`);
          }
        }

        await tx.sales.delete({
          where: { id: saleId },
        });

        details.push(`Sale ${sale.formattedSaleId} marked as CANCELLED`);
      },
      { timeout: 30000 },
    );

    return {
      success: true,
      saleId,
      message: `Sale ${sale.formattedSaleId} successfully reversed`,
      reversals: {
        inventoryRestored,
        walletCredited,
        devicesUnassigned,
        // paymentsReversed,
      },
      details,
    };
  }


  // This can be customised based on requirements/future needs 
  private validateSaleCanBeReversed(sale: any): void {
    // Check if already cancelled
    if (sale.status === SalesStatus.CANCELLED) {
      throw new BadRequestException(
        `Sale ${sale.formattedSaleId} is already cancelled`,
      );
    }

    // Check if completed/delivered (optional - can make this configurable)
    if (sale.status === SalesStatus.COMPLETED) {
      throw new BadRequestException(
        `Cannot reverse completed sale ${sale.formattedSaleId}. ` +
          `This sale has been fully delivered and paid.`,
      );
    }

    // Check if partially paid with multiple payments (risky to reverse)
    if (sale.payment && sale.payment.length > 1) {
      const completedPayments = sale.payment.filter(
        (p: any) => p.paymentStatus === PaymentStatus.COMPLETED,
      );
      if (completedPayments.length > 1) {
        throw new BadRequestException(
          `Cannot reverse sale with multiple completed payments. ` +
            `Please contact support for manual reversal.`,
        );
      }
    }
  }

  private async restoreInventoryBatches(
    sale: any,
    tx: any,
    details: string[],
  ): Promise<number> {
    let restoredCount = 0;

    for (const batchAllocation of sale.batchAllocations) {
      await tx.inventoryBatch.update({
        where: { id: batchAllocation.inventoryBatchId },
        data: {
          remainingQuantity: {
            increment: batchAllocation.quantity,
          },
        },
      });

      restoredCount += batchAllocation.quantity;
      details.push(
        `Inventory batch restored: +${batchAllocation.quantity} units (Batch: ${batchAllocation.inventoryBatchId})`,
      );
    }

    return restoredCount;
  }

  private async restoreAgentWallet(
    sale: any,
    tx: any,
    details: string[],
  ): Promise<number> {
    // Get agent from creator user
    const creator = await this.prisma.user.findUnique({
      where: { id: sale.creatorId },
      select: { agentDetails: { select: { id: true } } },
    });

    if (!creator?.agentDetails) {
      // Sale was created by non-agent (customer/admin)
      details.push('Sale created by non-agent user, no wallet to credit');
      return 0;
    }

    const agentId = creator.agentDetails.id;
    const amountToCredit = sale.totalPaid || 0;

    if (amountToCredit > 0) {
       const wallet = await this.prisma.wallet.findFirst({
          where: { agentId },
        });

      // Create wallet reversal entry
      await tx.walletTransaction.create({
        data: {
          agentId,
          walletId: wallet.id,
          amount: amountToCredit,
          type: 'CREDIT',
          status: "COMPLETED",
          reference: `sale-reversal-${sale.id}`,
          description: `Credit: Reversal of sale ${sale.formattedSaleId}`,
          previousBalance: wallet.balance,
          newBalance: wallet.balance + amountToCredit,
        },
      });

      // Update wallet balance
      await tx.wallet.update({
        where: { agentId },
        data: {
          balance: {
            increment: amountToCredit,
          },
        },
      });

      details.push(`Wallet credited: ₦${amountToCredit} to agent ${agentId}`);
    }

    return amountToCredit;
  }

  private async unassignDevices(
    sale: any,
    performedBy: string,
    details: string[],
  ): Promise<number> {
    let unassignedCount = 0;

    // Get all devices from sale items
    const allDevices = sale.saleItems.flatMap((item: any) => item.devices);

    if (allDevices.length === 0) {
      details.push('No devices to unassign');
      return 0;
    }

    for (const device of allDevices) {
      try {
        // Use device assignment service to unassign
        await this.deviceAssignmentService.unassignDevice(
          device.id,
          performedBy,
          `Sale reversal: ${sale.formattedSaleId}`,
        );

        unassignedCount++;
        details.push(`Device unassigned: ${device.serialNumber}`);
      } catch (error) {
        details.push(
          `Failed to unassign device ${device.serialNumber}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    return unassignedCount;
  }

//   private async reversePayments(
//     sale: any,
//     tx: any,
//     performedBy: string,
//     reason: string,
//     details: string[],
//   ): Promise<number> {
//     let reversedCount = 0;

//     if (!sale.payment || sale.payment.length === 0) {
//       details.push('No payments to reverse');
//       return 0;
//     }

//     for (const payment of sale.payment) {
//       // Only reverse completed payments
//       if (payment.paymentStatus === PaymentStatus.COMPLETED) {
//         // Create reversal payment record
        // await tx.payment.create({
        //   data: {
        //     saleId: sale.id,
        //     amount: -payment.amount, // Negative amount indicates reversal
        //     paymentMethod: payment.paymentMethod,
        //     paymentStatus: PaymentStatus.REVERSED,
        //     transactionRef: `reversal-${payment.id}-${Date.now()}`,
        //     reversalOfPaymentId: payment.id,
        //     recordedById: performedBy,
        //     notes: `Reversal of payment ${payment.transactionRef}. Reason: ${reason}`,
        //     paymentDate: new Date(),
        //   },
        // });

//         reversedCount++;
//         details.push(
//           `Payment reversed: ₦${payment.amount} (Ref: ${payment.transactionRef})`,
//         );

//         // Update original payment status
        // await tx.payment.update({
        //   where: { id: payment.id },
        //   data: {
        //     paymentStatus: PaymentStatus.REVERSED,
        //   },
        // });
//       }
//     }

//     return reversedCount;
//   }
}
