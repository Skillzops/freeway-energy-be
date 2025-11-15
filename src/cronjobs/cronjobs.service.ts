import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// import { Cron, CronExpression } from '@nestjs/schedule';
// import {
//   PaymentStatus,
//   SalesStatus,
//   // WalletTransactionStatus,
// } from '@prisma/client';
import { PaymentService } from '../payment/payment.service';
// import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CronjobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService,
  ) {}

  private readonly logger = new Logger(CronjobsService.name);

  // @Cron(CronExpression.EVERY_6_HOURS, {
  //   name: 'checkUnpaidSales',
  // })
  // async checkUnpaidSales() {
  //   this.logger.log('Running cron job to check unpaid sales...');

  //   const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  //   const unpaidSales = await this.prisma.sales.findMany({
  //     where: { status: SalesStatus.UNPAID, createdAt: { lte: sixHoursAgo } }, // Find records created 6+ hours ago },
  //     include: { saleItems: true, batchAllocations: true },
  //   });

  //   for (const sale of unpaidSales) {
  //     this.logger.log(`Restoring inventory for Sale ID: ${sale.id}`);

  //     if (!sale.batchAllocations.length) {
  //       this.logger.log(`Batch Allocations not found Sale ID: ${sale.id}`);
  //       continue;
  //     }

  //     for (const { inventoryBatchId: id, quantity } of sale.batchAllocations) {
  //       await this.prisma.inventoryBatch.update({
  //         where: { id },
  //         data: {
  //           remainingQuantity: {
  //             increment: quantity,
  //           },
  //         },
  //       });
  //     }

  //     await this.prisma.sales.update({
  //       where: { id: sale.id },
  //       data: { status: SalesStatus.CANCELLED },
  //     });

  //     await this.prisma.payment.update({
  //       where: {
  //         id: sale.id,
  //       },
  //       data: { paymentStatus: PaymentStatus.FAILED },
  //     });

  //     this.logger.log(
  //       `Inventory Restration for Sale ID: ${sale.id} successful`,
  //     );
  //   }
  // }

  // @Cron(CronExpression.EVERY_5_MINUTES)
  // async pollPendingPayments() {
  //   console.log('Polling pending payments...');

  //   // Get pending payments from last 24 hours
  //   const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  //   const pendingPayments = await this.prisma.payment.findMany({
  //     where: {
  //       paymentStatus: PaymentStatus.PENDING,
  //       createdAt: { gte: oneDayAgo },
  //       ogaranyaOrderRef: { not: null },
  //     },
  //     take: 50,
  //   });

  //   for (const payment of pendingPayments) {
  //     try {
  //       await this.paymentService.verifyOgaranyaPayment(
  //         payment.ogaranyaOrderRef,
  //       );
  //       await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between checks
  //     } catch (error) {
  //       console.error(`Failed to verify payment ${payment.id}:`, error);
  //     }
  //   }

  //   // Also poll pending wallet top-ups
  //   const pendingTopUps = await this.prisma.walletTransaction.findMany({
  //     where: {
  //       status: WalletTransactionStatus.PENDING,
  //       createdAt: { gte: oneDayAgo },
  //       ogaranyaOrderRef: { not: null },
  //     },
  //     take: 50,
  //   });

  //   for (const topUp of pendingTopUps) {
  //     try {
  //       await this.paymentService.verifyWalletTopUpManually(topUp.reference);
  //       await new Promise((resolve) => setTimeout(resolve, 1000));
  //     } catch (error) {
  //       console.error(`Failed to verify top-up ${topUp.id}:`, error);
  //     }
  //   }
  // }

  // @Cron(CronExpression.EVERY_DAY_AT_1AM)
  // @Cron(CronExpression.EVERY_10_SECONDS)
  // async flushRedis() {
  //   console.log('Flushing redis...');

  //   const redis = new Redis(this.config.get<string>('REDIS_URL'));
  //   const keys = await redis.keys('bull*');

  //   console.log({keys})
  //   if (keys.length > 0) {
  //     await redis.del();
  //   }

  //   try {
  //     const result = await redis.flushall();
  //     console.log('✅ Redis flushed:', result);
  //   } catch (err) {
  //     console.error('❌ Error flushing Redis:', err);
  //   } finally {
  //     redis.disconnect();
  //   }
  // }
}
