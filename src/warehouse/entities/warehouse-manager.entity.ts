import { ApiProperty } from '@nestjs/swagger';

export class WarehouseManagerEntity {
  @ApiProperty({
    description: 'Warehouse manager ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  id: string;

  @ApiProperty({
    description: 'Warehouse ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b4',
  })
  warehouseId: string;

  @ApiProperty({ description: 'User ID', example: '60f1b2b3b3f3b3b3b3f3b3b5' })
  userId: string;

  @ApiProperty({
    description: 'User details',
    type: 'object',
    properties: {
      firstname: { type: 'string', example: 'John' },
      lastname: { type: 'string', example: 'Doe' },
      email: { type: 'string', example: 'john.doe@example.com' },
      phone: { type: 'string', example: '+234123456789' },
    },
  })
  user: {
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
  };

  @ApiProperty({
    description: 'Warehouse details',
    type: 'object',
    properties: {
      name: { type: 'string', example: 'Lagos South Branch' },
      location: { type: 'string', example: 'Victoria Island, Lagos' },
      isMain: { type: 'boolean', example: false },
    },
  })
  warehouse: {
    name: string;
    location: string;
    isMain: boolean;
  };

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  constructor(partial: Partial<WarehouseManagerEntity>) {
    Object.assign(this, partial);
  }
}
