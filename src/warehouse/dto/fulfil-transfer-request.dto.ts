import { ApiProperty } from '@nestjs/swagger';
import { Min, IsInt } from 'class-validator';

export class FulfillTransferRequestDto {
  @ApiProperty({
    description: 'Quantity to fulfill',
    example: 8,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  // @ApiPropertyOptional({
  //   description: 'Additional notes for fulfillment',
  //   example: 'Partially fulfilled due to stock limitations',
  // })
  // @IsString()
  // @IsOptional()
  // notes?: string;
}
