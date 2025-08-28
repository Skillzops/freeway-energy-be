import { IsArray } from 'class-validator';
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

export class AssignAgentInstallerssDto {
  @ApiProperty({ description: 'An array of installer IDs to assign to agent' })
  @IsArray()
  installerIds: string[];
}
