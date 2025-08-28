import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { AgentCategory, UserStatus } from '@prisma/client';

export class GetAgentsDto {
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

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Search agent by name, address, long., lat.',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'agent category', enum: AgentCategory })
  @IsOptional()
  @IsEnum(AgentCategory)
  category?: AgentCategory;

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

  @ApiPropertyOptional({ description: 'Filter by creation date (ISO format)' })
  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @ApiPropertyOptional({
    description: 'Filter by last update date (ISO format)',
  })
  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}

export class GetAgentsInstallersDto extends OmitType(GetAgentsDto, [
  'category',
]) {}
