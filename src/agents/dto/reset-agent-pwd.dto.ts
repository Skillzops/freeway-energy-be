import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResetAgentPasswordDto {
  @ApiProperty({
    example: '69b32f1a8cd1df4767d6377f',
    description: 'Agent ID',
  })
  @IsNotEmpty()
  @IsString()
  agentId: string;

  @ApiProperty({
    example: 'AdminCurrentPassword123',
    description: 'Admin current password',
  })
  @IsNotEmpty()
  @IsString()
  adminPassword: string;
}
