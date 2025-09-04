import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WarehouseEntity {
  @ApiProperty({
    description: 'Warehouse ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  id: string;

  @ApiProperty({ description: 'Warehouse name', example: 'Lagos South Branch' })
  name: string;

  @ApiProperty({
    description: 'Warehouse location',
    example: 'Victoria Island, Lagos',
  })
  location: string;

  @ApiPropertyOptional({
    description: 'Warehouse description',
    example: 'Main distribution center',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Warehouse image URL',
    example: 'https://example.com/image.jpg',
  })
  image?: string;

  @ApiProperty({
    description: 'Whether this is the main warehouse',
    example: false,
  })
  isMain: boolean;

  @ApiProperty({ description: 'Whether warehouse is active', example: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Deletion timestamp', example: null })
  deletedAt?: Date;

  @ApiPropertyOptional({
    description: 'Number of warehouse managers',
    example: 2,
  })
  warehouseManagers?: number;

  @ApiPropertyOptional({
    description: 'Total inventory value',
    example: 1500000,
  })
  totalValue?: number;

  @ApiPropertyOptional({
    description: 'Total inventory items',
    example: 150,
  })
  totalItems?: number;

  constructor(partial: Partial<WarehouseEntity>) {
    Object.assign(this, partial);
  }
}
