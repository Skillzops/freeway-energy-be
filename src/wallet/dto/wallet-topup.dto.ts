import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway } from '@prisma/client';
import {
  IsString,
  IsOptional,
  IsEnum,
} from 'class-validator';

export class WalletTopUpDto {
  @ApiProperty({ description: 'Amount to top up', minimum: 100, example: 500 })
  // @IsNumber()
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
