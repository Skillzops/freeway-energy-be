import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AssignInstallerDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID of the installer agent to assign the task to',
  })
  installerAgentId: string;
}
