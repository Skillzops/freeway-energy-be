import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

export class TransferRequestEntity {
  @ApiProperty({
    description: 'Transfer request ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  id: string;

  @ApiProperty({ description: 'Request identifier', example: 'tr-001' })
  requestId: string;

  @ApiProperty({
    description: 'Source warehouse',
    type: 'object',
    properties: {
      id: { type: 'string', example: '60f1b2b3b3f3b3b3b3f3b3b3' },
      name: { type: 'string', example: 'Main Warehouse' },
      location: { type: 'string', example: 'Lagos, Nigeria' },
    },
  })
  fromWarehouse: {
    id: string;
    name: string;
    location: string;
  };

  @ApiProperty({
    description: 'Destination warehouse',
    type: 'object',
    properties: {
      id: { type: 'string', example: '60f1b2b3b3f3b3b3b3f3b3b4' },
      name: { type: 'string', example: 'Lagos South Branch' },
      location: { type: 'string', example: 'Victoria Island, Lagos' },
    },
  })
  toWarehouse: {
    id: string;
    name: string;
    location: string;
  };

  @ApiProperty({
    description: 'Inventory batch details',
    type: 'object',
    properties: {
      id: { type: 'string', example: '60f1b2b3b3f3b3b3b3f3b3b5' },
      batchNumber: { type: 'number', example: 1001 },
      price: { type: 'number', example: 50000 },
      remainingQuantity: { type: 'number', example: 100 },
    },
  })
  inventoryBatch: {
    id: string;
    batchNumber: number;
    price: number;
    remainingQuantity: number;
    inventory: {
      name: string;
      manufacturerName: string;
    };
  };

  @ApiProperty({ description: 'Requested quantity', example: 10 })
  requestedQuantity: number;

  @ApiProperty({ description: 'Fulfilled quantity', example: 8 })
  fulfilledQuantity: number;

  @ApiProperty({
    description: 'Request status',
    enum: TransferStatus,
    example: 'PARTIAL',
  })
  status: TransferStatus;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Urgent request',
  })
  notes?: string;

  @ApiProperty({
    description: 'Requested by user',
    type: 'object',
    properties: {
      firstname: { type: 'string', example: 'John' },
      lastname: { type: 'string', example: 'Doe' },
      email: { type: 'string', example: 'john.doe@example.com' },
    },
  })
  requestedBy?: {
    firstname: string;
    lastname: string;
    email: string;
  };

  @ApiProperty({
    description: 'Fulfilled by user',
    type: 'object',
    properties: {
      firstname: { type: 'string', example: 'Jane' },
      lastname: { type: 'string', example: 'Smith' },
      email: { type: 'string', example: 'jane.smith@example.com' },
    },
  })
  fulfilledBy?: {
    firstname: string;
    lastname: string;
    email: string;
  };

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

  constructor(partial: Partial<TransferRequestEntity>) {
    Object.assign(this, partial);
  }
}
