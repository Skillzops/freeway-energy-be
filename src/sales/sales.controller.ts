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
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GetSessionUser } from '../auth/decorators/getUser';
import { SalesService } from './sales.service';
import { CreateSalesDto } from './dto/create-sales.dto';
import { ValidateSaleProductDto } from './dto/validate-sale-product.dto';
import { CreateFinancialMarginDto } from './dto/create-financial-margins.dto';
import { CreateNextPaymentDto } from '../payment/dto/cash-payment.dto';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ListSalesQueryDto } from './dto/list-sales.dto';
import { AuthService } from 'src/auth/auth.service';

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
}
