import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import {
  SalesStatus,
  AgentCategory,
  PaymentStatus,
  UserStatus,
} from '@prisma/client';

export class AdminDashboardFilterDto {
  @ApiPropertyOptional({
    enum: SalesStatus,
    description: 'Filter by sales status',
  })
  @IsOptional()
  @IsEnum(SalesStatus)
  status?: SalesStatus;

  @ApiPropertyOptional({
    description: 'Filter by product category ID',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: AgentCategory,
    description: 'Filter by agent category',
  })
  @IsOptional()
  @IsEnum(AgentCategory)
  agentCategory?: AgentCategory;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter by payment status',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    enum: UserStatus,
    description: 'Filter by user status',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  userStatus?: UserStatus;

  @ApiPropertyOptional({
    description: 'Start date for range filter (ISO string)',
  })
  @IsOptional()
  @Type(() => Date)
  startDate?: Date;

  @ApiPropertyOptional({
    description: 'End date for range filter (ISO string)',
  })
  @IsOptional()
  @Type(() => Date)
  endDate?: Date;

  @ApiPropertyOptional({
    description: 'Filter by specific agent ID',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific warehouse ID',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;
}
