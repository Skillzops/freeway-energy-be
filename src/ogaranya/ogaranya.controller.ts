import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody } from '@nestjs/swagger';
import { OgaranyaService } from './ogaranya.service';
import { OgaranyaWebhookDto } from './dto/ogaranya-webhook.dto';
import { ApiAuthGuard } from '../auth/guards/api-auth.guard';
import { PaymentService } from 'src/payment/payment.service';

@ApiTags('Ogaranya')
@Controller('ogaranya')
export class OgaranyaController {
  constructor(
    private readonly ogaranyaService: OgaranyaService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
  ) {}

  @UseGuards(ApiAuthGuard)
  @Get('payment/:paymentReference')
  @ApiOperation({
    summary: 'Fetch customer information using payment reference',
    description:
      'Used by Ogaranya to get customer details for payment validation',
  })
  @ApiParam({
    name: 'paymentReference',
    description: 'Short payment reference (e.g., PAY-ABC123)',
    example: 'PAY-ABC123',
  })
  async getCustomerByPaymentReference(
    @Param('paymentReference') paymentReference: string,
  ) {
    return await this.ogaranyaService.getCustomerByPaymentReference(
      paymentReference,
    );
  }

  @UseGuards(ApiAuthGuard)
  @Post('webhook')
  @ApiOperation({
    summary: 'Ogaranya payment webhook',
    description: 'Receives payment notifications from Ogaranya',
  })
  @ApiBody({ type: OgaranyaWebhookDto })
  @HttpCode(HttpStatus.OK)
  async handlePaymentWebhook(@Body() webhookData: OgaranyaWebhookDto) {
    try {
      const result = (await this.ogaranyaService.handlePaymentWebhook(
        webhookData,
      )) as any;

      if (result.paymentData) {
        await this.paymentService.handlePostPayment(result.paymentData);
      }

      return {
        status: 'success',
        data: {
          message: result.message || 'Payment processed successfully',
        },
      };
    } catch (error) {
      console.error('Ogaranya webhook error:', error);

      return {
        status: 'failed',
        data: {
          message: error.message || 'Payment processing failed',
        },
      };
    }
  }

  @UseGuards(ApiAuthGuard)
  @Get('wallet-topup/:topupReference')
  @ApiOperation({
    summary: 'Fetch wallet top-up information',
    description: 'Used by Ogaranya to get wallet top-up details',
  })
  @ApiParam({
    name: 'topupReference',
    description: 'Short top-up reference (e.g., TOP-ABC123)',
    example: 'TOP-ABC123',
  })
  async getWalletTopUpByReference(
    @Param('topupReference') topupReference: string,
  ) {
    return this.ogaranyaService.getWalletTopUpByReference(topupReference);
  }
}
