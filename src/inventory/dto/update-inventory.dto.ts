import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryClass } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateInventoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() manufacturerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateOfManufacture?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(InventoryClass)
  class?: InventoryClass;
  
  @ApiPropertyOptional() @IsOptional() @IsString() inventoryCategoryId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inventorySubCategoryId?: string;
}
