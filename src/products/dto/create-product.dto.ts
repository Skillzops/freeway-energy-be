import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObjectId } from 'class-validator-mongo-object-id';
import { Transform, Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';

export class ProductInventoryDetailsDto {
  @ApiProperty({
    description: 'Inventory ID.',
    example: '507f191e810c19729de860ea',
  })
  @IsNotEmpty()
  @IsString()
  @IsObjectId({
    message: 'Invalid Inventory Id',
  })
  @Transform(({ value }) => {
    // Handle both string and object cases
    console.log({ value });
    if (typeof value === 'object' && value.inventoryId) {
      return value.inventoryId;
    }
    return value;
  })
  inventoryId: string;

  @ApiProperty({
    description: 'Quantity',
    example: '100',
  })
  @IsNumber()
  @Transform(({ value }) => {
    const parsedValue = Number(value);
    if (isNaN(parsedValue)) {
      throw new BadRequestException('Quantity must be a valid number.');
    }
    return parsedValue;
  })
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Name of the product' })
  name: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Optional description of the product' })
  description?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    default: 'NGN',
    description: 'Currency of the product',
  })
  currency: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Payment modes for the product. The distinct payment modes should be concatenated together and separated by comma',
  })
  paymentModes: string;

  @IsString()
  @IsNotEmpty()
  @IsObjectId({
    message: 'Invalid Product Category',
  })
  @ApiProperty({ description: 'Product category Id of the product' })
  categoryId: string;

  @ApiProperty({
    description: 'An array of inventory details for this product.',
    type: ProductInventoryDetailsDto,
    required: true,
    isArray: true,
    default: [
      {
        inventoryId: '6745ba5dfe24f6583d4e5d3b',
        quantity: 100,
      },
    ],
  })
  @IsArray()
  @IsNotEmpty()
  @Transform(({ value }) => {
    try {
      const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(parsedValue)) {
        throw new Error('Value must be an array');
      }
      return parsedValue;
    } catch (error) {
      console.log({ error });
      throw new BadRequestException('Invalid format for inventories array');
    }
  })
  // @ValidateNested({ each: true })
  @Type(() => ProductInventoryDetailsDto)
  inventories: ProductInventoryDetailsDto[];

  @ApiProperty({ type: 'file', description: 'Product image file' })
  productImage: Express.Multer.File;

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
