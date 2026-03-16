import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  Param,
  BadRequestException,
  Patch,
  Delete,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { ActionEnum, AgentCategory, SubjectEnum } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GetSessionUser } from '../auth/decorators/getUser';
import { SalesService } from './service/sales.service';
import { CreateSalesDto, UpdateSaleDto } from './dto/create-sales.dto';
import { ValidateSaleProductDto } from './dto/validate-sale-product.dto';
import { CreateFinancialMarginDto } from './dto/create-financial-margins.dto';
import { CreateNextPaymentDto } from '../payment/dto/cash-payment.dto';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ListSalesQueryDto } from './dto/list-sales.dto';
import { AuthService } from 'src/auth/auth.service';
import { SalesIdGeneratorService } from './service/saleid-generator';
import { SaleReversalService } from './service/sale-reversal.service';
import { SalesDonationService } from './service/sales-donation.service';
import {
  BatchDonationResponseDto,
  CreateDonationSaleDto,
} from './dto/sales-donation.dto';

@SkipThrottle()
@ApiTags('Sales')
@Controller('sales')
@ApiBearerAuth('access_token')
@ApiHeader({
  name: 'Authorization',
  description: 'JWT token used for authentication',
  required: true,
  schema: {
    type: 'string',
    example: 'Bearer <token>',
  },
})
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly authService: AuthService,
    private readonly salesIdGenerator: SalesIdGeneratorService,
    private readonly saleReversalService: SaleReversalService,
    private readonly salesDonationService: SalesDonationService,
    @InjectQueue('payment-queue') private paymentQueue: Queue,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBody({
    type: CreateSalesDto,
    description: 'Json structure for request payload',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.CREATED)
  @Post('create')
  async create(
    @Body() createSalesDto: CreateSalesDto,
    @GetSessionUser('id') requestUserId: string,
  ) {
    return await this.salesService.createSale(requestUserId, createSalesDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record a cash payment for a sale' })
  @ApiBody({
    type: CreateNextPaymentDto,
    description: 'Cash payment details',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.CREATED)
  @Post('create-next-payment')
  async createNextPayment(
    @Body() recordCashPaymentDto: CreateNextPaymentDto,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.write, subject: SubjectEnum.Sales },
      ],
      agentCategory: AgentCategory.SALES,
    });

    try {
      const paymentData = await this.salesService.createNextPayment(
        requestUserId,
        recordCashPaymentDto,
      );
      await this.paymentQueue.waitUntilReady();

      const job = await this.paymentQueue.add(
        'process-next-payment',
        { paymentData },
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
        jobId: job.id,
        status: 'processing',
        message: 'Next payment recorded successfully',
      };
    } catch (error) {
      console.log({ error });
      throw new BadRequestException(error);
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBody({
    type: ValidateSaleProductDto,
    description: 'Json structure for request payload',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Post('validate-sale-product-quantity')
  async validateSaleProductQuantity(
    @Body() saleProducts: ValidateSaleProductDto,
  ) {
    return await this.salesService.validateSaleProductQuantity(
      saleProducts.productItems,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(ListSalesQueryDto)
  @HttpCode(HttpStatus.OK)
  @Get('')
  async getSales(@Query() query: ListSalesQueryDto) {
    return await this.salesService.getAllSales(query);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @HttpCode(HttpStatus.OK)
  @Get('financial-margins')
  async getMargins() {
    return await this.salesService.getMargins();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('financial-margins')
  async createMargins(@Body() body: CreateFinancialMarginDto) {
    return await this.salesService.createFinMargin(body);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'Sale id to fetch details.',
  })
  @Get(':id')
  async getSale(@Param('id') id: string) {
    return await this.salesService.getSale(id);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
    ],
  })
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Sale Details',
    description:
      'Update allowed sale fields: notes, customer, devices. ' +
      'Financial fields (totals, amounts) are protected and cannot be modified. ' +
      'All changes require a reason and are tracked in audit log.',
  })
  @ApiParam({ name: 'id', description: 'Sale ID' })
  @ApiBody({
    type: UpdateSaleDto,
    description: 'Partial update with whitelisted fields. ',
  })
  async updateSale(@Param('id') saleId: string, @Body() dto: UpdateSaleDto) {
    return this.salesService.updateSale(saleId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'Sale id to fetch payment details.',
  })
  @Get(':id/payment-data')
  async getSalePaymentData(@Param('id') id: string) {
    return await this.salesService.getSalesPaymentDetails(id);
  }

  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get('fix/sales-with-overcalculated-total')
  async fixSalesWithOvercalculatedTotal() {
    return await this.salesService.fixSalesWithOvercalculatedTotal();
  }

  @ApiExcludeEndpoint()
  @Delete('undo/:id')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.delete}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiOperation({
    summary: 'Undo Sale Creation',
    description:
      'Reverse a sale creation. Restores inventory, refunds agent wallet, ' +
      'unassigns devices, and reverses payments. ' +
      'Only works for UNPAID or PARTIALLY_PAID sales.',
  })
  @ApiParam({
    name: 'id',
    description: 'Sale ID to reverse',
  })
  async undoSale(
    @Param('id') saleId: string,
    @GetSessionUser('id') performedBy: string,
  ) {
    return await this.saleReversalService.undoSaleCreation(saleId, performedBy);
  }

  @ApiExcludeEndpoint()
  @Post(':id/complete-payment')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'Sale ID to complete',
  })
  async completeSalePayment(@Param('id') saleId: string) {
    return await this.salesService.completeSalePayment(saleId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Post('create-donations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create police station device donation sales',
    description:
      'Admin only endpoint. Creates special donation sales for specific customers (e.g police stations). ' +
      'Creates one Sale + one SaleItem per device with ₦0 payment. ' +
      'Customers are flagged as one-time use (cannot be used in regular sales). ' +
      'Devices are linked directly, no new token generation needed.',
  })
  @ApiBody({
    type: CreateDonationSaleDto,
  })
  async createPoliceDonationSales(
    @Body() dto: CreateDonationSaleDto,
    @GetSessionUser('id') adminUserId: string,
  ): Promise<BatchDonationResponseDto> {
    return await this.salesDonationService.createDonationSales(
      adminUserId,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('donations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all police donation sales',
    description:
      'Retrieve all device donations sale records. ' +
      'Shows devices granted, agents involved, and unlock status.',
  })
  async getPoliceDonationSales() {
    return await this.salesDonationService.getPoliceDonationSales();
  }

  @ApiExcludeEndpoint()
  @Post(':id/restore-overpayment')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'Sale ID to complete',
  })
  async restoreSaleOverpayment(
    @Param('id') saleId: string,
    @Body('amount') amount: number,
  ) {
    return await this.salesService.restoreSaleOverpayment(saleId, amount);
  }

  @ApiExcludeEndpoint()
  @Post('fix/populate-formatted-ids')
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Sales}`],
  })
  @ApiOperation({
    summary: 'Populate existing sales with formatted IDs',
    description:
      'One-time migration endpoint to generate and assign formatted sale IDs to all existing sales records. Only accessible to super admins.',
  })
  async populateFormattedIds() {
    const result = await this.salesIdGenerator.populateExistingSalesIds();
    return {
      message: 'Sales ID population completed',
      result,
    };
  }
}
