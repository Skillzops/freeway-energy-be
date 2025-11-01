import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  Res,
  Body,
  Logger,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiBody,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { TokenRestorationService } from './token-restoration.service';

export interface TokenRestoreBody {
  csvContent: string;
}

@Controller('token-restoration')
export class TokenRestorationController {
  private readonly logger = new Logger(TokenRestorationController.name);

  constructor(private readonly tokenRestoreService: TokenRestorationService) {}

  /**
   * Upload CSV file to restore tokens
   * Can be used to re-populate accidentally deleted token records
   */
  @Post('restore-from-csv')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Restore tokens from CSV file',
    description: `
      Upload a CSV file exported from device-tokens/download endpoint to restore deleted token data.
      
      - Creates devices that don't exist
      - Updates existing devices with new info
      - Creates tokens that don't exist
      - Skips duplicate tokens
      
      Expected CSV format from device-tokens/download report.
    `,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file exported from device-tokens/download endpoint',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens restored successfully',
    schema: {
      example: {
        success: true,
        message: 'Tokens restored successfully',
        data: {
          totalRecords: 100,
          devicesCreated: 25,
          devicesUpdated: 15,
          tokensCreated: 250,
          tokensSkipped: 50,
          errors: [{ row: 45, error: 'Invalid token format' }],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file or CSV format',
    schema: {
      example: {
        success: false,
        message: 'File is required',
        error: 'BadRequestException',
      },
    },
  })
  async uploadTokensFile(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
    @Headers('x-user-id') userId?: string,
  ) {
    try {
      if (!file) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'File is required',
          error: 'BadRequestException',
        });
      }

      // Validate file type
      if (!file.originalname.endsWith('.csv')) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Only CSV files are accepted',
          error: 'BadRequestException',
        });
      }

      this.logger.log(
        `Processing token restore file: ${file.originalname} (${file.size} bytes)`,
      );

      // Restore tokens from file
      const result = await this.tokenRestoreService.restoreTokensFromFile(
        file.buffer,
        userId,
      );

      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'Tokens restored successfully',
        data: result,
      });
    } catch (error) {
      this.logger.error(`Token restore error: ${error.message}`);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Failed to restore tokens',
        error: error.constructor.name,
      });
    }
  }

  /**
   * Restore tokens from raw CSV content (paste/text)
   * Useful for debugging or small datasets
   */
  @Post('restore/raw')
  @ApiOperation({
    summary: 'Restore tokens from raw CSV content',
    description: `
      Restore tokens by pasting CSV content directly.
      Same validation and rules as file upload.
    `,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        csvContent: {
          type: 'string',
          description: 'Raw CSV content with headers and token data',
          example: `Device ID,Serial Number,Device Key,Total Tokens Generated,All Tokens (Token:Duration:Date)
abc123,SN001,KEY001,2,"TOKEN001:12:2024-01-15;TOKEN002:24:2024-01-16"`,
        },
      },
      required: ['csvContent'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens restored successfully from raw content',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid CSV content',
  })
  async restoreTokensRaw(
    @Body() body: TokenRestoreBody,
    @Res() res: Response,
    @Headers('x-user-id') userId?: string,
  ) {
    try {
      if (!body.csvContent || body.csvContent.trim().length === 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'csvContent is required and cannot be empty',
          error: 'BadRequestException',
        });
      }

      this.logger.log(
        `Processing raw CSV content (${body.csvContent.length} characters)`,
      );

      // Restore tokens from CSV content
      const result = await this.tokenRestoreService.restoreTokensFromCsv(
        body.csvContent,
        userId,
      );

      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'Tokens restored successfully',
        data: result,
      });
    } catch (error) {
      this.logger.error(`Raw token restore error: ${error.message}`);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Failed to restore tokens',
        error: error.constructor.name,
      });
    }
  }

  /**
   * Get restore status and validation info
   */
  @Post('restore/validate')
  @ApiOperation({
    summary: 'Validate CSV file without restoring',
    description:
      'Parse and validate CSV format without creating any database records',
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async validateTokensFile(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    try {
      if (!file) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'File is required',
        });
      }

      if (!file.originalname.endsWith('.csv')) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Only CSV files are accepted',
        });
      }

      // For validation, we just check if it can be parsed
      // without actually creating records
      const csvContent = file.buffer.toString('utf-8');
      const lines = csvContent.trim().split('\n');

      if (lines.length < 2) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'CSV must contain headers and at least one data row',
        });
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const requiredColumns = ['device id', 'serial number', 'device key'];
      const missingColumns = requiredColumns.filter(
        (col) => !headers.includes(col),
      );

      if (missingColumns.length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: `Missing required columns: ${missingColumns.join(', ')}`,
          availableColumns: headers,
        });
      }

      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'CSV validation successful',
        data: {
          totalRows: lines.length - 1,
          headers,
          sample: {
            header: headers,
            firstDataRow: lines[1]
              ?.split(',')
              .map((c) => c.trim().substring(0, 50)),
          },
        },
      });
    } catch (error) {
      this.logger.error(`Validation error: ${error.message}`);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Validation failed',
      });
    }
  }
}
