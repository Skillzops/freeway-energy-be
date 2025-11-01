import { ApiPropertyOptional } from '@nestjs/swagger';
import { InstallationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  IsDateString,
  IsEnum,
} from 'class-validator';

export class ListDevicesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by device serialNumber',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    description: 'If true, applies exact match for serialNumber',
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
  isExact?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by device startingCode',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  startingCode?: string;

  @ApiPropertyOptional({
    description: 'Filter by device key',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional({
    description: 'Filter by device hardwareModel',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  hardwareModel?: string;

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
    description: 'Filter devices by usage status: all, used, or unused',
    enum: ['used', 'unused'],
    example: 'unused',
  })
  @IsOptional()
  @IsString()
  @IsIn(['used', 'unused'])
  fetchFormat?: 'used' | 'unused';

  @ApiPropertyOptional({
    description: 'Search devices by name, email, or devicename',
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
    type: Boolean,
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === '1')
  isTokenable?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'installation status',
    enum: InstallationStatus,
  })
  @IsEnum(InstallationStatus)
  @IsOptional()
  installationStatus: InstallationStatus;
}
