import { ApiPropertyOptional } from '@nestjs/swagger';
import { WalletTransactionType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from 'src/utils/dto/pagination.dto';

export class GetWalletTransactionsQuery extends PaginationQueryDto {
  @IsEnum(WalletTransactionType)
  @ApiPropertyOptional({
    enum: WalletTransactionType,
    description: 'Filter by transaction type',
  })
  @IsOptional()
  type?: WalletTransactionType;
}
