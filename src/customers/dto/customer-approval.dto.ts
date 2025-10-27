import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';
import { ApprovalStatus } from '@prisma/client';

export class ApproveCustomerDto {
  @ApiProperty({
    description: 'Approve or reject the customer',
    example: true,
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({
    description: 'Reason for rejection (required if approve is false)',
    example: 'Incomplete documentation',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class BulkApproveCustomersDto {
  @ApiProperty({
    description: 'Array of customer IDs to approve',
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
    type: [String],
  })
  customerIds: string[];

  @ApiProperty({
    description: 'Approve or reject the customers',
    example: true,
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({
    description: 'Reason for bulk rejection',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class ResubmitCustomerDto extends PartialType(CreateCustomerDto) {}

export class GetCustomerRejectionDto {
  @ApiProperty({
    description: 'Customer ID',
  })
  id: string;

  @ApiProperty({
    description: 'Current approval status',
    enum: ApprovalStatus,
  })
  approvalStatus: ApprovalStatus;

  @ApiProperty({
    description: 'Latest rejection reason',
  })
  rejectionReason: string;

  @ApiProperty({
    description: 'When it was rejected',
  })
  rejectedAt: Date;

  @ApiProperty({
    description: 'How many times has been resubmitted',
  })
  resubmissionCount: number;

  @ApiProperty({
    description: 'Rejection history',
    type: [Object],
  })
  rejectionHistory: Array<{
    rejectionReason: string;
    rejectedAt: Date;
    resubmittedAt?: Date;
  }>;
}

export class ListRejectedCustomersDto {
  @ApiPropertyOptional({
    description: 'Search by customer name or email',
    type: String,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    type: String,
    example: 'rejectedAt',
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Page number',
    type: String,
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Items per page',
    type: String,
  })
  @IsOptional()
  @IsString()
  limit?: string;
}
