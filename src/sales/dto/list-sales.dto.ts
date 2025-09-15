import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { IsOptional, IsEnum, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../utils/dto/pagination.dto';

export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by payment method',
    enum: PaymentMethod,
    example: 'CASH',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Filter by agent ID',
    example: 'agent-id-123',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description:
      'Search across multiple fields (customer name, phone, serial number, product name, sale ID)',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListAgentSalesQueryDto extends OmitType(ListSalesQueryDto, [
  'agentId',
]) {}
