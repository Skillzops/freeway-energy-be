import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UploadedFile,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DeviceService } from './device.service';
import {
  CreateBatchDeviceTokensDto,
  CreateDeviceDto,
} from './dto/create-device.dto';
import {
  UpdateDeviceDto,
  UpdateDeviceStatusDto,
} from './dto/update-device.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { unlinkSync } from 'fs';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ListDevicesQueryDto } from './dto/list-devices.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { JobStatusService } from 'src/jobstatus/jobstatus.service';
import { GetSessionUser } from 'src/auth/decorators/getUser';
import { AuthService } from 'src/auth/auth.service';

@SkipThrottle()
@ApiTags('Devices')
@Controller('device')
@ApiBearerAuth('access_token')
@ApiHeader({
  name: 'Authorization',
  description: 'JWT token used for authentication',
  required: true,
  schema: {
    type: 'string',
    example: 'Bearer <token>',
  },
})
export class DeviceController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly jobStatusService: JobStatusService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './files',
      }),
    }),
  )
  @Post('batch-upload')
  async createBatchDevices(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedTypes = ['.csv'];

    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (!allowedTypes.includes(fileExtension)) {
      throw new BadRequestException('Only CSV files are allowed (.csv)');
    }

    const filePath = file.path;
    const upload = await this.deviceService.uploadBatchDevices(filePath);
    unlinkSync(filePath);

    return upload;
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBody({
    type: CreateBatchDeviceTokensDto,
    description: 'Json structure for request payload',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './files',
      }),
    }),
  )
  @Post('batch/generate-tokens')
  async createBatchDeviceTokens(
    @UploadedFile() file: Express.Multer.File,
    @GetSessionUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedTypes = ['.csv'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (!allowedTypes.includes(fileExtension)) {
      throw new BadRequestException('Only CSV files are allowed (.csv)');
    }

    // Queue the job instead of processing immediately
    const result = await this.deviceService.queueBatchTokenGeneration(
      file.path,
      userId,
    );

    return result;
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('batch/job/:jobId/status')
  async getBatchJobStatus(@Param('jobId') jobId: string) {
    const status = await this.jobStatusService.getJobStatus(jobId);

    if (!status) {
      throw new NotFoundException('Job not found');
    }

    return status;
  }

  @Get('batch/job/:jobId/result')
  async getBatchJobResult(@Param('jobId') jobId: string) {
    try {
      const result = await this.jobStatusService.getJobResult(jobId);
      return result;
    } catch (error) {
      if (error.message === 'Job not found') {
        throw new NotFoundException('Job not found');
      }
      throw new BadRequestException(error.message);
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'Device ID to update tokenable status',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isTokenable: {
          type: 'boolean',
          description: 'Whether the device can generate tokens',
          example: true,
        },
      },
      required: ['isTokenable'],
    },
  })
  @ApiOperation({ summary: 'Update device tokenable status' })
  @HttpCode(HttpStatus.OK)
  @Patch(':id/tokenable')
  async updateDeviceTokenableStatus(
    @Param('id') id: string,
    @Body() body: { isTokenable: boolean },
  ) {
    const { isTokenable } = body;

    if (isTokenable === undefined || isTokenable === null) {
      throw new BadRequestException('isTokenable field is required');
    }

    return await this.deviceService.updateDeviceTokenableStatus(
      id,
      isTokenable,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiParam({
    name: 'deviceId',
    type: String,
    description: 'Device ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tokenDuration: {
          type: 'number',
          description: 'Token duration in days (-1 for forever token)',
          example: 30,
        },
      },
      required: ['tokenDuration'],
    },
  })
  @Post(':deviceId/generate-token')
  async generateSingleDeviceToken(
    @Param('deviceId') deviceId: string,
    @Body() body: { tokenDuration: number },
    @GetSessionUser('id') userId: string,
  ) {
    const { tokenDuration } = body;

    if (tokenDuration === undefined || tokenDuration === null) {
      throw new BadRequestException('Token duration is required');
    }

    return await this.deviceService.generateSingleDeviceToken(
      deviceId,
      tokenDuration,
      userId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'deviceId',
    type: String,
    description: 'Device ID',
  })
  @ApiParam({
    name: 'tokenId',
    type: String,
    description: 'TokenID',
  })
  @Post(':deviceId/token/:tokenId')
  async deleteDeviceToken(
    @Param('deviceId') deviceId: string,
    @Param('tokenId') tokenId: string,
    @GetSessionUser('id') userId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId,
      allowAgents: false,
    });

    return await this.deviceService.deleteDeviceToken(deviceId, tokenId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @ApiBody({
    type: CreateDeviceDto,
    description: 'Json structure for request payload',
  })
  @ApiOperation({ summary: 'Create a single device' })
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createDevice(
    @Body() createDeviceDto: CreateDeviceDto,
    @GetSessionUser('id') userId: string,
  ) {
    return await this.deviceService.createDevice(createDeviceDto, userId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch all devices' })
  @ApiExtraModels(ListDevicesQueryDto)
  @Get()
  async fetchDevices(
    @Query() query: ListDevicesQueryDto,
    @GetSessionUser('id') userId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.read, subject: SubjectEnum.Sales },
      ],
    });
    return await this.deviceService.fetchDevices(query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'id',
    description: 'Device id to fetch details',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch a single device by ID' })
  @Get(':id')
  async fetchDevice(
    @Param('id') id: string,
    @GetSessionUser('id') userId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.read, subject: SubjectEnum.Sales },
      ],
    });
    return await this.deviceService.validateDeviceExistsAndReturn({ id });
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'Device id to update details',
  })
  @ApiBody({
    type: UpdateDeviceDto,
    description: 'Json structure for request payload',
  })
  @ApiOperation({ summary: 'Update a device by ID' })
  @Patch(':id')
  async updateDevice(
    @Param('id') id: string,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ) {
    return await this.deviceService.updateDevice(id, updateDeviceDto);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.delete}:${SubjectEnum.Sales}`,
    ],
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'Device id to delete details',
  })
  @ApiOperation({ summary: 'Soft delete a device by ID' })
  @Delete(':id')
  async deleteDevice(@Param('id') id: string) {
    return await this.deviceService.deleteDevice(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update device installation status',
    description:
      'Update the installation status of a device (Admin or assigned installer only)',
  })
  @ApiParam({ name: 'id', description: 'Device ID' })
  @ApiBody({ type: UpdateDeviceStatusDto })
  @HttpCode(HttpStatus.OK)
  async updateDeviceStatus(
    @Param('id') id: string,
    @Body() updateData: UpdateDeviceStatusDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.deviceService.updateDeviceStatus(id, updateData, userId);
  }

  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard)
  @Get('fix/duplicate-devices')
  @HttpCode(HttpStatus.OK)
  async fixDuplicateDevices(
  ) {
    return this.deviceService.fixDuplicateDevices();
  }

  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard)
  @Get('fix/device-installation-status')
  @HttpCode(HttpStatus.OK)
  async syncDeviceInstallationStatus(
  ) {
    return this.deviceService.syncDeviceInstallationStatus();
  }
}
