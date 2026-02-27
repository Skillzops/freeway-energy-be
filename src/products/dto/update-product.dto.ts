import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentModes?: string;

  @ApiPropertyOptional({
    description: 'Default installment duration in months',
    example: 12,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  defaultInstallmentDuration?: number;

  @ApiPropertyOptional({
    description: 'Default installment starting/deposit price',
    example: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  defaultInstallmentStartPrice?: number;

  @ApiPropertyOptional({
    description: 'Default monthly payment amount',
    example: 6000,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  defaultMonthlyPayment?: number;
}
