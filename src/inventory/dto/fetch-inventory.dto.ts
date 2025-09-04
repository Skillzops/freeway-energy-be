import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryClass } from '@prisma/client';
import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';

export class FetchInventoryQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by Category (Pass in the ID)',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  inventoryCategoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter by Sub Category (Pass in the ID)',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  inventorySubCategoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter by warehouse ID',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter by creation date',
    type: String,
    format: 'date-time',
    example: '',
  })
  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @ApiPropertyOptional({
    description: 'Filter by last update date',
    type: String,
    format: 'date-time',
    example: '',
  })
  @IsOptional()
  @IsDateString()
  updatedAt?: string;

  @ApiPropertyOptional({
    description: 'Filter by class Enum',
    enum: InventoryClass,
    example: '',
  })
  @IsOptional()
  @IsEnum(InventoryClass)
  class?: InventoryClass;

  @ApiPropertyOptional({
    description: 'Search inventory by name, manufacturerName',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page for pagination',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({
    description: 'Sort order (asc or desc)',
    enum: ['asc', 'desc'],
    example: '',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
