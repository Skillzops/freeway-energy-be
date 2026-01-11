import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
    description: 'Number of records per page',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    description:
      'Search by task description, installation address, customer name/phone',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by requesting agent ID(s)',
    example: 'agent123',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by multiple requesting agent IDs (comma-separated)',
    example: 'agent1,agent2,agent3',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  })
  @IsArray()
  @IsString({ each: true })
  agentIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by installer agent ID(s) (comma-separated)',
    example: 'installer1,installer2',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  })
  @IsArray()
  @IsString({ each: true })
  installerIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by installer agent ID',
    example: 'installer123',
  })
  @IsOptional()
  @IsString()
  installerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer ID',
    example: 'customer123',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by task status',
    enum: TaskStatus,
    example: TaskStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['createdAt', 'scheduledDate', 'status'],
  })
  @IsOptional()
  @IsString()
  sortField?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order (asc or desc)',
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'Filter tasks created from this date (YYYY-MM-DD)',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks created until this date (YYYY-MM-DD)',
    example: '2025-01-31',
  })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks with due date from (YYYY-MM-DD)',
    example: '2025-01-15',
  })
  @IsOptional()
  @IsString()
  dueDateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks with due date until (YYYY-MM-DD)',
    example: '2025-02-15',
  })
  @IsOptional()
  @IsString()
  dueDateTo?: string;
}

export class GetAgentTaskQueryDto extends GetTaskQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by assign assignment',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string')
      return value.toLowerCase() === 'true' || value === '1';
    return false;
  })
  isAssigned?: boolean;
}
