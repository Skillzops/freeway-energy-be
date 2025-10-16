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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody } from '@nestjs/swagger';
import { OgaranyaService } from './ogaranya.service';
import { OgaranyaWebhookDto } from './dto/ogaranya-webhook.dto';
import { ApiAuthGuard } from '../auth/guards/api-auth.guard';
import { PaymentService } from 'src/payment/payment.service';
import {
  DevicePaymentDto,
  PowerPurchaseDto,
  SerialNumberDto,
} from './dto/ogaranya-power-purchase.dto';
import { AgentVerificationDto } from './dto/agent-verification.dto';
import { InitializeWalletTopUpDto, WalletTopUpDto } from './dto/initialize-wallet-topup.dto';

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
  @Post('device')
  @ApiOperation({
    summary: 'Get device information by serial number',
    description:
      'Fetch device details including customer name, amount, and address using device serial number',
  })
  @ApiBody({ type: SerialNumberDto })
  async getDeviceInformation(@Body() body: SerialNumberDto) {
    const { serialNumber } = body;

    if (!serialNumber) {
      throw new BadRequestException('Serial number is required');
    }

    const decodedSerial = decodeURIComponent(serialNumber);

    return await this.ogaranyaService.getDeviceInformation(decodedSerial);
  }

  @UseGuards(ApiAuthGuard)
  @Post('device/report-payment')
  @ApiOperation({
    summary: 'Report successful payment against device serial number',
    description:
      'Record a payment made for a device and update sale payment status',
  })
  @ApiBody({ type: DevicePaymentDto })
  @HttpCode(HttpStatus.OK)
  async recordDevicePayment(@Body() devicePaymentDto: DevicePaymentDto) {
    try {
      const result =
        await this.ogaranyaService.recordDevicePayment(devicePaymentDto);

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
      console.error('Device payment error:', error);
      return {
        status: 'failed',
        message: error.message || 'Payment recording failed',
      };
    }
  }

  @UseGuards(ApiAuthGuard)
  @Post('device/power-purchase')
  @ApiOperation({
    summary: 'Purchase power and generate token for device',
    description:
      'Purchase power for a specified number of days and generate token. Updates installment status and payment records.',
  })
  @ApiBody({ type: PowerPurchaseDto })
  @HttpCode(HttpStatus.OK)
  async purchasePower(@Body() powerPurchaseDto: PowerPurchaseDto) {
    try {
      const result = await this.ogaranyaService.purchasePower(powerPurchaseDto);

      return {
        status: 'success',
        message: 'Power purchased successfully',
        data: result,
      };
    } catch (error) {
      console.error('Power purchase error:', error);
      return {
        status: 'failed',
        message: error.message || 'Power purchase failed',
      };
    }
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

  @UseGuards(ApiAuthGuard)
  @Post('wallet-topup')
  @ApiOperation({
    summary: 'Top up wallet by top up reference',
    description: 'Used by Ogaranya to top-up wallet',
  })
  @ApiParam({
    name: 'topupReference',
    description: 'Short top-up reference (e.g., TOP-ABC123)',
    example: 'TOP-ABC123',
  })
  async walletTopUpByReference(@Body() topupDto: WalletTopUpDto) {
    return this.ogaranyaService.walletTopUpByReference(topupDto);
  }

  @UseGuards(ApiAuthGuard)
  @Post('wallet/initialize-topup')
  @ApiOperation({
    summary: 'Initialize wallet top-up transaction',
    description:
      'Create a pending wallet top-up and initiate payment with Ogaranya',
  })
  @ApiBody({ type: InitializeWalletTopUpDto })
  @HttpCode(HttpStatus.OK)
  async initializeWalletTopUp(@Body() initializeDto: InitializeWalletTopUpDto) {
    return await this.ogaranyaService.initializeWalletTopUp(initializeDto);
  }

  @UseGuards(ApiAuthGuard)
  @Post('agent/verify')
  @ApiOperation({
    summary: 'Verify if an agent exists',
    description:
      'Check if an agent exists using phone, email, staffId, or Ogaranya account number',
  })
  @ApiBody({ type: AgentVerificationDto })
  @HttpCode(HttpStatus.OK)
  async verifyAgent(@Body() verificationDto: AgentVerificationDto) {
    return await this.ogaranyaService.verifyAgent(verificationDto);
  }
}
