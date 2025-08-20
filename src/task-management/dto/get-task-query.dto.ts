import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TaskStatus } from '@prisma/client';

export class GetTaskQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of products per page',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by installer ID',
  })
  @IsOptional()
  @IsString()
  installerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer ID',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Search product by name, description',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  search?: string;

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

  @ApiPropertyOptional({
    description: 'task status',
    enum: TaskStatus,
    example: '',
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  @IsString()
  status?: TaskStatus;
}

export class GetAgentTaskQueryDto extends GetTaskQueryDto {}
