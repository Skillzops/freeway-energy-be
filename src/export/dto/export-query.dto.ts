import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsDateString, IsNumber, Min, Max, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SalesStatus, PaymentStatus, UserStatus, PaymentMethod, AgentCategory } from '@prisma/client';


export class ExportDataQueryDto {
  @ApiProperty({
    enum: ['sales', 'customers', 'payments', 'devices', 'comprehensive'],
    description: 'Type of data to export',
    example: 'sales',
  })
  @IsEnum(['sales', 'customers', 'payments', 'devices', 'comprehensive'])
  exportType: 'sales' | 'customers' | 'payments' | 'devices' | 'comprehensive';

  @ApiPropertyOptional({
    description: 'Start date for filtering (ISO 8601 format)',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  startDate?: Date;

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
    description: 'Created start date for filtering',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  createdStartDate?: Date;

  @ApiPropertyOptional({
    description: 'Created end date for filtering',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  createdEndDate?: Date;

  @ApiPropertyOptional({
    enum: SalesStatus,
    description: 'Filter by sales status',
  })
  @IsOptional()
  @IsEnum(SalesStatus)
  salesStatus?: SalesStatus;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    enum: AgentCategory,
    description: 'Filter by agent category',
  })
  @IsOptional()
  @IsEnum(AgentCategory)
  agentCategory?: AgentCategory;

  @ApiPropertyOptional({
    description: 'Filter by customer ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    enum: UserStatus,
    description: 'Filter by customer status',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  customerStatus?: UserStatus;

  @ApiPropertyOptional({
    description: 'Filter by customer type',
    example: 'residential',
  })
  @IsOptional()
  @IsString()
  customerType?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer state',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  customerState?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer LGA',
    example: 'Ikeja',
  })
  @IsOptional()
  @IsString()
  customerLga?: string;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter by payment status',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Filter by payment method',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Minimum payment amount',
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmount?: number;

  @ApiPropertyOptional({
    description: 'Maximum payment amount',
    example: 100000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmount?: number;

  @ApiPropertyOptional({
    description: 'Filter by product ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Filter by product name',
    example: 'Solar Panel 100W',
  })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiPropertyOptional({
    description: 'Filter by device serial number',
    example: 'SN123456789',
  })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    description: 'Filter by state',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description: 'Filter by LGA',
    example: 'Ikeja',
  })
  @IsOptional()
  @IsString()
  lga?: string;

  @ApiPropertyOptional({
    description: 'Filter by installer name',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  installerName?: string;

  @ApiPropertyOptional({
    description:
      'Filter customers who made multiple payments (more than 1 payment)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasMultiplePayments?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter customers who made repayments (same as hasMultiplePayments)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasMadeRepayments?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum number of payments made',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPaymentCount?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of payments made',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPaymentCount?: number;

  @ApiPropertyOptional({
    description:
      'Filter overdue payments (more than 35 days since last payment)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  paymentOverdue?: boolean;

  @ApiPropertyOptional({
    description: 'Filter fully paid sales',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  fullyPaid?: boolean;

  @ApiPropertyOptional({
    description: 'Filter sales with outstanding balance',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasOutstandingBalance?: boolean;

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
