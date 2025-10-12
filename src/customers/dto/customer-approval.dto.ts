import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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
