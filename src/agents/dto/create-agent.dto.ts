import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from 'src/auth/dto/create-user.dto';
import { AgentCategory } from '@prisma/client';

export class CreateAgentDto extends OmitType(CreateUserDto, ['role', 'email']) {
  @ApiPropertyOptional({
    example: 'john@a4tenergy.com',
    description: 'Email of the agent. If not provided, will be generated automatically',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    example: '1234 Street',
    description: 'Longitude of the location of the agent',
  })
  @IsString()
  @IsOptional()
  longitude?: string;

  @ApiPropertyOptional({
    example: '1234 Street',
    description: 'Latitude of the location of the agent',
  })
  @IsString()
  @IsOptional()
  latitude?: string;

  @ApiProperty({ description: 'agent category', enum: AgentCategory })
  @IsEnum(AgentCategory)
  category?: AgentCategory;
};