import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsString } from "class-validator";

export class CollapseDuplicateAgentRecordsDto {
  @ApiProperty({ description: 'Correct Agent ID' })
  @IsString()
  agentId: string;

  @ApiProperty({ description: 'Duplicate Agent IDs' })
  @IsArray()
  duplicateAgentIds: string[];
}
