import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InstallationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  ValidateIf,
  IsNumberString,
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
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value;
    const cleaned = String(value)
      .replace(/[°'"]\s*/g, '')
      .trim();
    // If it's not a number, we return the original so the validator fails later
    return isNaN(Number(cleaned)) ? 'INVALID_COORD' : cleaned;
  })
  // Only validate if it's not empty/null
  @ValidateIf(
    (o) =>
      o.longitude !== undefined && o.longitude !== null && o.longitude !== '',
  )
  @IsNumberString({}, { message: 'longitude must be a valid coordinate (numeric)' })
  longitude?: string;

  @ApiPropertyOptional({
    description: 'The latitude of the installation',
    type: String,
    example: '',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value;
    const cleaned = String(value)
      .replace(/[°'"]\s*/g, '')
      .trim();
    return isNaN(Number(cleaned)) ? 'INVALID_COORD' : cleaned;
  })
  @ValidateIf(
    (o) => o.latitude !== undefined && o.latitude !== null && o.latitude !== '',
  )
  @IsNumberString(
    {},
    { message: 'latitude must be a valid coordinate (numeric)' },
  )
  latitude?: string;
}
