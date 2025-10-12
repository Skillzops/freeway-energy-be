import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  IsDateString,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaymentMethod, PaymentMode, SalesStatus } from '@prisma/client';

export enum ExportType {
  SALES = 'sales',
  CUSTOMERS = 'customers',
  PAYMENTS = 'payments',
  DEVICES = 'devices',
  DEBT_REPORT = 'debt_report',
  RENEWAL_REPORT = 'renewal_report',
  WEEKLY_SUMMARY = 'weekly_summary',
  MONTHLY_SUMMARY = 'monthly_summary',
}

export class ExportDataQueryDto {
  @ApiProperty({
    enum: ExportType,
    description: 'Type of data to export',
    example: 'sales',
  })
  @IsEnum(ExportType)
  exportType: ExportType;

  @ApiPropertyOptional({
    enum: PaymentMode,
    description: 'Filter by payment mode (ONE_OFF or INSTALLMENT)',
  })
  paymentMode?: PaymentMode;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    enum: SalesStatus,
    description: 'Filter by sales status',
  })
  @IsOptional()
  @IsEnum(SalesStatus)
  salesStatus?: SalesStatus;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Filter by payment method',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Filter by customer ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Start date for filtering (ISO 8601 format)',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'Filter by LGA',
    example: 'Ikeja',
  })
  @IsOptional()
  @IsString()
  lga?: string;

  @ApiPropertyOptional({
    enum: ['csv', 'json'],
    description: 'Response format',
    example: 'csv',
    default: 'csv',
  })
  @IsOptional()
  @IsEnum(['csv', 'json'])
  format?: 'csv' | 'json';

  @ApiPropertyOptional({
    description: 'End date for filtering (ISO 8601 format)',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  endDate?: Date;

  @ApiPropertyOptional({
    description: 'Filter by state',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description:
      'Filter overdue installments (days since last payment threshold)',
    example: 35,
  })
  overdueDays?: number;

  @ApiPropertyOptional({
    description: 'Filter customers with outstanding debt only',
  })
  hasOutstandingDebt?: boolean;

  @ApiPropertyOptional({
    description: 'Filter sales made in the specified period (new sales)',
  })
  isNewSale?: boolean;

  @ApiPropertyOptional({
    description: 'Filter renewal/reactivation payments only',
  })
  isRenewal?: boolean;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of records per page',
    example: 100,
    minimum: 1,
    maximum: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5000)
  limit?: number;
}

export class OutstandingPaymentsQueryDto {
  @ApiPropertyOptional({
    description: 'Days threshold for overdue (default: 35)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  overdueDays?: number;
}
