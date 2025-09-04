import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class AssignWarehouseManagerDto {
  @ApiProperty({
    description: 'User IDs to assign as warehouse managers',
    example: ['60f1b2b3b3f3b3b3b3f3b3b3'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];
}