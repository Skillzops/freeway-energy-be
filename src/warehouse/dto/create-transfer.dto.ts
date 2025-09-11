import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, Min, IsInt } from 'class-validator';

export class CreateTransferRequestDto {
  @ApiProperty({
    description: 'ID of the warehouse to request from',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  @IsString()
  @IsNotEmpty()
  fromWarehouseId: string;

  @ApiProperty({
    description: 'ID of the warehouse to request to',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  @IsString()
  @IsNotEmpty()
  toWarehouseId: string;

  @ApiProperty({
    description: 'ID of the inventory to request',
    example: '60f1b2b3b3f3b3b3b3f3b3b4',
  })
  @IsString()
  @IsNotEmpty()
  inventoryId: string;

  @ApiProperty({
    description: 'Quantity to request',
    example: 10,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  requestedQuantity: number;

  @ApiPropertyOptional({
    description: 'Additional notes for the request',
    example: 'Urgent request for Lagos branch',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
