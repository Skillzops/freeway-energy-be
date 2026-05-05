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

    const result = await this.paymentService.handlePaystackWebhookPayload(payload);
    this.logger.log(
      `[PAYSTACK_WEBHOOK] Processed event=${event || 'unknown'} reference=${reference || 'unknown'} result=${JSON.stringify(result)}`,
    );

    return {
      message: 'Webhook received successfully',
      status: 'processed',
      result,
    };
  }
}
