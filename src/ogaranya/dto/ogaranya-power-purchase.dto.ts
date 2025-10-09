import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class PowerPurchaseDto {
  @ApiProperty({
    description: 'Device serial number',
    example: 'SN123456789',
  })
  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @ApiProperty({ description: 'Amount paid as a string (e.g., "1000")' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Order reference from Ogaranya',
    example: 'ORD-ABC123',
  })
  @IsString()
  @IsNotEmpty()
  orderReference: string;
}

export class DevicePaymentDto {
  @ApiProperty({
    description: 'Device serial number',
    example: 'SN123456789',
  })
  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @ApiProperty({ description: 'Amount paid as a string (e.g., "1000")' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Order reference from Ogaranya',
    example: 'ORD-ABC123',
  })
  @IsString()
  @IsNotEmpty()
  orderReference: string;

  @ApiProperty({
    description: 'Payment date',
    example: '2025-01-15T10:30:00Z',
  })
  @IsString()
  @IsNotEmpty()
  @IsDateString()
  paymentDate: string;
}

export class SerialNumberDto {
  @ApiProperty({
    description: 'Device serial number',
    example: 'SN123456789',
  })
  @IsString()
  @IsNotEmpty()
  serialNumber: string;
}
