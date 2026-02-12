import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TermiiService } from '../termii/termii.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly termiiService: TermiiService,
  ) {}

  private async getEligibleSales(daysBeforeReminder: number) {
    const startTime = Date.now();

    /**
     * LOGIC:
     * If monthly cycle = 30 days.
     * To be "due" in 30 days, you must have paid 0 days ago (Today).
     * To be "due" in 7 days, you must have paid 23 days ago.
     */
    const daysSinceLastPayment = 30 - daysBeforeReminder;

    // Create a date window for the entire day (00:00:00 to 23:59:59)
    const targetDateStart = new Date();
    targetDateStart.setDate(targetDateStart.getDate() - daysSinceLastPayment);
    targetDateStart.setHours(0, 0, 0, 0);

    const targetDateEnd = new Date();
    targetDateEnd.setDate(targetDateEnd.getDate() - daysSinceLastPayment);
    targetDateEnd.setHours(23, 59, 59, 999);

    const sales = await this.prisma.sales.findMany({
      where: {
        status: { in: ['UNPAID', 'IN_INSTALLMENT'] as any },
        totalInstallmentDuration: { gt: 0 },
        // Only fetch sales where the LATEST completed payment falls in our window
        payment: {
          some: {
            paymentStatus: PaymentStatus.COMPLETED,
            paymentDate: {
              gte: targetDateStart,
              lte: targetDateEnd,
            },
          },
        },
      },
      select: {
        id: true,
        customerId: true,
        totalMonthlyPayment: true,
        customer: {
          select: {
            firstname: true,
            lastname: true,
            phone: true,
          },
        },
        saleItems: {
          select: {
            devices: {
              select: {
                serialNumber: true,
              },
              take: 1, // Just get the first device
            },
          },
          take: 1, // Just get the first item
        },
        payment: {
          where: { paymentStatus: PaymentStatus.COMPLETED },
          orderBy: { paymentDate: 'desc' },
          take: 1,
        },
      },
    });

    const queryTime = Date.now() - startTime;
    this.logger.log(
      `✓ Query took ${queryTime}ms. Found ${sales.length} sales for ${daysBeforeReminder}-day reminder. (Window: ${targetDateStart.toISOString()} to ${targetDateEnd.toISOString()})`,
    );

    return sales.map((sale) => {
      const deviceSerial =
        sale.saleItems?.[0]?.devices?.[0]?.serialNumber || 'SR27/SR...';

      return {
        id: sale.id,
        customerName: `${sale.customer.firstname} ${sale.customer.lastname}`,
        customerPhone: sale.customer.phone,
        totalMonthlyPayment: sale.totalMonthlyPayment,
        lastPaymentDate: sale.payment[0]?.paymentDate,
        deviceSerial: deviceSerial,
      };
    });
  }

  /**
   * Main cron handler
   */
  async sendRenewalReminders() {
    this.logger.log('🔔 Starting renewal reminder job...');
    try {
      // Check for people due in 7 days, 3 days, etc.
      const thresholds = [7, 3];

      for (const days of thresholds) {
        await this.processReminders(days);
      }

      this.logger.log('✅ Renewal reminder job completed');
    } catch (error) {
      this.logger.error('❌ Renewal reminder job failed:', error);
    }
  }


  private async processReminders(daysBeforeReminder: number) {
    const eligibleSales = await this.getEligibleSales(daysBeforeReminder);

    for (const sale of eligibleSales) {
      try {
        const message = this.formatReminderSms(
          sale.customerName,
          daysBeforeReminder,
          sale.totalMonthlyPayment,
          sale.deviceSerial,
        );

        await this.termiiService.sendSms({
          to: sale.customerPhone,
          message,
        });

        this.logger.log(
          `✓ SMS sent to ${sale.customerPhone} for ${daysBeforeReminder}-day reminder`,
        );
      } catch (err) {
        this.logger.error(`✗ Failed for sale ${sale.id}: ${err.message}`);
      }
    }
  }

  /**
   * Format renewal reminder SMS
   */
  private formatReminderSms(
    name: string,
    days: number,
    amount: number,
    deviceSerial: string,
  ): string {
    const timing = days === 0 ? 'today' : `in ${days} days`;

    return (
      `Hello ${name},\n\n` +
      `Your solar installment payment for device ${deviceSerial}  is due ${timing}.\n\n` +
      `Amount: ₦${amount.toLocaleString()}.\n\n` +
      `Please renew to avoid service interruption.\n\n` +
      `Thank you.`
    );
  }
}
