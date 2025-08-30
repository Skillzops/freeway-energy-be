import { IsNotEmpty, IsString } from 'class-validator';

export class AssignInstallerDto {
  @IsString()
  @IsNotEmpty()
  installerAgentId: string;
}
