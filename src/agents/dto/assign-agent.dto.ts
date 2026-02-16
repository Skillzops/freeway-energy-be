import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignAgentProductsDto {
  @ApiProperty({ description: 'An array of product IDs to assign to agent' })
  @IsArray()
  productIds: string[];
}

export class AssignAgentCustomersDto {
  @ApiProperty({ description: 'An array of customer IDs to assign to agent' })
  @IsArray()
  customerIds: string[];
}


export class ReassignAgentCustomersDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID of the agent to assign customers to',
    example: '507f1f77bcf86cd799439011',
  })
  toAgentId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ApiProperty({
    description: 'Array of customer IDs to reassign',
    example: ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'],
  })
  customerIds: string[];

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Reason for reassignment',
    example: 'Agent transferred to different region',
  })
  reason?: string;
}

export class AssignAgentInstallerssDto {
  @ApiProperty({ description: 'An array of installer IDs to assign to agent' })
  @IsArray()
  installerIds: string[];
}
