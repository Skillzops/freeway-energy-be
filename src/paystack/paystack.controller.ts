import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaystackService } from './paystack.service';
import { Request } from 'express';
import { Logger } from '@nestjs/common';

@ApiTags('Paystack')
@Controller('payment/webhook')
export class PaystackController {
  private readonly logger = new Logger(PaystackController.name);

  constructor(
    private readonly paystackService: PaystackService,
    @InjectQueue('payment-queue') private readonly paymentQueue: Queue,
  ) {}

  @Post('paystack')
  @ApiOperation({ summary: 'Paystack payment webhook' })
  @ApiHeader({
    name: 'x-paystack-signature',
    description: 'Paystack webhook signature',
    required: true,
  })
  @ApiResponse({ status: 200 })
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: Request & { rawBody?: string },
    @Body() payload: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const event = payload?.event;
    const reference = payload?.data?.reference;
    this.logger.log(
      `[PAYSTACK_WEBHOOK] Incoming webhook event=${event || 'unknown'} reference=${reference || 'unknown'}`,
    );

    const rawBody = req.rawBody || JSON.stringify(payload);
    const isValid = this.paystackService.verifyWebhookSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.warn(
        `[PAYSTACK_WEBHOOK] Invalid signature event=${event || 'unknown'} reference=${reference || 'unknown'} signature_present=${Boolean(signature)}`,
      );
      return {
        status: 'failed',
        message: 'Invalid webhook signature',
      };
    }

    await this.paymentQueue.waitUntilReady();
    const job = await this.paymentQueue.add(
      'process-paystack-webhook',
      { payload },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
        delay: 1000,
      },
    );

    this.logger.log(
      `[PAYSTACK_WEBHOOK] Queued jobId=${job.id} event=${event || 'unknown'} reference=${reference || 'unknown'}`,
    );

    return {
      message: 'Webhook received successfully',
      jobId: job.id,
      status: 'processing',
    };
  }
}
