import {
  IsOptional,
  IsEnum,
  IsEmail,
  ValidateIf,
  IsNumberString,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from 'src/auth/dto/create-user.dto';
import { AgentCategory } from '@prisma/client';

export class CreateAgentDto extends OmitType(CreateUserDto, ['role', 'email']) {
  @ApiPropertyOptional({
    example: 'john@a4tenergy.com',
    description:
      'Email of the agent. If not provided, will be generated automatically',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    example: '1234 Street',
    description: 'Longitude of the location of the agent',
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

  @ApiPropertyOptional({
    example: '1234 Street',
    description: 'Latitude of the location of the agent',
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

  @ApiProperty({ description: 'agent category', enum: AgentCategory })
  @IsEnum(AgentCategory)
  category?: AgentCategory;
}
