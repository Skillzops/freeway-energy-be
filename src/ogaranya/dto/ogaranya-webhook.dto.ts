import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class OgaranyaWebhookDto {
  @ApiProperty({ description: 'Unique order reference for the transaction' })
  @IsNotEmpty()
  @IsString()
  order_reference: string;

  @ApiPropertyOptional({
    description: 'Serial number of the solar product, if available',
  })
  @IsOptional()
  @IsString()
  solar_serial_number?: string;

  @ApiProperty({ description: 'Amount paid as a string (e.g., "1000")' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({
    description:
      'Status code representing payment result (e.g., "00" for success)',
  })
  @IsNotEmpty()
  @IsString()
  statusCode: string;

  @ApiProperty({
    description: 'Date and time the payment was made (ISO 8601 format)',
  })
  @IsNotEmpty()
  @IsDateString()
  payDate: string;

  @ApiProperty({
    description: 'Status message or description from the gateway',
  })
  @IsNotEmpty()
  @IsString()
  statusMsg: string;
}
