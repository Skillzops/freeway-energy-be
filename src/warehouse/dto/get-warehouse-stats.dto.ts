import { ApiProperty } from '@nestjs/swagger';

export class WarehouseStatsDto {
  @ApiProperty({ description: 'Total number of warehouses', example: 5 })
  totalWarehouses: number;

  @ApiProperty({ description: 'Number of active warehouses', example: 4 })
  activeWarehouses: number;

  @ApiProperty({ description: 'Number of inactive warehouses', example: 1 })
  inactiveWarehouses: number;

  @ApiProperty({ description: 'Number of main warehouses', example: 1 })
  mainWarehouses: number;

  @ApiProperty({ description: 'Number of subsidiary warehouses', example: 4 })
  subsidiaryWarehouses: number;

  @ApiProperty({ description: 'Total pending transfer requests', example: 12 })
  pendingTransferRequests: number;
}
