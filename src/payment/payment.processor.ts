import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PaymentService } from './payment.service';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway, PaymentStatus } from '@prisma/client';
import { OgaranyaService } from '../ogaranya/ogaranya.service';

interface PaymentJobData {
  tx_ref?: string;
  transaction_id?: number;
  paymentData?: any;
  payload?: any;
}

@Processor('payment-queue')
export class PaymentProcessor extends WorkerHost {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly ogaranyaService: OgaranyaService,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<PaymentJobData>) {
    console.log(`[PROCESSOR] Processing job: ${job.id}, type: ${job.name}`);

    try {
      switch (job.name) {
        case 'verify-payment':
          return await this.processPaymentVerification(job);

        case 'process-next-payment':
          return await this.processNextPayment(job);

        // case 'process-ogaranya-webhook':
        //   return await this.processOgaranyaWebhook(job);

        case 'process-flutterwave-webhook':
          return await this.processFlutterwaveWebhook(job);
        case 'process-paystack-webhook':
          return await this.processPaystackWebhook(job);

        default:
          console.warn(`[PROCESSOR] Unknown job type: ${job.name}`);
          return { processed: false, error: 'Unknown job type' };
      }
    } catch (error) {
      console.error(`[PROCESSOR] Job ${job.name} failed:`, error.message);
      throw error; // Rethrow to trigger retry
    }
  }

  private async processPaymentVerification(job: Job<PaymentJobData>) {
    const { tx_ref, transaction_id = 0 } = job.data;
    console.log(`[PROCESSOR] Processing payment verification: ${tx_ref}`);

    try {
      const result =
        transaction_id && transaction_id > 0
          ? await this.paymentService.verifyPaymentManually(
              tx_ref,
              transaction_id,
            )
          : await this.paymentService.verifyPaymentManually(tx_ref);
          
      console.log(`[PROCESSOR] Payment verified: ${tx_ref}`, result);
      return { success: true, tx_ref, result };
    } catch (error) {
      console.error(`[PROCESSOR] Payment verification error: ${error.message}`);
      throw error;
    }
  }

  private async processNextPayment(job: Job<PaymentJobData>) {
    const { paymentData } = job.data;
    console.log(`[PROCESSOR] Processing cash payment:`, paymentData);

    try {
      await this.paymentService.handlePostPayment(paymentData);
      console.log(`[PROCESSOR] Cash payment processed successfully`);
      return { success: true, paymentId: paymentData.id };
    } catch (error) {
      console.error(`[PROCESSOR] Cash payment error: ${error.message}`);
      throw error;
    }
  }

  // private async processOgaranyaWebhook(job: Job<PaymentJobData>) {
  //   const { payload } = job.data;
  //   console.log(`[PROCESSOR] Processing Ogaranya webhook:`, payload);

  //   try {
  //     const result =
  //       await this.ogaranyaService.handlePaymentWebhook(payload);
  //     console.log(
  //       `[PROCESSOR] Ogaranya webhook processed successfully:`,
  //       result,
  //     );
  //     return { success: true, result };
  //   } catch (error) {
  //     console.error(`[PROCESSOR] Ogaranya webhook error: ${error.message}`);
  //     // For webhooks, we might want to handle some errors gracefully
  //     if (error.message.includes('not found')) {
  //       console.warn(`[PROCESSOR] Payment not found, marking as processed`);
  //       return { success: false, error: error.message, skipRetry: true };
  //     }
  //     throw error;
  //   }
  // }

  private async processFlutterwaveWebhook(job: Job<PaymentJobData>) {
    const { payload } = job.data;
    console.log(`[PROCESSOR] Processing Flutterwave webhook:`, payload);

    try {
      const result = await this.handleFlutterwaveWebhookPayload(payload);
      console.log(
        `[PROCESSOR] Flutterwave webhook processed successfully:`,
        result,
      );
      return { success: true, result };
    } catch (error) {
      console.error(`[PROCESSOR] Flutterwave webhook error: ${error.message}`);
      // For webhooks, we might want to handle some errors gracefully
      if (error.message.includes('not found')) {
        console.warn(`[PROCESSOR] Payment not found, marking as processed`);
        return { success: false, error: error.message, skipRetry: true };
      }
      throw error;
    }
  }

  private async processPaystackWebhook(job: Job<PaymentJobData>) {
    const { payload } = job.data;
    const { event, data } = payload || {};

    if (event !== 'charge.success') {
      return { message: 'Event ignored', event };
    }

    const reference = data?.reference;
    if (!reference) {
      throw new Error('Missing transaction reference in Paystack webhook');
    }

    const existingResponses = await this.prisma.paymentResponses.findMany({
      where: {
        data: {
          not: null,
        },
      },
    });

    const duplicate = existingResponses.find((response) => {
      const responseData = response.data as Record<string, any>;
      return responseData?.data?.reference === reference;
    });
    if (duplicate) {
      return { message: 'Webhook already processed', duplicate: true, reference };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: reference },
      include: { sale: true },
    });

    if (!payment) {
      const walletTransaction = await this.prisma.walletTransaction.findFirst({
        where: { reference },
      });

      if (walletTransaction) {
        if (walletTransaction.status !== 'COMPLETED') {
          await this.prisma.walletTransaction.update({
            where: { id: walletTransaction.id },
            data: { status: 'COMPLETED', updatedAt: new Date() },
          });

          await this.prisma.wallet.update({
            where: { agentId: walletTransaction.agentId },
            data: {
              balance: { increment: walletTransaction.amount },
            },
          });
        }
        return { message: 'Wallet top-up processed successfully', reference };
      }

      throw new Error(`Payment with reference ${reference} not found`);
    }

    if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
          updatedAt: new Date(),
        },
      });

      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: {
            ...payload,
            gateway: PaymentGateway.PAYSTACK,
          },
        },
      });

      await this.paymentService.handlePostPayment(updatedPayment);
    }

    return { message: 'Payment processed successfully', reference };
  }

  private async handleFlutterwaveWebhookPayload(payload: any) {
    const { event, data } = payload;

    if (event !== 'charge.completed') {
      console.log(`[PROCESSOR] Ignoring Flutterwave event: ${event}`);
      return { message: 'Event ignored', event };
    }

    const { tx_ref, status, transaction_id } = data;

    if (!tx_ref) {
      throw new Error('Missing transaction reference in Flutterwave webhook');
    }

    // Check if this webhook has already been processed

    const allResponses = await this.prisma.paymentResponses.findMany({
      where: {
        data: {
          not: null,
        },
      },
    });

    const existingResponse = allResponses.find((response) => {
      const data = response.data;

      return (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        'transaction_id' in data &&
        (data as any).transaction_id === transaction_id
      );
    });

    if (existingResponse) {
      return {
        message: 'Webhook already processed',
        duplicate: true,
        transactionId: transaction_id,
      };
    }

    // Find payment by transaction reference
    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: tx_ref },
      include: { sale: true },
    });

    if (!payment) {
      // Check if it's a wallet top-up
      const walletTransaction = await this.prisma.walletTransaction.findFirst({
        where: { reference: tx_ref },
      });

      if (walletTransaction) {
        return this.handleFlutterwaveWalletTopUp(walletTransaction, payload);
      }

      throw new Error(`Payment with reference ${tx_ref} not found`);
    }

    // Process payment based on status
    if (status === 'successful') {
      if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
        // Update payment status
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            paymentStatus: PaymentStatus.COMPLETED,
            flutterwaveTransactionId: transaction_id.toString(),
            updatedAt: new Date(),
          },
        });

        // Store webhook response
        await this.prisma.paymentResponses.create({
          data: {
            paymentId: payment.id,
            data: payload,
          },
        });

        // Process post-payment actions
        await this.paymentService.handlePostPayment(updatedPayment);

        return {
          message: 'Payment processed successfully',
          saleId: payment.sale.id,
          transactionId: transaction_id,
        };
      } else {
        return {
          message: 'Payment already completed',
          saleId: payment.sale.id,
          transactionId: transaction_id,
        };
      }
    } else {
      // Handle failed payment
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          flutterwaveTransactionId: transaction_id.toString(),
          updatedAt: new Date(),
        },
      });

      // Store webhook response
      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: payload,
        },
      });

      throw new Error(`Payment failed with status: ${status}`);
    }
  }

  private async handleFlutterwaveWalletTopUp(
    walletTransaction: any,
    payload: any,
  ) {
    const { data } = payload;
    const { status, transaction_id } = data;

    if (status === 'successful') {
      if (walletTransaction.status !== 'COMPLETED') {
        // Update wallet transaction
        await this.prisma.walletTransaction.update({
          where: { id: walletTransaction.id },
          data: {
            status: 'COMPLETED',
            updatedAt: new Date(),
          },
        });

        // Update wallet balance
        await this.prisma.wallet.update({
          where: { agentId: walletTransaction.agentId },
          data: {
            balance: {
              increment: walletTransaction.amount,
            },
          },
        });

        return {
          message: 'Wallet top-up processed successfully',
          agentId: walletTransaction.agentId,
          amount: walletTransaction.amount,
          transactionId: transaction_id,
        };
      } else {
        return {
          message: 'Wallet top-up already completed',
          agentId: walletTransaction.agentId,
          transactionId: transaction_id,
        };
      }
    } else {
      // Handle failed top-up
      await this.prisma.walletTransaction.update({
        where: { id: walletTransaction.id },
        data: {
          status: 'FAILED',
          updatedAt: new Date(),
        },
      });

      throw new Error(`Wallet top-up failed with status: ${status}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`✅ Payment Queue Job Completed: ${job.name} (${job.id})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    console.error(
      `❌ Payment Queue Job Failed: ${job.name} (${job.id})`,
      err.message,
    );
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number) {
    console.log(
      `🔄 Payment Queue Job Progress: ${job.name} (${job.id}) - ${progress}%`,
    );
  }
}
