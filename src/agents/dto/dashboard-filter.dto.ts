import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { SalesStatus } from '@prisma/client';

export class DashboardFilterDto {
  @ApiPropertyOptional({
    enum: SalesStatus,
    description: 'Filter by sales status',
  })
  @IsOptional()
  @IsEnum(SalesStatus)
  status?: SalesStatus;

//   @ApiPropertyOptional({ description: 'Filter by product type id' })
//   @IsOptional()
//   @IsString()
//   productType?: string;

  @ApiPropertyOptional({
    description: 'Start date for range filter (ISO string)',
  })
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'End date for range filter (ISO string)',
  })
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;
}
