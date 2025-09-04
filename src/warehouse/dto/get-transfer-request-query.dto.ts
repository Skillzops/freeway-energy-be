import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { TransferStatus } from '@prisma/client';
import { PaginationQueryDto } from 'src/utils/dto/pagination.dto';

export class GetTransferRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by transfer status',
    example: 'PENDING',
    enum: TransferStatus,
  })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  @ApiPropertyOptional({
    description: 'Filter by from warehouse ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b3',
  })
  @IsOptional()
  @IsString()
  fromWarehouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter by to warehouse ID',
    example: '60f1b2b3b3f3b3b3b3f3b3b4',
  })
  @IsOptional()
  @IsString()
  toWarehouseId?: string;

  @ApiPropertyOptional({
    description: 'Search term for inventory item name',
    example: 'Solar Panel',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortField?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'desc',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
