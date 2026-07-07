import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class GenerateReceiptDto {
  @ApiPropertyOptional({ description: 'Optional completed payment ID to use for receipt generation' })
  @IsOptional()
  @IsMongoId()
  paymentId?: string;

  @ApiPropertyOptional({ description: 'Optional note to show on the receipt' })
  @IsOptional()
  @IsString()
  note?: string;
}
