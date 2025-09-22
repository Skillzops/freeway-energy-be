import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  ParseFilePipeBuilder,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
  ApiExtraModels,
  ApiConsumes,
  ApiBody,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { GetSessionUser } from '../auth/decorators/getUser';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { WarehouseEntity } from './entities/warehouse.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { GetWarehousesQueryDto } from './dto/get-warehouse-query.dto';
import { WarehouseStatsDto } from './dto/get-warehouse-stats.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { GetTransferRequestsQueryDto } from './dto/get-transfer-request-query.dto';
import { TransferRequestEntity } from './entities/transfer-request.entity';
import { FulfillTransferRequestDto } from './dto/fulfil-transfer-request.dto';
import { CreateTransferRequestDto } from './dto/create-transfer.dto';
import { WarehouseService } from 'src/warehouse/warehouse.service';
import { AssignWarehouseManagerDto } from './dto/assign-warehouse-manager.dto';
import { AdminOrWarehouseManagerGuard } from 'src/auth/guards/admin-warehouse-manager-access.guard';
import { WarehouseManagerEntity } from './entities/warehouse-manager.entity';

@SkipThrottle()
@ApiTags('Warehouses')
@Controller('warehouses')
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
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Warehouse}`,
      `${ActionEnum.write}:${SubjectEnum.Warehouse}`,
    ],
  })
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new warehouse (Admin only)' })
  @ApiCreatedResponse({
    description: 'Warehouse created successfully',
    type: WarehouseEntity,
  })
  @ApiBadRequestResponse({ description: 'Bad request' })
  @ApiBody({
    type: CreateWarehouseDto,
    description: 'Warehouse creation data with optional image',
  })
  @HttpCode(HttpStatus.CREATED)
  async createWarehouse(
    @Body() createWarehouseDto: CreateWarehouseDto,
    @GetSessionUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: false,
        }),
    )
    file?: Express.Multer.File,
  ) {
    return this.warehouseService.createWarehouse(
      createWarehouseDto,
      userId,
      file,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Warehouse}`,
      `${ActionEnum.write}:${SubjectEnum.Warehouse}`,
    ],
  })
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update warehouse (Admin only)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({
    description: 'Warehouse updated successfully',
    type: WarehouseEntity,
  })
  @ApiBody({
    type: UpdateWarehouseDto,
    description: 'Warehouse update data with optional image',
  })
  async updateWarehouse(
    @Param('id') id: string,
    @Body() updateWarehouseDto: UpdateWarehouseDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: false,
        }),
    )
    file?: Express.Multer.File,
  ) {
    return this.warehouseService.updateWarehouse(id, updateWarehouseDto, file);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Warehouse}`,
      `${ActionEnum.delete}:${SubjectEnum.Warehouse}`,
    ],
  })
  @ApiOperation({ summary: 'Delete warehouse (Admin only)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({ description: 'Warehouse deleted successfully' })
  async deleteWarehouse(@Param('id') id: string) {
    return this.warehouseService.deleteWarehouse(id);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Warehouse}`,
      `${ActionEnum.write}:${SubjectEnum.Warehouse}`,
    ],
  })
  @ApiOperation({ summary: 'Deactivate warehouse (Admin only)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({ description: 'Warehouse deactivated successfully' })
  async deactivateWarehouse(@Param('id') id: string) {
    return this.warehouseService.deactivateWarehouse(id);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Warehouse}`,
      `${ActionEnum.write}:${SubjectEnum.Warehouse}`,
    ],
  })
  @ApiOperation({ summary: 'Activate warehouse (Admin only)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({ description: 'Warehouse activated successfully' })
  async activateWarehouse(@Param('id') id: string) {
    return this.warehouseService.activateWarehouse(id);
  }

  @Post(':id/managers')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.write}:${SubjectEnum.User}`,
    ],
  })
  @ApiOperation({ summary: 'Assign users as warehouse managers (Admin only)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiBody({ type: AssignWarehouseManagerDto })
  @ApiCreatedResponse({
    description: 'Warehouse managers assigned successfully',
  })
  async assignWarehouseManagers(
    @Param('id') warehouseId: string,
    @Body() assignWarehouseManagerDto: AssignWarehouseManagerDto,
    @GetSessionUser('id') assignedBy: string,
  ) {
    return this.warehouseService.assignWarehouseManagers(
      warehouseId,
      assignWarehouseManagerDto,
      assignedBy,
    );
  }

  @Delete('managers/:managerId')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.delete}:${SubjectEnum.User}`,
    ],
  })
  @ApiOperation({ summary: 'Unassign warehouse manager (Admin only)' })
  @ApiParam({ name: 'managerId', description: 'Warehouse Manager ID' })
  @ApiOkResponse({ description: 'Warehouse manager unassigned successfully' })
  async unassignWarehouseManager(
    @Param('managerId') warehouseManagerId: string,
  ) {
    return this.warehouseService.unassignWarehouseManager(warehouseManagerId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({
    summary: 'Get warehouses (Admin: all, Manager: assigned only)',
  })
  @ApiOkResponse({
    description: 'List of warehouses retrieved successfully',
    type: [WarehouseEntity],
  })
  @ApiExtraModels(GetWarehousesQueryDto)
  async getWarehouses(@Query() query: GetWarehousesQueryDto, @Req() req: any) {
    return this.warehouseService.getWarehouses(
      query,
      req.userType,
      req.user.warehouseManager,
    );
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({
    summary: 'Get warehouse statistics (Admin: all, Manager: assigned only)',
  })
  @ApiOkResponse({
    description: 'Warehouse statistics retrieved successfully',
    type: WarehouseStatsDto,
  })
  async getWarehouseStats(@Req() req: any) {
    if (req.userType === 'warehouseManager') {
      // Return stats for manager's specific warehouse
      return this.warehouseService.getWarehouse(
        req.warehouseManager.warehouseId,
      );
    }
    return this.warehouseService.getWarehouseStats();
  }

  @Get(':id/managers')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({ summary: 'Get warehouse managers (with access control)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({
    description: 'Warehouse managers retrieved successfully',
    type: [WarehouseManagerEntity],
  })
  async getWarehouseManagers(
    @Param('id') warehouseId: string,
    @Req() req: any,
  ) {
    // Warehouse managers can only view managers of their assigned warehouse
    if (
      req.userType === 'warehouseManager' &&
      req.warehouseManager.warehouseId !== warehouseId
    ) {
      throw new ForbiddenException('Access denied to this warehouse');
    }
    return this.warehouseService.getWarehouseManagers(warehouseId);
  }

  @Post('transfer-requests')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({ summary: 'Create transfer request (Admin/Manager)' })
  @ApiBody({ type: CreateTransferRequestDto })
  @ApiCreatedResponse({
    description: 'Transfer request created successfully',
    type: TransferRequestEntity,
  })
  async createTransferRequest(
    @Body() createTransferRequestDto: CreateTransferRequestDto,
    @GetSessionUser('id') userId: string,
    @Req() req: any,
  ) {
    return this.warehouseService.createTransferRequest(
      createTransferRequestDto,
      userId,
      req.warehouseManager,
    );
  }

  @Get('transfer-requests')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({
    summary: 'Get transfer requests (with role-based filtering)',
  })
  @ApiOkResponse({
    description: 'Transfer requests retrieved successfully',
    type: [TransferRequestEntity],
  })
  @ApiExtraModels(GetTransferRequestsQueryDto)
  async getTransferRequests(
    @Query() query: GetTransferRequestsQueryDto,
    @Req() req: any,
  ) {
    return this.warehouseService.getTransferRequests(
      query,
      req.warehouseManager,
    );
  }

  @Patch('transfer-requests/:id/fulfill')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({
    summary: 'Fulfill transfer request (Main Warehouse Manager/Admin)',
  })
  @ApiParam({ name: 'id', description: 'Transfer Request ID' })
  @ApiBody({ type: FulfillTransferRequestDto })
  @ApiOkResponse({
    description: 'Transfer request fulfilled successfully',
    type: TransferRequestEntity,
  })
  async fulfillTransferRequest(
    @Param('id') requestId: string,
    @Body() fulfillTransferRequestDto: FulfillTransferRequestDto,
    @GetSessionUser('id') fulfilledBy: string,
    @Req() req: any,
  ) {
    if (req.warehouseManager && !req.warehouseManager.warehouse.isMain) {
      throw new ForbiddenException(
        'Only main warehouse managers can fulfill requests',
      );
    }

    return this.warehouseService.fulfillTransferRequest(
      requestId,
      fulfillTransferRequestDto,
      fulfilledBy,
      req.warehouseManager,
    );
  }

  @Patch('transfer-requests/:id/reject')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({
    summary: 'Reject transfer request (Main Warehouse Manager/Admin)',
  })
  @ApiParam({ name: 'id', description: 'Transfer Request ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Rejection reason' },
      },
    },
  })
  @ApiOkResponse({ description: 'Transfer request rejected successfully' })
  async rejectTransferRequest(
    @Req() req: any,
    @Param('id') requestId: string,
    @Body('notes') notes?: string,
  ) {
    if (req.warehouseManager && !req.warehouseManager.warehouse.isMain) {
      throw new ForbiddenException(
        'Only main warehouse managers can reject requests',
      );
    }
    return this.warehouseService.rejectTransferRequest(requestId, notes);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, AdminOrWarehouseManagerGuard)
  @ApiOperation({ summary: 'Get warehouse by ID (with access control)' })
  @ApiParam({ name: 'id', description: 'Warehouse ID' })
  @ApiOkResponse({
    description: 'Warehouse retrieved successfully',
    type: WarehouseEntity,
  })
  async getWarehouse(@Param('id') id: string, @Req() req: any) {
    // Warehouse managers can only view their assigned warehouse
    if (
      req.userType === 'warehouseManager' &&
      req.warehouseManager.warehouseId !== id
    ) {
      throw new ForbiddenException('Access denied to this warehouse');
    }
    return this.warehouseService.getWarehouse(id);
  }
}
