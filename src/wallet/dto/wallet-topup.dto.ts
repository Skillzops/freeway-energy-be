import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';

export class WalletTopUpDto {
  @ApiProperty({ description: 'Amount to top up', minimum: 100, example: 500 })
  @IsNotEmpty()
  @Transform(({ value }) => {
    const parsedValue = Number(value);
    if (isNaN(parsedValue)) {
      throw new BadRequestException('Amount must be a valid number.');
    }
    return parsedValue;
  })
  // @IsPositive()
  // @Min(100)
  amount: number;

  @ApiPropertyOptional({ description: 'Optional description for the top-up' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    enum: PaymentGateway,
    description: 'Payment gateway to use for the top-up',
  })
  @IsEnum(PaymentGateway)
  @IsOptional()
  gateway?: PaymentGateway = PaymentGateway.OGARANYA;
}
