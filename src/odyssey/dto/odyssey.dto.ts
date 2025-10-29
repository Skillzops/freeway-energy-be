import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator';

export class OdysseyPaymentDto {
  @ApiProperty({
    description: 'Time of payment in UTC timezone using ISO 8601 format',
    example: '2021-05-16T14:16:01.350Z',
    format: 'date-time',
  })
  @IsString()
  timestamp: string;

  @ApiProperty({
    description: 'Amount of transaction',
    example: 5000,
    type: 'number',
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'The currency of the transaction',
    example: 'Naira',
  })
  @IsString()
  currency: string;

  @ApiProperty({
    description: 'Type of transaction',
    enum: [
      'FULL_PAYMENT',
      'INSTALLMENT_PAYMENT',
      'NON_CONTRACT_PAYMENT',
      'DISCOUNT',
      'REVERSAL',
      'ENERGY_CREDIT',
    ],
    example: 'FULL_PAYMENT',
  })
  @IsString()
  transactionType: string;

  @ApiProperty({
    description: 'An ID unique to the transaction',
    example: 'managepayments.com-transaction-001',
  })
  @IsString()
  transactionId: string;

  @ApiProperty({
    description:
      'The serial number of the SHS device. Returns "N/A" if not available.',
    example: '001A-001-1234',
  })
  @IsString()
  serialNumber: string;

  @ApiProperty({
    description:
      'The serial number of the SHS device. Returns "N/A" if not available.',
    example: '001A-001-1234',
  })
  @IsString()
  meterId: string;

  @ApiProperty({
    description: 'The customer ID of the user of the device',
    example: 'customer-565',
  })
  @IsString()
  customerId: string;

  @ApiPropertyOptional({
    description: 'Name of the user of the device',
    example: 'Example SHS Customer 1',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    description: 'Phone number of the user of the device',
    example: '+234 0814 731 5678',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    description: 'Category of the customer who uses the device',
    example: 'Residential',
    enum: ['Public', 'Prepaid', 'Residential', 'Commercial', 'Business'],
  })
  @IsOptional()
  @IsString()
  customerCategory?: string;

  @ApiPropertyOptional({
    description: 'ID specific to the financing provider or program',
    example: 'REA_NEP_OBF',
    enum: ['REA_NEP_PBG', 'REA_NEP_OBF', 'BRILHO_SHS', 'UEF_SSPU'],
  })
  @IsOptional()
  @IsString()
  financingId?: string;

  @ApiPropertyOptional({
    description: 'The agent facilitating the transaction',
    example: 'managepayments.com-agent-001',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Latitude of the location of the device',
    example: '6.465422',
  })
  @IsOptional()
  @IsString()
  latitude?: string;

  @ApiPropertyOptional({
    description: 'Longitude of the location of the device',
    example: '3.406448',
  })
  @IsOptional()
  @IsString()
  longitude?: string;

  @ApiPropertyOptional({
    description: 'A unique ID for utility',
    example: '4676739',
  })
  @IsOptional()
  @IsString()
  utilityId?: string;

  @ApiPropertyOptional({
    description:
      'Number of instances where batteries fail to reach capacity limit',
    example: 0,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  failedBatteryCapacityCount?: number;
}

export class OdysseyPaymentResponseDto {
  @ApiProperty({
    description: 'Array of payment records',
    type: [OdysseyPaymentDto],
  })
  payments: OdysseyPaymentDto[];

  @ApiProperty({
    description: 'Description of any errors explaining the lack of results',
    example: '',
  })
  @IsString()
  errors: string;
}

export class OdysseyPaymentQueryDto {
  @ApiProperty({
    description: 'Start of date range (ISO 8601 format in UTC)',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsDateString()
  from: Date;

  @ApiProperty({
    description: 'End of date range (ISO 8601 format in UTC)',
    example: '2024-01-02T00:00:00.000Z',
  })
  @IsDateString()
  to: Date;

  @ApiPropertyOptional({
    description: 'Optional financing program ID filter',
    example: 'REA_NEP_OBF',
  })
  @IsOptional()
  @IsString()
  financingId?: string;

  @ApiPropertyOptional({
    description: 'Optional site ID filter',
  })
  @IsOptional()
  @IsString()
  siteId?: string;

  @ApiPropertyOptional({
    description: 'Optional country filter',
    example: 'NG',
  })
  @IsOptional()
  @IsString()
  country?: string;
}

export class GenerateTokenDto {
  @ApiProperty({
    description: 'Name of the client for whom the token is being generated',
    example: 'SHS Global Nigeria',
  })
  @IsString()
  clientName: string;

  @ApiPropertyOptional({
    description: 'Number of days until token expires (default: 365)',
    example: 365,
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @IsNumber()
  expirationDays?: number;
}

export class TokenResponseDto {
  @ApiProperty({
    description: 'Generated API token',
    example: 'e25080c723345c3bbd0095f21a4f9efa808051a99c33a085415258535',
  })
  token: string;

  @ApiProperty({
    description: 'Client name',
    example: 'SHS Global Nigeria',
  })
  clientName: string;

  @ApiProperty({
    description: 'Token expiration date',
    example: '2025-01-01T00:00:00.000Z',
  })
  expiresAt: Date;

  @ApiProperty({
    description: 'Token creation date',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt: Date;
}
