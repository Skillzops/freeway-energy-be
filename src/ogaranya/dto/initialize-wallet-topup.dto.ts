import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class InitializeWalletTopUpDto {
  @ApiProperty({
    description:
      'Agent identifier (phone, email, userId, or ogaranyaAccountNumber)',
    example: '2348012345678',
  })
  @IsNotEmpty()
  @IsString()
  agentIdentifier: string;

  @ApiProperty({
    description: 'Top-up amount in Naira',
    example: 5000,
    minimum: 100,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(100, { message: 'Minimum top-up amount is ₦100' })
  amount: number;

  @ApiProperty({
    description: 'Description for the transaction',
    example: 'Wallet top-up via Ogaranya',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class WalletTopUpDto {
  @ApiProperty({ description: 'Unique order reference for the transaction' })
  @IsNotEmpty()
  @IsString()
  orderReference: string;

  @ApiProperty({ description: 'Amount paid as a string (e.g., "1000")' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({ description: 'Unique topup reference for the transaction' })
  @IsNotEmpty()
  @IsString()
  topupReference: string;

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
