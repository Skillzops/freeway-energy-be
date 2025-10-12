import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { UserStatus, CustomerType, IDType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsEnum,
  IsDateString,
} from 'class-validator';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by user firstname',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  firstname?: string;

  @ApiPropertyOptional({
    description: 'Filter by user lastname',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  lastname?: string;

  @ApiPropertyOptional({
    description: 'Filter by user email',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'Filter by user phone number',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Filter by alternate phone number',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @ApiPropertyOptional({
    description: 'Filter by gender',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({
    description: 'Filter by user location',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    description: 'Filter by installation address',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  installationAddress?: string;

  @ApiPropertyOptional({
    description: 'Filter by LGA',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  lga?: string;

  @ApiPropertyOptional({
    description: 'Filter by state',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description: 'Filter by user status',
    enum: UserStatus,
    example: '',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
    example: 'agent-id-123',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer type',
    enum: CustomerType,
    example: '',
  })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({
    description: 'Filter by ID type',
    enum: IDType,
    example: '',
  })
  @IsOptional()
  @IsEnum(IDType)
  idType?: IDType;

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
    description: 'Search users by name, email, or phone',
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
    description:
      'Filter for customers created in the last 7 days e.g `true` or `1`',
    type: Boolean,
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === '1')
  isNew?: boolean;

  @ApiPropertyOptional({
    description: 'Filter for customers rejected',
    type: Boolean,
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === '1')
  isRejected?: boolean;

  @ApiPropertyOptional({
    description: 'Filter for customers approved',
    type: Boolean,
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === '1')
  isApproved?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter for pending customers (awaiting approval)',
    type: Boolean,
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === '1')
  isPending?: boolean;
}

export class ListAgentCustomersQueryDto extends OmitType(
  ListCustomersQueryDto,
  ['agentId'],
) {}
