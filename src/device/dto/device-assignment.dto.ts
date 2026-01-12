import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceAssignmentBatchMode } from '@prisma/client';

export class AssignDeviceDto {
  @ApiProperty({ description: 'Device serial number' })
  @IsString()
  deviceSerial: string;

  @ApiProperty({ description: 'Sales Agent ID' })
  @IsString()
  agentId: string;

  @ApiPropertyOptional({ description: 'Reason for assignment' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkAssignDevicesDto {
  @ApiProperty({
    description: 'Array of device serial numbers',
    example: ['SR27/SR/2501202191', 'SR27/SR/2501202194'],
  })
  @IsArray()
  @IsString({ each: true })
  deviceSerials: string[];

  @ApiProperty({ description: 'Agent ID' })
  @IsString()
  agentId: string;

  @ApiPropertyOptional({
    description:
      'Operation mode (ATOMIC: add all devices or nothing if a single device assignment fails, PARTIAL: best effort)',
    enum: DeviceAssignmentBatchMode,
    default: DeviceAssignmentBatchMode.ATOMIC,
  })
  @IsOptional()
  @IsEnum(DeviceAssignmentBatchMode)
  mode?: DeviceAssignmentBatchMode;

  @ApiPropertyOptional({ description: 'Reason for bulk assignment' })
  @IsOptional()
  @IsString()
  reason?: string;
}