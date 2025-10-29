import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsBoolean,
  IsNumber,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class CsvFileUploadDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'CSV or Excel file containing sales data',
  })
  file: any;
}

export class ProcessCsvDto {
  @ApiPropertyOptional({
    description: 'Number of records to process per batch',
    minimum: 10,
    maximum: 500,
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(500)
  batchSize?: number = 50;

  @ApiPropertyOptional({
    description: 'Skip validation if already validated',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  skipValidation?: boolean = false;

  @ApiPropertyOptional({
    description: 'Create missing entities (products, categories, etc.)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createMissingEntities?: boolean = true;
}

export class ValidationResultDto {
  @ApiProperty({ description: 'Whether the file structure is valid' })
  isValid: boolean;

  @ApiProperty({ description: 'Information about the uploaded file' })
  fileInfo: {
    name: string;
    size: number;
    type: string;
    totalRows?: number;
  };

  @ApiProperty({ description: 'Validation errors found' })
  errors: string[];

  @ApiProperty({ description: 'Validation warnings' })
  warnings: string[];

  @ApiProperty({ description: 'Mapping of CSV columns to expected fields' })
  columnMapping: Record<string, string>;

  @ApiProperty({ description: 'Sample data from the file (first 3 rows)' })
  sampleData?: any[];

  @ApiProperty({ description: 'Detected column headers' })
  detectedColumns: string[];

  @ApiPropertyOptional({ description: 'Required columns for processing' })
  requiredColumns?: string[];

  @ApiPropertyOptional({ description: 'Optional columns that can be included' })
  optionalColumns?: string[];
}

export class BatchProcessRequestDto {
  @ApiProperty({ description: 'Processing session ID' })
  @IsString()
  sessionId: string;

  @ApiProperty({ description: 'Batch index to process' })
  @IsNumber()
  @Min(0)
  batchIndex: number;
}

export class SessionStatsRequestDto {
  @ApiProperty({ description: 'Processing session ID' })
  @IsString()
  sessionId: string;
}

export class CsvUploadStatsDto {
  @ApiProperty({ description: 'Processing session ID' })
  sessionId: string;

  @ApiProperty({ description: 'Total number of records to process' })
  totalRecords: number;

  @ApiProperty({ description: 'Number of records processed successfully' })
  processedRecords: number;

  @ApiProperty({ description: 'Number of records with errors' })
  errorRecords: number;

  @ApiProperty({ description: 'Number of records skipped' })
  skippedRecords: number;

  @ApiProperty({ description: 'Processing progress percentage' })
  progressPercentage: number;

  @ApiProperty({
    description: 'Processing status',
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
  })
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

  @ApiProperty({ description: 'Detailed breakdown by entity type' })
  breakdown: {
    customers: EntityStats;
    products: EntityStats;
    sales: EntityStats;
    contracts: EntityStats;
    agents: EntityStats;
    devices: EntityStats;
  };

  @ApiProperty()
  newAgentsCount?: any;

  @ApiProperty()
  newAgentsSummary?: any;

  @ApiProperty()
  newAgentsFile?: any;

  @ApiProperty({ description: 'List of processing errors' })
  errors: ProcessingError[];

  @ApiProperty({ description: 'Processing start time' })
  startTime: Date;

  @ApiPropertyOptional({ description: 'Processing end time' })
  endTime?: Date;
}

export class CsvUploadResponseDto {
  @ApiProperty({ description: 'Processing session ID' })
  sessionId: string;

  @ApiProperty({ description: 'Whether the upload was successful' })
  success: boolean;

  @ApiProperty({ description: 'Response message' })
  message: string;

  @ApiProperty({ description: 'Processing statistics' })
  stats: CsvUploadStatsDto;

  @ApiProperty({ description: 'Processing statistics' })
  newAgentsFile?: string;

  @ApiProperty({ description: 'Processing statistics' })
  newAgentsCount?: number;
}

export class EntityStats {
  @ApiProperty({ description: 'Number of entities created' })
  created: number;

  @ApiProperty({ description: 'Number of entities updated' })
  updated: number;

  @ApiProperty({ description: 'Number of entities with errors' })
  errors: number;
}

export class ProcessingError {
  @ApiProperty({ description: 'Row number where error occurred' })
  row: number;

  @ApiProperty({ description: 'Field that caused the error' })
  field: string;

  @ApiProperty({ description: 'Error message' })
  message: string;

  @ApiProperty({ description: 'Raw data that caused the error' })
  data: any;
}

// Sales-specific DTOs
export class SalesRowDto {
  // Agent Information
  @ApiPropertyOptional({ description: 'Sales agent name' })
  salesAgent?: string;

  @ApiPropertyOptional({ description: 'Payment Plan' })
  paymentPlan?: string | number;

  // Customer Basic Information
  @ApiProperty({ description: 'Customer first name' })
  firstName: string;

  @ApiProperty({ description: 'Customer last name' })
  lastName: string;

  @ApiProperty({ description: 'Customer phone number' })
  phoneNumber: string;

  @ApiPropertyOptional({ description: 'Customer alternate phone number' })
  alternatePhoneNumber?: string;

  // Address and Location
  @ApiPropertyOptional({ description: 'Installation address' })
  installationAddress?: string;

  @ApiPropertyOptional({ description: 'Local Government Area' })
  lga?: string;

  @ApiPropertyOptional({ description: 'State' })
  state?: string;

  @ApiPropertyOptional({ description: 'Latitude coordinate' })
  latitude?: string;

  @ApiPropertyOptional({ description: 'Longitude coordinate' })
  longitude?: string;

  // Personal Details
  @ApiPropertyOptional({ description: 'Customer gender' })
  gender?: string;

  // ID Information
  @ApiPropertyOptional({ description: 'Type of ID document' })
  idType?: string;

  @ApiPropertyOptional({ description: 'ID card number' })
  idNumber?: string;

  // File References (URLs or file paths)
  @ApiPropertyOptional({ description: 'Passport photo URL or reference' })
  passportPhotoUrl?: string;

  @ApiPropertyOptional({ description: 'ID card image URL or reference' })
  idImageUrl?: string;

  @ApiPropertyOptional({ description: 'Signed contract URL or reference' })
  signedContractUrl?: string;

  @ApiPropertyOptional({
    description: 'Contract form image URL (Google Drive or direct link)',
  })
  contractFormImageUrl?: string;

  // Customer Category
  @ApiPropertyOptional({ description: 'Customer category (lead/purchase)' })
  customerCategory?: string;

  // Guarantor Information
  @ApiPropertyOptional({ description: 'Guarantor full name' })
  guarantorName?: string;

  @ApiPropertyOptional({ description: 'Guarantor phone number' })
  guarantorNumber?: string;

  // Product and Payment Information
  @ApiProperty({ description: 'Product type or name' })
  productType: string;

  @ApiPropertyOptional({ description: 'Payment option (one_off/installment)' })
  paymentOption?: string;

  @ApiPropertyOptional({ description: 'Initial deposit amount' })
  initialDeposit?: string | number;

  @ApiPropertyOptional({ description: 'Period of payment (in months)' })
  paymentPeriod?: string | number;

  @ApiPropertyOptional({ description: 'Payment type classification' })
  paymentType?: string;

  @ApiPropertyOptional({ description: 'Total payment amount' })
  totalPayment?: string | number;

  // Device Information
  @ApiPropertyOptional({ description: 'Device serial number' })
  serialNumber?: string;

  // Installation Information
  @ApiPropertyOptional({ description: 'Installer name' })
  installerName?: string;

  @ApiPropertyOptional({ description: 'Date of registration' })
  dateOfRegistration?: string | Date;

  @ApiPropertyOptional()
  timestamp?: string;

  @ApiPropertyOptional()
  middleName?: string;

  @ApiPropertyOptional()
  uploadAllImages?: string;

  @ApiPropertyOptional()
  tokenSent?: string;
}

// Enums for validation
export enum CsvDataType {
  SALES = 'SALES',
  TRANSACTIONS = 'TRANSACTIONS',
  MIXED = 'MIXED',
  AUTO_DETECT = 'AUTO_DETECT',
}

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Additional validation DTOs
export class ColumnMappingDto {
  @ApiProperty({ description: 'Original column name from CSV' })
  originalColumn: string;

  @ApiProperty({ description: 'Mapped field name' })
  mappedField: string;

  @ApiProperty({ description: 'Whether this mapping is required' })
  required: boolean;

  @ApiPropertyOptional({ description: 'Confidence score of the mapping (0-1)' })
  confidence?: number;
}

export class FilePreviewDto {
  @ApiProperty({ description: 'File headers' })
  headers: string[];

  @ApiProperty({ description: 'Sample data rows' })
  sampleData: any[];

  @ApiProperty({ description: 'Total number of rows in file' })
  totalRows: number;

  @ApiProperty({ description: 'Suggested column mappings' })
  suggestedMappings: ColumnMappingDto[];

  @ApiProperty({ description: 'File validation result' })
  validation: {
    isValid: boolean;
    missingRequired: string[];
    suggestions: string[];
  };
}

// Response DTOs for specific operations
export class RetryFailedResponseDto {
  @ApiProperty({ description: 'New session ID for retry operation' })
  newSessionId: string;

  @ApiProperty({ description: 'Number of failed records being retried' })
  failedRecordsCount: number;

  @ApiProperty({ description: 'Success message' })
  message: string;
}

export class SessionCancellationDto {
  @ApiProperty({ description: 'Whether cancellation was successful' })
  success: boolean;

  @ApiProperty({ description: 'Cancellation message' })
  message: string;

  @ApiProperty({ description: 'Session ID that was cancelled' })
  sessionId: string;

  @ApiProperty({ description: 'Whether rollback was completed successfully' })
  rollbackCompleted: boolean;

  @ApiPropertyOptional({
    description: 'Details of entities that were rolled back',
  })
  rollbackDetails?: {
    customers: number;
    products: number;
    sales: number;
    contracts: number;
    agents: number;
  };
}
