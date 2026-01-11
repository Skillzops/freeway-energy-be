import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  IsArray,
  MinLength,
  MaxLength,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { InteractionType, InteractionStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateCustomerInteractionDto {
  @ApiProperty({
    description: 'Type of interaction',
    enum: InteractionType,
    example: InteractionType.CALL,
  })
  @IsEnum(InteractionType)
  @IsNotEmpty()
  interactionType: InteractionType;

  @ApiProperty({
    description: 'Short summary of the interaction',
    example: 'Customer called regarding product inquiry',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional({
    description: 'Detailed notes or description of the interaction',
    example:
      'Customer interested in learning more about payment options. Mentioned budget constraints.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    description: 'When the interaction occurred (ISO 8601 format)',
    example: '2025-01-11T10:30:00Z',
  })
  @IsOptional()
  @IsDateString()
  interactionDate?: string;

  @ApiPropertyOptional({
    description: 'Scheduled follow-up date (ISO 8601 format)',
    example: '2025-01-18T10:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((obj) => obj.nextFollowUpDate !== undefined)
  nextFollowUpDate?: string;

  @ApiPropertyOptional({
    description: 'User ID to assign this interaction to',
    example: '507f1f77bcf86cd799439012',
  })
  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @ApiPropertyOptional({
    description: 'Tags for categorizing the interaction',
    example: ['urgent', 'follow-up-needed'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateCustomerInteractionDto extends PartialType(CreateCustomerInteractionDto) {
  @ApiPropertyOptional({
    description: 'Status of the interaction',
    enum: InteractionStatus,
  })
  @IsOptional()
  @IsEnum(InteractionStatus)
  status?: InteractionStatus;
}

export class ListCustomerInteractionsDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of records per page',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filter by interaction type',
    enum: InteractionType,
  })
  @IsOptional()
  @IsEnum(InteractionType)
  interactionType?: InteractionType;

  @ApiPropertyOptional({
    description: 'Filter by interaction status',
    enum: InteractionStatus,
  })
  @IsOptional()
  @IsEnum(InteractionStatus)
  status?: InteractionStatus;

  @ApiPropertyOptional({
    description: 'Search in title and description',
    example: 'customer inquiry',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by tag',
    example: 'urgent',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortField?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
