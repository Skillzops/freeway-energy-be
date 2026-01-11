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
    description: 'Filter by creator - user ID (user who created the sale)',
  })
  @IsOptional()
  @IsString()
  creatorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by customer ID',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Search across multiple fields (customer name, phone, serial number, product name, formattedSaleId)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Filter sales created from this date (ISO 8601 format: YYYY-MM-DD or full ISO string)',
    example: '2025-01-01',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Filter sales created until this date (ISO 8601 format: YYYY-MM-DD or full ISO string)',
    example: '2025-01-31',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Search by formatted sale ID (e.g., SAL-250111-A1B2C)',
    example: 'SAL-250111-A1B2C',
  })
  @IsOptional()
  @IsString()
  formattedSaleId?: string;
}

export class ListAgentSalesQueryDto extends OmitType(ListSalesQueryDto, [
  'agentId',
]) {}
