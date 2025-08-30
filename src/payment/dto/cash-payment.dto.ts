import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
} from 'class-validator';
import { IsObjectId } from 'class-validator-mongo-object-id';
import { BadRequestException } from '@nestjs/common';

export class CreateNextPaymentDto {
  @ApiProperty({
    description: 'Sale ID for the cash payment',
    example: '507f191e810c19729de860ea',
  })
  @IsNotEmpty()
  @IsString()
  @IsObjectId({
    message: 'Invalid Sale Id',
  })
  saleId: string;

  @ApiProperty({
    description: 'Amount received in cash',
    example: 50000,
  })
  @IsNumber()
  @Transform(({ value }) => {
    const parsedValue = Number(value);
    if (isNaN(parsedValue)) {
      throw new BadRequestException('Amount must be a valid number.');
    }
    return parsedValue;
  })
  @Min(0.01)
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({
    description: 'Additional notes about the payment',
    example: 'Customer paid in full, change given: 0',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
