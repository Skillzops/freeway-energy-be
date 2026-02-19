import {
  Controller,
  Post,
  Get,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
  HttpStatus,
  HttpCode,
  UseGuards,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiBody,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { Express } from 'express';
import { DeviceLocationUpdateService } from '../services/device-location-update.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';

@Controller('device-location-update')
export class DeviceLocationUpdateController {
  constructor(
    private readonly deviceLocationUpdateService: DeviceLocationUpdateService,
  ) {}

  /**
   * Validate device location update file
   */

  @ApiExcludeEndpoint()
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
    summary: 'Validate device location update file',
    description:
      'Upload and validate device location update file structure. Required columns: Serial Number. Optional: Installation Address, LGA, State, Latitude, Longitude',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Device location CSV/Excel file to validate',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV or Excel file containing device serial numbers and location data',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result with column mapping and data preview',
  })
  @HttpCode(HttpStatus.OK)
  async validateFile(@UploadedFile() file: Express.Multer.File): Promise<any> {
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

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / (1024 * 1024)}MB limit`,
      );
    }

    return await this.deviceLocationUpdateService.validateDeviceLocationFile(
      file,
    );
  }

  /**
   * Process device location update file
   */
  @ApiExcludeEndpoint()
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
    summary: 'Process and import device location data',
    description:
      'Upload and process device location file to update device installation locations. Automatically skips devices that already have location data.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Device location file to process',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV or Excel file containing device serial numbers and location data',
        },
        skipValidation: {
          type: 'boolean',
          default: false,
          description: 'Skip validation if already validated',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'File processing started with session tracking',
  })
  @HttpCode(HttpStatus.OK)
  async processFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('skipValidation') skipValidation?: boolean,
  ): Promise<any> {
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
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / (1024 * 1024)}MB limit`,
      );
    }

    return await this.deviceLocationUpdateService.processDeviceLocationFile(
      file,
      skipValidation || false,
    );
  }

  /**
   * Get session statistics
   */
  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('stats/:sessionId')
  @ApiOperation({
    summary: 'Get device location update session statistics',
    description:
      'Retrieve detailed statistics for a device location update session including progress and errors',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed session statistics',
  })
  @HttpCode(HttpStatus.OK)
  async getStats(@Param('sessionId') sessionId: string): Promise<any> {
    return await this.deviceLocationUpdateService.getSessionStats(sessionId);
  }
}
