import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { GetSessionUser } from 'src/auth/decorators/getUser';
import { AgentAccessGuard } from 'src/auth/guards/agent-access.guard';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { OgaranyaService } from '../ogaranya/ogaranya.service';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly ogaranyaService: OgaranyaService,
    private readonly config: ConfigService,
    @InjectQueue('payment-queue') private paymentQueue: Queue,
  ) {}

  @ApiOperation({ summary: 'Verify payment callback' })
  @ApiQuery({
    name: 'tx_ref',
    type: String,
    description: 'Transaction reference',
  })
  @ApiQuery({
    name: 'transaction_id',
    type: Number,
    description: 'Transaction ID',
  })
  @HttpCode(HttpStatus.OK)
  @Get('verify/callback')
  @ApiOperation({ summary: 'Manually verify payment status' })
  async verifyPayment(
    @Query('tx_ref') tx_ref: string,
    @Query('transaction_id') transaction_id: number,
  ) {
    // return this.paymentService.verifyPaymentManually(body.transactionRef);
    await this.paymentQueue.waitUntilReady();

    const job = await this.paymentQueue.add(
      'verify-payment',
      { tx_ref, transaction_id },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
        delay: 1000, // Add small delay to ensure job is processed
      },
    );

    return {
      message: 'Payment verification initiated successfully',
      jobId: job.id,
      status: 'processing',
    };
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @Get('pending')
  @ApiOperation({ summary: 'Get pending payments for agent' })
  async getPendingPayments(@GetSessionUser('agent') agent: any) {
    return this.paymentService.getPendingPayments(agent.id);
  }

  @Post('test/simulate-ogaranya-payment')
  async simulateOgaranyaPayment(
    @Body() body: { orderReference: string; amount: number },
  ) {
    try {
      const result = await this.ogaranyaService.simulatePayment(
        body.orderReference,
        body.amount,
      );
      return {
        success: true,
        message: 'Payment simulated successfully',
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Post('webhook/flutterwave')
  @ApiOperation({ summary: 'Flutterwave payment webhook' })
  @ApiHeader({
    name: 'verif-hash',
    description: 'Flutterwave webhook signature',
    required: true,
  })
  @HttpCode(HttpStatus.OK)
  async handleFlutterwaveWebhook(
    @Body() payload: any,
    @Headers('verif-hash') signature: string,
  ) {
    try {
      // Verify webhook signature
      const verifiedPayload = await this.flutterwaveService.handleWebhook(
        payload,
        signature,
      );

      // Process the webhook
      await this.paymentQueue.waitUntilReady();

      const job = await this.paymentQueue.add(
        'process-flutterwave-webhook',
        { payload: verifiedPayload },
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

      return {
        message: 'Webhook received successfully',
        jobId: job.id,
        status: 'processing',
      };
    } catch (error) {
      console.error('Flutterwave webhook error:', error);
      return {
        status: 'failed',
        message: error.message || 'Webhook processing failed',
      };
    }
  }

  // @Post('webhook/ogaranya')
  // @ApiOperation({ summary: 'Ogaranya payment webhook (legacy endpoint)' })
  // @HttpCode(HttpStatus.OK)
  // async handleOgaranyaWebhook(@Body() payload: any) {
  //   try {
  //     await this.paymentQueue.waitUntilReady();

  //     const job = await this.paymentQueue.add(
  //       'process-ogaranya-webhook',
  //       { payload },
  //       {
  //         attempts: 3,
  //         backoff: {
  //           type: 'exponential',
  //           delay: 5000,
  //         },
  //         removeOnComplete: true,
  //         removeOnFail: false,
  //         delay: 1000,
  //       },
  //     );

  //     return {
  //       status: 'success',
  //       data: {
  //         message: 'Payment webhook received successfully',
  //       },
  //     };
  //   } catch (error) {
  //     console.error('Ogaranya webhook error:', error);
  //     return {
  //       status: 'failed',
  //       data: {
  //         message: error.message || 'Webhook processing failed',
  //       },
  //     };
  //   }
  // }
}
