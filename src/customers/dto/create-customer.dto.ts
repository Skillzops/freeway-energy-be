import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressType, IDType, CustomerType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum, 
  Length,
  IsEmail,
  ValidateIf,
  IsNumberString,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({
    description: 'Customer Firstname',
    example: 'James',
  })
  @IsNotEmpty()
  @IsString()
  firstname: string;

  @ApiProperty({
    description: 'Customer Lastname',
    example: 'Lewis',
  })
  @IsNotEmpty()
  @IsString()
  lastname: string;

  @ApiPropertyOptional({
    description: 'The email of the customer',
    example: 'francisalexander000@gmail.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'The phone number of the customer',
    maxLength: 15,
    example: '+1234567890',
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 15)
  phone: string;

  @ApiProperty({
    description: 'The alternate phone number of the customer',
    maxLength: 15,
    example: '+1234567891',
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 15)
  alternatePhone: string;

  @ApiProperty({
    description: 'Gender of the customer',
    example: 'Male',
  })
  @IsNotEmpty()
  @IsString()
  gender?: string;

  @ApiProperty({
    enum: AddressType,
    example: 'HOME',
  })
  @IsNotEmpty()
  @IsEnum(AddressType)
  addressType: AddressType;

  @ApiProperty({
    description: 'Installation address of the customer',
    example: '123 Main Street, Apartment 4B',
  })
  @IsNotEmpty()
  @IsString()
  installationAddress: string;

  @ApiProperty({
    description: 'Local Government Area',
    example: 'Ikeja',
  })
  @IsNotEmpty()
  @IsString()
  lga: string;

  @ApiProperty({
    description: 'State',
    example: 'Lagos',
  })
  @IsNotEmpty()
  @IsString()
  state: string;

  @ApiProperty({
    description: 'The location of the customer',
    example: 'New York, USA',
  })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiPropertyOptional({
    description: 'The longitude of the customer',
    type: String,
    example: '',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value;
    const cleaned = String(value)
      .replace(/[°'"]\s*/g, '')
      .trim();
    // If it's not a number, we return the original so the validator fails later
    return isNaN(Number(cleaned)) ? 'INVALID_COORD' : cleaned;
  })
  // Only validate if it's not empty/null
  @ValidateIf(
    (o) =>
      o.longitude !== undefined && o.longitude !== null && o.longitude !== '',
  )
  @IsNumberString({}, { message: 'longitude must be a valid coordinate (numeric)' })
  longitude?: string;

  @ApiPropertyOptional({
    description: 'The latitude of the customer',
    type: String,
    example: '',
  })
  @IsOptional()
    @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value;
    const cleaned = String(value)
      .replace(/[°'"]\s*/g, '')
      .trim();
    return isNaN(Number(cleaned)) ? 'INVALID_COORD' : cleaned;
  })
  @ValidateIf(
    (o) => o.latitude !== undefined && o.latitude !== null && o.latitude !== '',
  )
  @IsNumberString(
    {},
    { message: 'latitude must be a valid coordinate (numeric)' },
  )
  latitude?: string;

  @ApiPropertyOptional({
    enum: IDType,
    description: 'Type of ID document',
    example: 'NATIONAL_ID',
  })
  @IsOptional()
  @IsEnum(IDType)
  idType?: IDType;

  @ApiPropertyOptional({
    description: 'ID number',
    example: '12345678901',
  })
  @IsOptional()
  @IsString()
  idNumber?: string;

  @ApiPropertyOptional({
    enum: CustomerType,
    description: 'Customer type',
    example: 'lead',
    default: 'lead',
  })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({
    description:
      'Customer category (e.g. Public, Prepaid, Residential, Commercial, Business)',
    example: 'Commercial',
  })
  @IsOptional()
  @IsString()
  customerCategory?: string;

  @ApiPropertyOptional({
    description: 'Customer business/shop type (e.g. Barber Shop, Tailor, Groceries)',
    example: 'Barber Shop',
  })
  @IsOptional()
  @IsString()
  customerBusiness?: string;

  @ApiPropertyOptional({
    description: 'Estimated monthly fuel spend (free text, e.g. ₦150,000)',
    example: '₦150,000',
  })
  @IsOptional()
  @IsString()
  monthlyFuelSpend?: string;

  @ApiPropertyOptional({
    description: 'Generator capacity (e.g. 5kVA, 10kVA)',
    example: '5kVA',
  })
  @IsOptional()
  @IsString()
  generatorSize?: string;

  @ApiPropertyOptional({
    description: 'Typical daily generator runtime (e.g. 8 hours)',
    example: '8 hours',
  })
  @IsOptional()
  @IsString()
  dailyRuntime?: string;

  @ApiPropertyOptional({
    description: 'Main electricity pain points (outages, cost, fuel, etc.)',
    example: 'Frequent outages, high diesel cost',
  })
  @IsOptional()
  @IsString()
  electricityPainPoints?: string;

  @ApiPropertyOptional({
    type: 'file',
    description: 'Customer passport photo file',
    format: 'binary',
  })
  passportPhoto?: Express.Multer.File;

  @ApiPropertyOptional({
    type: 'file',
    description: 'Customer ID image file',
    format: 'binary',
  })
  idImage?: Express.Multer.File;

  @ApiPropertyOptional({
    type: 'file',
    description: 'Customer contract form image file',
    format: 'binary',
  })
  contractFormImage?: Express.Multer.File;

  @ApiPropertyOptional({
    description: 'Customer BVN (11 digits) — required before generating device DVA',
    example: '22222222222',
  })
  @IsOptional()
  @IsNumberString()
  @Length(11, 11)
  bvn?: string;
}
