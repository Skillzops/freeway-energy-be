import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditActions } from '@prisma/client';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { PaginationQueryDto } from 'src/utils/dto/pagination.dto';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by action',
    example: AuditActions.PATCH,
  })
  @IsOptional()
  @IsString()
  action?: AuditActions;

  @ApiPropertyOptional({
    description: 'Filter by user ID',
    example: '42',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO format)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO format)',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
