import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
  HttpStatus,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Express } from 'express';
import { CsvUploadService } from './csv-upload.service';
import {
  CsvFileUploadDto,
  CsvUploadResponseDto,
  CsvUploadStatsDto,
  ProcessCsvDto,
  ValidationResultDto,
  SessionStatsRequestDto,
} from './dto/csv-upload.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { GetSessionUser } from 'src/auth/decorators/getUser';

@ApiTags('CSV Data Migration')
@Controller('csv-upload')
export class CsvUploadController {
  constructor(
    private readonly csvUploadService: CsvUploadService,
    @InjectQueue('csv-processing') private readonly csvQueue: Queue,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Post('validate')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Validate CSV/Excel file structure for sales data',
    description:
      'Upload and validate sales CSV file structure without processing data. Checks for required columns and data integrity.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Sales CSV file to validate',
    type: CsvFileUploadDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result with column mapping and data preview',
    type: ValidationResultDto,
  })
  @HttpCode(HttpStatus.OK)
  async validateFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ValidationResultDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (!allowedTypes.includes(fileExtension)) {
      throw new BadRequestException(
        'Only CSV and Excel files are allowed (.csv, .xlsx, .xls)',
      );
    }

    // Validate file size (max 100MB for Excel, 50MB for CSV)
    const maxSize =
      fileExtension === '.csv' ? 50 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / (1024 * 1024)}MB limit`,
      );
    }

    return await this.csvUploadService.validateSalesFile(file);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Post('process')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Process and import sales data from CSV/Excel file',
    description:
      'Upload and process sales file with automatic data transformation, entity creation, and relationship management.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Sales file to process with optional processing parameters',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV or Excel file containing sales data',
        },
        batchSize: {
          type: 'integer',
          minimum: 10,
          maximum: 500,
          default: 50,
          description: 'Number of records to process per batch',
        },
        skipValidation: {
          type: 'boolean',
          default: false,
          description: 'Skip validation if already validated',
        },
        createMissingEntities: {
          type: 'boolean',
          default: true,
          description: 'Create missing products, categories, etc.',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'File processing started with session tracking',
    type: CsvUploadResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async processFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() processCsvDto: ProcessCsvDto,
    @GetSessionUser('id') sessionUserId: string,
  ): Promise<CsvUploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (!allowedTypes.includes(fileExtension)) {
      throw new BadRequestException(
        'Only CSV and Excel files are allowed (.csv, .xlsx, .xls)',
      );
    }

    // Validate file size
    const maxSize =
      fileExtension === '.csv' ? 50 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / (1024 * 1024)}MB limit`,
      );
    }

    return await this.csvUploadService.processSalesFile(
      file,
      processCsvDto,
      sessionUserId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Post('get-upload-stats')
  @ApiOperation({
    summary: 'Get upload session statistics',
    description:
      'Retrieve detailed statistics for an ongoing upload session including progress, errors, and created records',
  })
  @ApiBody({
    description: 'Session stats request',
    type: SessionStatsRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed upload statistics with entity breakdown',
    type: CsvUploadStatsDto,
  })
  @HttpCode(HttpStatus.OK)
  async getUploadStats(
    @Body() statsRequest: SessionStatsRequestDto,
  ): Promise<CsvUploadStatsDto> {
    return await this.csvUploadService.getUploadStats(statsRequest.sessionId);
  }
}
