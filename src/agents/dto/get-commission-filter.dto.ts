import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
// import { PaymentStatus } from '@prisma/client';
import { PaginationQueryDto } from 'src/utils/dto/pagination.dto';

export class GetCommisionFilterDto  extends PaginationQueryDto {
//   @ApiPropertyOptional({
//     enum: PaymentStatus,
//     description: 'Filter by payment status',
//   })
//   @IsOptional()
//   @IsEnum(PaymentStatus)
//   status?: PaymentStatus;

  //   @ApiPropertyOptional({ description: 'Filter by product type id' })
  //   @IsOptional()
  //   @IsString()
  //   productType?: string;

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
}
