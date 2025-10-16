import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AgentVerificationDto {
  @ApiProperty({
    description: 'Agent phone number',
    example: '2348012345678',
    required: false,
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Agent email',
    example: 'agent@example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({
    description: 'Agent user ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
