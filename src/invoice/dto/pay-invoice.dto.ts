import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsMongoId,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { PaymentGateway, PaymentMethod } from '@prisma/client';

export class PayInvoiceDto {
  @ApiProperty({ description: 'Amount to pay against this invoice', example: 25000 })
  @IsNumber()
  @Transform(({ value }) => {
    const parsed = Number(value);
    if (isNaN(parsed)) throw new BadRequestException('Amount must be a valid number.');
    return parsed;
  })
  @Min(0.01)
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({
    description: 'Payment method. Defaults to WALLET for agents, CASH otherwise.',
    enum: PaymentMethod,
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Payment gateway (required for ONLINE method)',
    enum: PaymentGateway,
  })
  @IsOptional()
  @IsEnum(PaymentGateway)
  paymentGateway?: PaymentGateway;

  @ApiPropertyOptional({ description: 'Optional notes about this payment' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'For PAYG sales: the specific SaleInstallment ID this payment covers. ' +
      'If omitted, the service resolves the next unpaid installment automatically.',
  })
  @IsOptional()
  @IsMongoId()
  installmentId?: string;

  @ApiPropertyOptional({ description: 'Optional: the specific SaleItem this payment is attributed to' })
  @IsOptional()
  @IsMongoId()
  saleItemId?: string;
}
