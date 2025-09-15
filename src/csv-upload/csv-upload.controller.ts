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
  Get,
  Param,
  Res,
  Query,
  NotFoundException,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Express, Response } from 'express';
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
import * as fs from 'fs/promises';
import * as path from 'path';

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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('agent-credentials/:sessionId')
  async getAgentCredentialsFile(
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
    @Query('download') download?: string,
  ) {
    try {
      // Validate session ID format (basic UUID validation)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sessionId)) {
        throw new BadRequestException('Invalid session ID format');
      }

      // Construct file path
      const uploadsDir = path.join(
        process.cwd(),
        'uploads',
        'agent_credentials',
      );
      const files = await fs.readdir(uploadsDir).catch(() => []);

      // Find file that matches the session ID pattern
      const fileName = files.find(
        (file) => file.includes(sessionId) && file.endsWith('.txt'),
      );

      if (!fileName) {
        throw new NotFoundException(
          'Agent credentials file not found for this session',
        );
      }

      const filePath = path.join(uploadsDir, fileName);

      // Check if file exists and is readable
      try {
        await fs.access(filePath, fs.constants.R_OK);
      } catch {
        throw new NotFoundException('Agent credentials file not accessible');
      }

      // Get file stats for headers
      const stats = await fs.stat(filePath);
      const fileContent = await fs.readFile(filePath, 'utf8');

      // Set appropriate headers
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Length', stats.size);

      if (download === 'true') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fileName}"`,
        );
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      }

      // Send file content
      res.send(fileContent);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException('Error retrieving agent credentials file');
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('agent-credentials')
  async listAgentCredentialFiles() {
    try {
      const uploadsDir = path.join(
        process.cwd(),
        'uploads',
        'agent_credentials',
      );

      // Ensure directory exists
      try {
        await fs.access(uploadsDir);
      } catch {
        return { files: [] };
      }

      const files = await fs.readdir(uploadsDir);
      const fileDetails = await Promise.all(
        files
          .filter((file) => file.endsWith('.txt'))
          .map(async (fileName) => {
            const filePath = path.join(uploadsDir, fileName);
            const stats = await fs.stat(filePath);

            // Extract session ID from filename
            const sessionIdMatch = fileName.match(
              /new_agents_([0-9a-f-]+)_\d+\.txt/i,
            );
            const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;

            return {
              fileName,
              sessionId,
              size: stats.size,
              createdAt: stats.birthtime,
              modifiedAt: stats.mtime,
            };
          }),
      );

      return {
        files: fileDetails.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      };
    } catch (error: any) {
      throw new BadRequestException('Error listing agent credentials files');
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @Delete('agent-credentials/:sessionId')
  async deleteAgentCredentialsFile(@Param('sessionId') sessionId: string) {
    try {
      // Validate session ID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(sessionId)) {
        throw new BadRequestException('Invalid session ID format');
      }

      const uploadsDir = path.join(
        process.cwd(),
        'uploads',
        'agent_credentials',
      );
      const files = await fs.readdir(uploadsDir).catch(() => []);

      const fileName = files.find(
        (file) => file.includes(sessionId) && file.endsWith('.txt'),
      );

      if (!fileName) {
        throw new NotFoundException(
          'Agent credentials file not found for this session',
        );
      }

      const filePath = path.join(uploadsDir, fileName);
      await fs.unlink(filePath);

      return {
        success: true,
        message: `Agent credentials file for session ${sessionId} deleted successfully`,
        fileName,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException('Error deleting agent credentials file');
    }
  }

  @Delete('flush')
  async flushQueue() {
    await this.csvQueue.obliterate({ force: true });
    await this.csvQueue.drain(true);
    // await (await this.csvQueue.client).flushall();
    // await this.csvQueue.close();

    return { message: 'Queue drained and worker stopped.' };
  }

  @Get('correct-missing')
  async correctMissingPayments() {
    await this.csvQueue.waitUntilReady();

    const job = await this.csvQueue.add(
      'correct-missing',
      {},
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
        delay: 1000,
      },
    );

    return {
      jobId: job.id,
      status: 'processing',
      message: 'Agent credentials generation proceessing',
    };
    // return await this.csvUploadService.previewCorrections();
  }
}
