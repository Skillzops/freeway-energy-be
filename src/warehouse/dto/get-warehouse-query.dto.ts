import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { PaginationQueryDto } from 'src/utils/dto/pagination.dto';

export class GetWarehousesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term for warehouse name or location',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by main warehouse status',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'name',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortField?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'asc',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
