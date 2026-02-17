import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEmail,
  MinLength,
  ValidateIf,
  IsNumberString,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateAgentDto {
  @ApiPropertyOptional({
    example: 'John',
    description: 'First name of the agent',
  })
  @IsString()
  @IsOptional()
  @MinLength(2)
  firstname?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'Last name of the agent',
  })
  @IsString()
  @IsOptional()
  @MinLength(2)
  lastname?: string;

  @ApiPropertyOptional({
    example: 'john.doe@example.com',
    description: 'Email of the agent (must be unique)',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    example: '2349062736182',
    description: 'Phone number of the agent',
  })
  @IsString()
  @IsOptional()
  @MinLength(5)
  phone?: string;

  @ApiPropertyOptional({
    example: 'Abuja, Nigeria',
    description: 'Location/address of the agent',
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({
    example: 'HOME',
    description: 'Type of address (e.g., HOME, OFFICE, OTHER)',
  })
  @IsString()
  @IsOptional()
  addressType?: string;

  @ApiPropertyOptional({
    example: '6.5244',
    description: 'Latitude of the agent location',
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

  @ApiPropertyOptional({
    example: '3.3792',
    description: 'Longitude of the agent location',
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
  @IsNumberString(
    {},
    { message: 'longitude must be a valid coordinate (numeric)' },
  )
  longitude?: string;
}
