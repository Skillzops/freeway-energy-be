import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResetAgentPasswordDto {
  @ApiProperty({
    example: '52520059',
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
