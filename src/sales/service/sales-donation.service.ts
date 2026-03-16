import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDonationSaleDto,
  DonationSaleResponseDto,
  BatchDonationResponseDto,
} from '../dto/sales-donation.dto';
import { SalesIdGeneratorService } from './saleid-generator';
import {
  ApprovalStatus,
  CategoryTypes,
  PaymentGateway,
  PaymentMethod,
  SalesStatus,
  InventoryStatus,
  InventoryClass,
  PaymentMode,
  AddressType,
} from '@prisma/client';

@Injectable()
export class SalesDonationService {
  private readonly logger = new Logger(SalesDonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesIdGenerator: SalesIdGeneratorService,
  ) {}

  private async getOrCreateDonationProduct(
    adminUserId: string,
  ): Promise<string> {
    const product = await this.prisma.product.findFirst({
      where: {
        name: 'Donation',
        hideProduct: true,
      },
      select: {
        id: true,
      },
    });

    if (product) {
      this.logger.debug('Using existing Donation product');
      return product.id;
    }

    // Get default category (or create if needed)
    let category = await this.prisma.category.findFirst({
      select: { id: true },
    });

    if (!category) {
      // Create a default category if none exists
      category = await this.prisma.category.create({
        data: {
          name: 'Donation',
          type: 'PRODUCT',
        },
      });
    }

    // Create new Donation product
    const createdProduct = await this.prisma.product.create({
      data: {
        name: 'Donation',
        description: 'Special product for device donations to police stations',
        currency: 'NGN',
        hideProduct: true, // Hidden from regular sales
        creatorId: adminUserId,
        categoryId: category.id,
      },
    });

    this.logger.log(`Created Donation product: ${createdProduct.id}`);
    return createdProduct.id;
  }

  private async getOrCreateDonationInventory(): Promise<string> {
    const inventory = await this.prisma.inventory.findFirst({
      where: {
        name: 'Donation',
        hideInventory: true,
      },
      select: {
        id: true,
      },
    });

    if (inventory) {
      this.logger.debug('Using existing Donation Inventory');
      return inventory.id;
    }

    // Create new Donation Inventory
    const createdInventory = await this.prisma.inventory.create({
      data: {
        name: 'Donation',
        manufacturerName: 'System',
        hideInventory: true, // Hidden from regular inventory
        status: InventoryStatus.IN_STOCK,
        class: InventoryClass.REGULAR,
      },
    });

    this.logger.log(`Created Donation Inventory: ${createdInventory.id}`);
    return createdInventory.id;
  }

  private async getOrCreateProductInventoryLink(
    productId: string,
    inventoryId: string,
  ): Promise<void> {
    const existing = await this.prisma.productInventory.findFirst({
      where: {
        productId,
        inventoryId,
      },
    });

    if (existing) {
      this.logger.debug('ProductInventory link already exists');
      return;
    }

    await this.prisma.productInventory.create({
      data: {
        productId,
        inventoryId,
        quantity: 1, // 1 unit of this inventory = 1 device in donation
      },
    });

    this.logger.log(
      `Created ProductInventory link: ${productId} -> ${inventoryId}`,
    );
  }

  private async getOrCreateDonationBatch(
    inventoryId: string,
    adminUserId: string,
  ): Promise<string> {
    // Try to find existing batch with available stock
    const existingBatch = await this.prisma.inventoryBatch.findFirst({
      where: {
        inventoryId,
        price: 0, // Donation batch has price 0
      },
      select: {
        id: true,
        remainingQuantity: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If batch exists and has available quantity, use it
    if (existingBatch && existingBatch.remainingQuantity > 0) {
      this.logger.debug(`Using existing donation batch: ${existingBatch.id}`);
      return existingBatch.id;
    }

    // Create new batch with large quantity for donations
    const newBatch = await this.prisma.inventoryBatch.create({
      data: {
        inventoryId,
        batchNumber: Date.now() - 100,
        price: 0, // Free
        costOfItem: 0, // No cost
        numberOfStock: 100000, // Large initial quantity
        remainingQuantity: 100000,
        creatorId: adminUserId,
      },
    });

    this.logger.log(`Created donation batch: ${newBatch.id}`);
    return newBatch.id;
  }

  async createDonationSales(
    adminUserId: string,
    dto: CreateDonationSaleDto,
  ): Promise<BatchDonationResponseDto> {
    const startTime = Date.now();

    this.logger.log(`Creating donation sales for ${dto.name}, ${dto.state}`);

    const failedDevices: Array<{
      serialNumber: string;
      agentId: string;
      reason: string;
    }> = [];
    const createdSales: DonationSaleResponseDto[] = [];

    if (!dto.devices || dto.devices.length === 0) {
      throw new BadRequestException('At least one device must be provided');
    }

    const donationProductId =
      await this.getOrCreateDonationProduct(adminUserId);
    const donationInventoryId = await this.getOrCreateDonationInventory();
    await this.getOrCreateProductInventoryLink(
      donationProductId,
      donationInventoryId,
    );
    const donationBatchId = await this.getOrCreateDonationBatch(
      donationInventoryId,
      adminUserId,
    );

    this.logger.log(
      `✅ Product: ${donationProductId}, Inventory: ${donationInventoryId}, Batch: ${donationBatchId}`,
    );

    const [agents, devices] = await Promise.all([
      this.prisma.agent.findMany({
        where: {
          id: { in: dto.devices.map((d) => d.agentId) },
        },
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              firstname: true,
              lastname: true,
            },
          },
        },
      }),

      // Get all devices with their tokens
      this.prisma.device.findMany({
        where: {
          serialNumber: { in: dto.devices.map((d) => d.serialNumber) },
        },
        include: {
          tokens: {
            select: {
              id: true,
              token: true,
            },
          },
        },
      }),
    ]);

    // Create maps for quick lookup
    const agentsMap = new Map(agents.map((a) => [a.id, a]));
    const devicesMap = new Map(devices.map((d) => [d.serialNumber, d]));

    for (const deviceDto of dto.devices) {
      const device = devicesMap.get(deviceDto.serialNumber);

      if (!device) {
        failedDevices.push({
          serialNumber: deviceDto.serialNumber,
          agentId: deviceDto.agentId,
          reason: `Device with serial ${deviceDto.serialNumber} not found`,
        });
        continue;
      }

      const agent = agentsMap.get(deviceDto.agentId);
      if (!agent) {
        failedDevices.push({
          serialNumber: deviceDto.serialNumber,
          agentId: deviceDto.agentId,
          reason: `Agent with ID ${deviceDto.agentId} not found`,
        });
        continue;
      }

      if (device.tokens.length === 0) {
        failedDevices.push({
          serialNumber: deviceDto.serialNumber,
          agentId: deviceDto.agentId,
          reason: `Device has no tokens. Tokens must be pre-generated.`,
        });
        continue;
      }

      const existingSaleItem = await this.prisma.saleItem.findFirst({
        where: {
          deviceIDs: {
            hasSome: [device.id],
          },
          sale: {
            status: {
              not: SalesStatus.CANCELLED,
            },
          },
        },
      });

      if (existingSaleItem) {
        failedDevices.push({
          serialNumber: deviceDto.serialNumber,
          agentId: deviceDto.agentId,
          reason: `Device is already used in a previous sale`,
        });
        continue;
      }
    }

    let customer = await this.prisma.customer.findFirst({
      where: {
        firstname: dto.name,
        isDonationCustomer: true,
      },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          firstname: dto.name,
          lastname: '',
          phone: '08000000000',
          isDonationCustomer: true,
          state: dto.state,
          addressType: AddressType.WORK,
          creatorDetails: {
            connect: { id: adminUserId },
          },
          isApproved: true,
          approvalStatus: ApprovalStatus.APPROVED,
          approver: {
            connect: { id: adminUserId },
          },
          approvedAt: new Date(),
        },
      });

      this.logger.log(
        `Created donation customer: ${customer.id} for ${dto.name}`,
      );
    } else {
      this.logger.log(
        `Using existing donation customer: ${customer.id} for ${dto.name}`,
      );
    }

    for (const deviceDto of dto.devices) {
      const device = devicesMap.get(deviceDto.serialNumber);
      const agent = agentsMap.get(deviceDto.agentId);

      // Skip if validation failed
      if (!device || !agent) continue;

      try {
        const sale = await this.prisma.$transaction(
          async (tx) => {
            // Generate formatted sale ID
            const formattedSaleId =
              await this.salesIdGenerator.generateFormattedSaleId();

            // Create sale with 0 price (donation)
            const createdSale = await tx.sales.create({
              data: {
                customerId: customer.id,
                creatorId: agent.userId, // Agent's user ID (creator of the sale)
                agentId: agent.id,
                agentName: `${agent.user.firstname} ${agent.user.lastname}`,
                formattedSaleId,
                status: SalesStatus.DONATION,
                category: CategoryTypes.PRODUCT,
                totalPrice: 0, // Free
                totalMiscellaneousPrice: 0,
                installmentStartingPrice: 0,
                totalMonthlyPayment: 0,
                totalInstallmentDuration: 0,
                remainingInstallments: 0,
                totalPaid: 0, // Already paid (₦0)
                applyMargin: false,
                paymentMethod: PaymentMethod.NIL,
                paymentGateway: PaymentGateway.NIL,
              },
            });

            // Create batch allocation record
            const batchAllocation = await tx.batchAlocation.create({
              data: {
                salesId: createdSale.id,
                inventoryBatchId: donationBatchId,
                price: 0,
                quantity: 1, // 1 unit (1 device)
              },
            });

            // Create sale item linking device and product
            const saleItem = await tx.saleItem.create({
              data: {
                saleId: createdSale.id,
                productId: donationProductId,
                devices: {
                  connect: [{ id: device.id }],
                },
                quantity: 1,
                totalPrice: 0,
                discount: 0,
                paymentMode: PaymentMode.ONE_OFF,
              },
            });

            // Update batch remaining quantity
            await tx.inventoryBatch.update({
              where: { id: donationBatchId },
              data: {
                remainingQuantity: {
                  decrement: 1,
                },
              },
            });

            return {
              sale: createdSale,
              saleItem,
              device,
              batchAllocation,
            };
          },
          { timeout: 30000 },
        );

        // Format and add to response
        createdSales.push({
          id: sale.sale.id,
          formattedSaleId: sale.sale.formattedSaleId,
          status: SalesStatus.DONATION,
          totalPrice: 0,
          totalPaid: 0,
          customer: {
            id: customer.id,
            firstname: customer.firstname,
            lastname: customer.lastname,
          },
          saleItems: [
            {
              id: sale.saleItem.id,
              deviceSerial: device.serialNumber,
              device: {
                id: device.id,
                serialNumber: device.serialNumber,
              },
            },
          ],
          createdAt: sale.sale.createdAt,
        });

        this.logger.log(
          `✅ Created donation sale ${sale.sale.formattedSaleId} for device ${device.serialNumber}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create sale for device ${deviceDto.serialNumber}:`,
          error,
        );

        failedDevices.push({
          serialNumber: deviceDto.serialNumber,
          agentId: deviceDto.agentId,
          reason: `Error creating sale: ${error.message}`,
        });
      }
    }

    const duration = Date.now() - startTime;

    const response: BatchDonationResponseDto = {
      success: failedDevices.length === 0,
      message:
        failedDevices.length === 0
          ? `All ${createdSales.length} donation sales created successfully`
          : `Created ${createdSales.length} sales with ${failedDevices.length} failures`,
      totalDevices: dto.devices.length,
      createdSales: createdSales.length,
      failedDevices,
      sales: createdSales,
      summary: {
        name: dto.name,
        state: dto.state,
        lga: dto.lga,
        devicesGranted: createdSales.length,
        totalSales: createdSales.length,
        createdAt: new Date(),
      },
    };

    this.logger.log(
      `Completed police donation sales creation in ${duration}ms. Created: ${createdSales.length}, Failed: ${failedDevices.length}`,
    );

    return response;
  }

  /**
   * Get all police donation sales
   */
  async getPoliceDonationSales() {
    const sales = await this.prisma.sales.findMany({
      where: {
        status: SalesStatus.DONATION,
      },
      include: {
        customer: true,
        saleItems: {
          include: {
            devices: {
              include: {
                tokens: true,
              },
            },
          },
        },
        agent: {
          include: {
            user: true,
          },
        },
        batchAllocations: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return sales;
  }
}
