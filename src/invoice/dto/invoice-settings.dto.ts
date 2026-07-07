import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toOptionalNumber =
  (label: string) =>
  ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${label} must be a valid number.`);
    }
    return parsed;
  };

const toOptionalInt =
  (label: string) =>
  ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const parsed = parseInt(String(value), 10);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`${label} must be a valid whole number.`);
    }
    return parsed;
  };

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return value;
};

export class UpsertInvoiceSettingsDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toOptionalBoolean) @IsBoolean()
  taxEnabled?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  taxName?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(toOptionalNumber('Tax rate')) @IsNumber() @Min(0) @Max(100)
  taxRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  taxNumber?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(toOptionalBoolean) @IsBoolean()
  autoInvoicePaygo?: boolean;

  @ApiPropertyOptional() @IsOptional() @Transform(toOptionalBoolean) @IsBoolean()
  allowSubInvoices?: boolean;

  @ApiPropertyOptional({ description: 'Automatically generate a receipt when invoice payment is completed' }) @IsOptional() @Transform(toOptionalBoolean) @IsBoolean()
  autoGenerateReceiptOnPayment?: boolean;

  @ApiPropertyOptional({ description: 'Automatically email generated receipt to customer when available' }) @IsOptional() @Transform(toOptionalBoolean) @IsBoolean()
  autoEmailReceiptToCustomer?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  invoicePrefix?: string;

  @ApiPropertyOptional({ description: "Receipt number prefix", example: "RCT" }) @IsOptional() @IsString()
  receiptPrefix?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  currencySymbol?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  bankName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  accountName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  accountNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  bankCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  footerNote?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  companyName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  companyAddress?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  companyLogoUrl?: string;

  @ApiPropertyOptional({ description: 'Default due days after invoice issuance (0 = no due date)', example: 30 })
  @IsOptional() @Transform(toOptionalInt('Default due days')) @IsInt() @Min(0)
  defaultDueDays?: number;
}
