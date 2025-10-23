import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CategoryTypes,
  PaymentGateway,
  PaymentMethod,
  PaymentMode,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
  IsObject,
  IsEmail,
  ArrayNotEmpty,
  Min,
  Length,
  IsBoolean,
} from 'class-validator';
import { IsObjectId } from 'class-validator-mongo-object-id';
import {
  GuarantorDto,
  IdentificationDto,
  NextOfKinDto,
} from '../../contract/dto/create-contract.dto';
import { BadRequestException } from '@nestjs/common';

export class SaleRecipientDto {
  @ApiProperty({
    description: "Recipient's firstname.",
    example: 'John',
  })
  @IsNotEmpty()
  @IsString()
  firstname: string;

  @ApiProperty({
    description: "Recipient's lastname.",
    example: 'Doe',
  })
  @IsNotEmpty()
  @IsString()
  lastname: string;

  @ApiProperty({
    description: "Recipient's address.",
    example: '123 Street, City, Country',
  })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty({
    description: "Recipient's phone number.",
    example: '+123456789',
  })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({
    description: "Recipient's email address.",
    example: 'john.doe@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class SaleItemDto {
  @ApiProperty({
    description: 'Product ID linked to the sale item.',
    example: '507f191e810c19729de860ea',
  })
  @IsNotEmpty()
  @IsString()
  @IsObjectId({
    message: 'Invalid Product Id',
  })
  productId: string;

  @ApiProperty({
    description: 'Quantity',
    example: '100',
  })
  @IsNumber()
  @Transform(({ value }) => {
    const parsedValue = Number(value);
    if (isNaN(parsedValue)) {
      throw new BadRequestException(
        'Quantity of sale product item must be a valid number.',
      );
    }
    return parsedValue;
  })
  @Min(1)
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({
    description: 'Payment mode for this sale item.',
    enum: PaymentMode,
    example: 'INSTALLMENT',
  })
  @IsNotEmpty()
  @IsEnum(PaymentMode)
  paymentMode: PaymentMode;

  @ApiPropertyOptional({
    description: 'Discount applied to this sale item in percentages.',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({
    description:
      'The duration of the installment in months (if installment is selected).',
    example: 6,
  })
  @IsOptional()
  @IsNumber()
  installmentDuration?: number;

  @ApiPropertyOptional({
    description: 'The starting price for installment payments.',
    example: 200,
  })
  @IsOptional()
  @IsNumber()
  installmentStartingPrice?: number;

  @ApiProperty({
    description: 'The installment monthly payment for sale.',
    example: 200,
  })
  @IsNumber()
  monthlyPayment: number;

  @ApiProperty({
    description: 'An array of device IDs',
    example: ['value1', 'value2', 'value3'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsObjectId({
    message: 'Invalid device Id',
    each: true,
  })
  devices: string[];

  @ApiPropertyOptional({
    description: 'Miscellaneous prices for this sale item.',
    example: '{"delivery": 20.5}',
  })
  @IsOptional()
  @IsObject()
  miscellaneousPrices?: Record<string, any>;

  @ApiProperty({
    description: 'Recipient details for this sale item.',
    type: SaleRecipientDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRecipientDto)
  saleRecipient?: SaleRecipientDto;
}
export class CreateSalesDto {
  @ApiProperty({
    description:
      'Category of the sale, such as "PRODUCT" or other predefined categories.',
    example: 'PRODUCT',
  })
  @IsNotEmpty()
  @IsEnum([CategoryTypes.PRODUCT])
  category: CategoryTypes;

  @ApiProperty({
    description:
      'Customer ID associated with this sale, should be a valid MongoDB ObjectId.',
    example: '605c72ef153207001f6480d',
  })
  @IsNotEmpty()
  @IsString()
  @IsObjectId({
    message: 'Invalid customer Id',
  })
  customerId: string;

  @ApiProperty({
    description: 'Payment method for this sale.',
    enum: PaymentMethod,
    example: 'ONLINE',
  })
  @IsNotEmpty()
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentGateway,
    description: 'Payment gateway to use for the sale',
  })
  @IsEnum(PaymentGateway)
  @IsOptional()
  paymentGateway?: PaymentGateway = PaymentGateway.OGARANYA;

  @ApiPropertyOptional({
    description:
      "Customer's BVN (Bank Verification Number). Must be provided for if there is an installment payment",
    example: 1234567890,
  })
  @Length(11, 11, {
    message: 'bvn must be exactly 11 characters',
  })
  @IsOptional()
  @IsString()
  bvn: string;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Whether financial margins should be applied to this sale or not',
    example: true,
  })
  applyMargin?: boolean;

  @ApiProperty({
    description: 'An array of sale product items',
    type: [SaleItemDto],
    required: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  saleItems: SaleItemDto[];

  @ApiPropertyOptional({
    description:
      'Optional Next of kin details for customer. Must be provided if payment mode is installment',
    type: NextOfKinDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NextOfKinDto)
  nextOfKinDetails?: NextOfKinDto;

  @ApiPropertyOptional({
    description:
      'Optional identification details for customer. Must be provided if payment mode is installment',
    type: IdentificationDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationDto)
  identificationDetails?: IdentificationDto;

  @ApiPropertyOptional({
    description:
      'Optional identification details for customer. Must be provided if payment mode is installment',
    type: GuarantorDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuarantorDto)
  guarantorDetails?: GuarantorDto;
}

export class CreateAgentSalesDto extends CreateSalesDto {
  @ApiProperty({
    description: 'Payment method for this sale.',
    example: 'ONLINE',
    enum: [PaymentMethod.ONLINE],
  })
  @IsNotEmpty()
  @IsEnum([PaymentMethod.ONLINE])
  paymentMethod: PaymentMethod;
}
