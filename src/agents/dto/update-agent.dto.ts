import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, MinLength } from 'class-validator';

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
  @IsString()
  @IsOptional()
  latitude?: string;

  @ApiPropertyOptional({
    example: '3.3792',
    description: 'Longitude of the agent location',
  })
  @IsString()
  @IsOptional()
  longitude?: string;
}
