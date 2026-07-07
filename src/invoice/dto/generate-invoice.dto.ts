import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';

const toAmount = ({ value }: { value: unknown }) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new BadRequestException('Amount must be a valid number.');
  }
  return parsed;
};

export class GenerateInvoiceDto {
  @ApiProperty({ description: 'Sales record ID (MongoDB ObjectId)' })
  @IsMongoId()
  saleId: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class CreateSubInvoiceDto {
  @ApiProperty({ description: 'Master invoice ID (MongoDB ObjectId)' })
  @IsMongoId()
  masterInvoiceId: string;

  @ApiProperty() @Transform(toAmount) @IsNumber() @Min(0.01)
  amount: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class VoidInvoiceDto {
  @ApiProperty() @IsString()
  reason: string;
}
