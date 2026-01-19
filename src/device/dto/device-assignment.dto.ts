import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignDeviceDto {
  @ApiProperty({
    description: 'Device serial number',
  })
  @IsString()
  deviceSerial: string;

  @ApiProperty({
    description: 'Agent ID (Sales Agent)',
  })
  @IsString()
  agentId: string;

  @ApiPropertyOptional({
    description: 'Reason for assignment',
    example: 'Initial inventory assignment',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReassignDeviceDto {
  @ApiProperty({
    description: 'Device ID',
    example: 'dev-123',
  })
  @IsString()
  deviceId: string;

  @ApiProperty({
    description: 'Source Agent ID (current owner)',
    example: 'agent-old-123',
  })
  @IsString()
  fromAgentId: string;

  @ApiProperty({
    description: 'Target Agent ID (new owner)',
    example: 'agent-new-456',
  })
  @IsString()
  toAgentId: string;

  @ApiPropertyOptional({
    description: 'Reason for reassignment',
    example: 'Agent transferred to different territory',
  })
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

  @ApiProperty({
    description: 'Agent ID (Sales Agent)',
    example: 'agent-123',
  })
  @IsString()
  agentId: string;

  @ApiPropertyOptional({
    description:
      'Operation mode - ATOMIC: all or nothing, PARTIAL: best effort',
    enum: ['ATOMIC', 'PARTIAL'],
    default: 'ATOMIC',
  })
  @IsOptional()
  @IsEnum(['ATOMIC', 'PARTIAL'])
  mode?: 'ATOMIC' | 'PARTIAL';

  @ApiPropertyOptional({
    description: 'Reason for bulk assignment',
    example: 'Monthly inventory allocation',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
