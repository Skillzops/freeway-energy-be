import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InstallationStatus } from '@prisma/client';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';

export class UpdateDeviceDto {
  @ApiProperty({ description: 'Serial number of the device', required: false })
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @ApiProperty({
    description: 'Key associated with the device',
    required: false,
  })
  @IsString()
  @IsOptional()
  key?: string;

  @ApiProperty({ description: 'Optional starting code', required: false })
  @IsString()
  @IsOptional()
  startingCode?: string;

  @ApiProperty({ description: 'Optional count', required: false })
  @IsString()
  @IsOptional()
  count?: string;

  @ApiProperty({ description: 'Optional time divider', required: false })
  @IsString()
  @IsOptional()
  timeDivider?: string;

  @ApiProperty({ description: 'Restricted digit mode', required: false })
  @IsBoolean()
  @IsOptional()
  restrictedDigitMode?: boolean;

  @ApiProperty({ description: 'Optional hardware model', required: false })
  @IsString()
  @IsOptional()
  hardwareModel?: string;

  @ApiProperty({ description: 'Optional firmware version', required: false })
  @IsString()
  @IsOptional()
  firmwareVersion?: string;

  @ApiProperty({
    description: 'Whether the device can generate tokens',
    required: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isTokenable?: boolean;
}

export class UpdateDeviceStatusDto {
  @ApiProperty({ description: 'installation status', enum: InstallationStatus })
  @IsEnum(InstallationStatus)
  @IsNotEmpty()
  installationStatus: InstallationStatus;
}

export class UpdateDeviceLocationDto {
  @ApiProperty({
    description: 'The location of the device installation',
    example: 'New York, USA',
  })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiPropertyOptional({
    description: 'The longitude of the installation',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  longitude?: string;

  @ApiPropertyOptional({
    description: 'The latitude of the installation',
    type: String,
    example: '',
  })
  @IsOptional()
  @IsString()
  latitude?: string;
}
