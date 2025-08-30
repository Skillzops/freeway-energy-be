import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ description: 'ID of the sale associated with the task' })
  @IsString()
  @IsNotEmpty()
  saleId: string;

  // @ApiPropertyOptional({
  //   description: 'ID of the customer related to the task (Optional)',
  // })
  // @IsString()
  // @IsOptional()
  // customerId?: string;

  // @ApiProperty({
  //   description: 'ID of the assigned installer agent',
  // })
  // @IsString()
  // installerAgentId: string;

  @ApiPropertyOptional({ description: 'Description of the task (optional)' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Pickup location for the task (optional)',
  })
  @IsString()
  @IsOptional()
  pickupLocation?: string;

  @ApiPropertyOptional({
    description: 'Scheduled date for the task (ISO string)',
    example: '2025-08-01T14:30:00Z',
  })
  @IsDateString()
  @IsOptional()
  scheduledDate?: string;
}
