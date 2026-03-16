import { IsString, IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SalesDonationDeviceDto {
  @ApiProperty({
    description: 'Device serial number',
    example: 'SR27/SR/2504200739',
  })
  @IsString()
  serialNumber: string;

  @ApiProperty({
    description: 'Agent ID who facilitated the donation',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  agentId: string;
}

/**
 * Create police station donation sale
 * Admin only endpoint
 */
export class CreateDonationSaleDto {
  @ApiProperty({
    description: 'Police station name',
    example: 'Demsa Police Station',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'State where police station is located',
    example: 'Adamawa',
  })
  @IsString()
  state: string;

  @ApiProperty({
    description: 'LGA/District where police station is located',
    example: 'Demsa',
  })
  @IsString()
  lga: string;

  @ApiProperty({
    description: 'Array of devices to donate (one sale per device)',
    type: [SalesDonationDeviceDto],
    example: [
      {
        serialNumber: 'SR27/SR/2504200739',
        agentId: '507f1f77bcf86cd799439011',
      },
    ],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one device must be provided' })
  devices: SalesDonationDeviceDto[];
}

/**
 * Response DTO for police donation sale
 */
export class DonationSaleResponseDto {
  id: string;
  formattedSaleId: string;
  status: 'DONATION';
  totalPrice: 0;
  totalPaid: 0;
  customer: {
    id: string;
    firstname: string;
    lastname: string;
  };
  saleItems: Array<{
    id: string;
    deviceSerial: string;
    device: {
      id: string;
      serialNumber: string;
    };
  }>;
  createdAt: Date;
}

export class BatchDonationResponseDto {
  success: boolean;
  message: string;
  totalDevices: number;
  createdSales: number;
  failedDevices: Array<{
    serialNumber: string;
    agentId: string;
    reason: string;
  }>;
  sales: DonationSaleResponseDto[];
  summary: {
    name: string;
    state: string;
    lga: string;
    devicesGranted: number;
    totalSales: number;
    createdAt: Date;
  };
}
