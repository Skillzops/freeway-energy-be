import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class SendReceiptDto {
  @ApiPropertyOptional({
    description:
      'Completed payment ID whose receipt to email; defaults to latest receipt on the invoice',
  })
  @IsOptional()
  @IsMongoId()
  paymentId?: string;
}
