import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaystackService } from './paystack.service';
import { Request } from 'express';
import { Logger } from '@nestjs/common';
import { PaymentService } from 'src/payment/payment.service';

@ApiTags('Paystack')
@Controller('payment/webhook')
export class PaystackController {
  private readonly logger = new Logger(PaystackController.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly paymentService: PaymentService,
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
    const startedAt = Date.now();
    const event = payload?.event;
    const reference = payload?.data?.reference;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.logger.log(
      `[PAYSTACK_WEBHOOK][${requestId}] Incoming webhook event=${event || 'unknown'} reference=${reference || 'unknown'} ip=${req.ip || 'unknown'}`,
    );
    this.logger.debug(
      `[PAYSTACK_WEBHOOK][${requestId}] Headers: content-type=${req.headers?.['content-type'] || 'unknown'} content-length=${req.headers?.['content-length'] || 'unknown'} user-agent=${req.headers?.['user-agent'] || 'unknown'}`,
    );
    this.logger.debug(
      `[PAYSTACK_WEBHOOK][${requestId}] Payload summary: keys=${payload ? Object.keys(payload).join(',') : 'none'} dataKeys=${payload?.data ? Object.keys(payload.data).join(',') : 'none'} status=${payload?.data?.status || 'n/a'} amount=${payload?.data?.amount ?? 'n/a'} currency=${payload?.data?.currency || 'n/a'} channel=${payload?.data?.channel || 'n/a'}`,
    );

    const rawBody = req.rawBody || JSON.stringify(payload);
    this.logger.debug(
      `[PAYSTACK_WEBHOOK][${requestId}] rawBody source=${req.rawBody ? 'req.rawBody' : 'JSON.stringify(payload) fallback'} length=${rawBody?.length ?? 0}`,
    );

    // --- Signature verification ---
    this.logger.log(
      `[PAYSTACK_WEBHOOK][${requestId}] About to verify signature: signature_present=${Boolean(signature)} signature_preview=${signature ? `${signature.slice(0, 6)}...${signature.slice(-6)}` : 'none'} secret_configured=${this.paystackService.isConfigured()}`,
    );

    let isValid = false;
    try {
      isValid = this.paystackService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      this.logger.error(
        `[PAYSTACK_WEBHOOK][${requestId}] Signature verification threw an error: ${error?.message}`,
        error?.stack,
      );
      throw error;
    }

    this.logger.log(
      `[PAYSTACK_WEBHOOK][${requestId}] Signature verification result=${isValid ? 'VALID' : 'INVALID'}`,
    );

    if (!isValid) {
      this.logger.warn(
        `[PAYSTACK_WEBHOOK][${requestId}] Invalid signature event=${event || 'unknown'} reference=${reference || 'unknown'} signature_present=${Boolean(signature)}`,
      );
      return {
        status: 'failed',
        message: 'Invalid webhook signature',
      };
    }

    try {
      this.logger.log(
        `[PAYSTACK_WEBHOOK][${requestId}] Routing to handlePaystackWebhookPayload event=${event || 'unknown'} reference=${reference || 'unknown'}`,
      );
      const result = await this.paymentService.handlePaystackWebhookPayload(payload);
      this.logger.log(
        `[PAYSTACK_WEBHOOK][${requestId}] Processed event=${event || 'unknown'} reference=${reference || 'unknown'} durationMs=${Date.now() - startedAt} result=${JSON.stringify(result)}`,
      );

      return {
        message: 'Webhook received successfully',
        status: 'processed',
        result,
      };
    } catch (error) {
      this.logger.error(
        `[PAYSTACK_WEBHOOK][${requestId}] Processing failed event=${event || 'unknown'} reference=${reference || 'unknown'} durationMs=${Date.now() - startedAt} error=${error?.message}`,
        error?.stack,
      );
      throw error;
    }
  }
}
