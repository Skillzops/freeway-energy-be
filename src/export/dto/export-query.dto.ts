import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AgentCategory, PaymentMethod, SalesStatus } from '@prisma/client';

/**
 * Export Types:
 * 
 * DEBT_REPORT: Shows individual customer debts with remaining months
 * RENEWAL_REPORT: Shows customers who haven't paid monthly reactivation (defaulters)
 * WEEKLY_SUMMARY: New sales + renewals for a week
 * MONTHLY_SUMMARY: New sales + renewals for a month
 * SALES: Standard sales export
 * CUSTOMERS: Customer list with debt summary
 * PAYMENTS: Payment transaction history
 * DEVICES: Device installation records
 * TOTAL_OUTSTANDING_RECEIVABLES: TOTAL_OUTSTANDING_RECEIVABLES records
 */
export enum ExportType {
  DEBT_REPORT = 'debt_report',
  RENEWAL_REPORT = 'renewal_report',
  WEEKLY_SUMMARY = 'weekly_summary',
  MONTHLY_SUMMARY = 'monthly_summary',
  SALES = 'sales',
  CUSTOMERS = 'customers',
  PAYMENTS = 'payments',
  DEVICES = 'devices',
  TOTAL_OUTSTANDING_RECEIVABLES = 'total_outstanding_receivables',
}

export class ExportDataQueryDto {
  @ApiProperty({
    enum: ExportType,
    description: `
**Export Type Guide:**

**DEBT_REPORT**: View individual customer debts remaining and number of months
- Shows: Outstanding balance, remaining months, payment history per customer
- Use for: Tracking individual customer debt status
- Includes: Total debt summary across all customers

**RENEWAL_REPORT**: See customers who haven't paid monthly reactivations
- Shows: Customers with overdue installments, days/months defaulted
- Use for: Identifying payment defaulters
- Filter by: overdueDays (default: 30)

**WEEKLY_SUMMARY**: Generate weekly reports
- Shows: Total new sales (stock & cash), total renewals (quantities & amounts)
- Use for: Weekly performance tracking
- Includes: Revenue breakdown by payment mode

**MONTHLY_SUMMARY**: Generate monthly reports  
- Shows: Total new sales (stock & cash), total renewals (quantities & amounts)
- Use for: Monthly performance tracking
- Includes: Revenue breakdown by payment mode

**SALES**: Standard sales export
**CUSTOMERS**: Customer records with debt summary
**PAYMENTS**: Payment transaction history
**DEVICES**: Device installation records
    `,
    example: ExportType.DEBT_REPORT,
  })
  @IsEnum(ExportType)
  exportType: ExportType;

  @ApiPropertyOptional({
    description:
      'Filter by specific customer ID (Applicable to only export_type=sales|debt_report|customers|renewal_report|devices)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by agent ID (Applicable to only export_type=sales|debt_report|weekly_summary|monthly_summary|renewal_report)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    enum: AgentCategory,
    description:
      'Filter by agent category (Applicable to only export_type=sales|debt_report|renewal_report|payments|devices)',
    example: AgentCategory.SALES,
  })
  @IsOptional()
  @IsEnum(AgentCategory)
  agentCategory?: AgentCategory;

  @ApiPropertyOptional({
    enum: SalesStatus,
    description:
      'Filter by sales status (COMPLETED, IN_INSTALLMENT, UNPAID, CANCELLED) (Applicable to only export_type=sales)',
  })
  @IsOptional()
  @IsEnum(SalesStatus)
  salesStatus?: SalesStatus;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description:
      'Filter by payment method (Applicable to only export_type=payment)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description:
      'Start date for filtering (ISO 8601: 2025-01-01) (Applicable to only export_type=sales|paymeny|devices|monthly_summary|weekly_summary|renewal_report|debt_report|total_outstanding_receivables)',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsDateString()
  // @Transform(({ value }) => (value ? new Date(value) : undefined))
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date for filtering (ISO 8601: 2025-12-31) (Applicable to only export_type=sales|paymeny|devices|monthly_summary|weekly_summary|renewal_report|debt_report|total_outstanding_receivables)',
    example: '2025-12-31',
  })
  @IsOptional()
  @IsDateString()
  // @Transform(({ value }) => (value ? new Date(value) : undefined))
  endDate?: string;

  @ApiPropertyOptional({
    description:
      'Filter by state (e.g., Lagos, Abuja) (Applicable to only export_type=debt_report|customers|renewal_report)',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description:
      'Filter by LGA (Local Government Area) (Applicable to only export_type=debt_report|customers|renewal_report)',
    example: 'Ikeja',
  })
  @IsOptional()
  @IsString()
  lga?: string;

  @ApiPropertyOptional({
    description: `
**Overdue Days Threshold:**
Minimum number of days since last payment to consider overdue.
- Default: 30 days
- Use for: Renewal Report to find defaulters
- Example: overdueDays=60 finds customers who haven't paid in 60+ days

(Applicable to only export_type=debt_report|renewal_report)
    `,
    example: 30,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  overdueDays?: number;

  @ApiPropertyOptional({
    description:
      'Filter customers with outstanding debt only (for CUSTOMERS export) (Applicable to only export_type=customers)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasOutstandingDebt?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter by device serial number (case insensitive) (Applicable to only export_type=devices)',
    example: 'SN12345',
  })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    enum: ['not_installed', 'ready_for_installation', 'installed'],
    description:
      'Filter by installation status (Applicable to only export_type=devices)',
  })
  @IsOptional()
  @IsEnum(['not_installed', 'ready_for_installation', 'installed'])
  installationStatus?: string;

  @ApiPropertyOptional({
    description:
      'Filter by overdue status - show only overdue debts (Applicable to only export_type=debt_report)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isOverdue?: boolean;

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
    description: 'Number of records per page (max 5000)',
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

  @ApiPropertyOptional({
    enum: ['csv', 'json'],
    description: 'Response format (csv for download, json for API response)',
    example: 'csv',
    default: 'csv',
  })
  @IsOptional()
  @IsEnum(['csv', 'json'])
  format?: 'csv' | 'json';
}