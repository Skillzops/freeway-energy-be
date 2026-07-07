import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { PaymentService } from './payment.service';

interface PaymentJobData {
  tx_ref?: string;
  transaction_id?: number;
  paymentData?: any;
  payload?: any;
}

@Processor('payment-queue')
export class PaymentProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(private readonly paymentService: PaymentService) {
    super();
  }

  async process(job: Job<PaymentJobData>) {
    this.logger.log(`Processing job id=${job.id} name=${job.name}`);

    try {
      switch (job.name) {
        case 'verify-payment':
          return await this.processPaymentVerification(job);

        case 'process-next-payment':
          return await this.processNextPayment(job);

        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { processed: false, error: 'Unknown job type' };
      }
    } catch (error) {
      this.logger.error(`Job ${job.name} (${job.id}) failed: ${error.message}`);
      throw error;
    }
  }

  private async processPaymentVerification(job: Job<PaymentJobData>) {
    const { tx_ref, transaction_id } = job.data;
    const normalizedRef = tx_ref?.trim();

    if (!normalizedRef || normalizedRef === 'undefined') {
      throw new UnrecoverableError(
        'Payment verification skipped: missing or invalid tx_ref in job data',
      );
    }

    try {
      const result =
        transaction_id && transaction_id > 0
          ? await this.paymentService.verifyPaymentManually(
              normalizedRef,
              transaction_id,
            )
          : await this.paymentService.verifyPaymentManually(normalizedRef);

      return { success: true, tx_ref: normalizedRef, result };
    } catch (error) {
      this.logger.error(
        `verify-payment failed ref=${normalizedRef}: ${error.message}`,
      );
      throw error;
    }
  }

  private async processNextPayment(job: Job<PaymentJobData>) {
    const { paymentData } = job.data;

    await this.paymentService.handlePostPayment(paymentData);
    return { success: true, paymentId: paymentData.id };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job completed name=${job.name} id=${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job failed name=${job.name} id=${job.id}: ${err.message}`);
  }
}
