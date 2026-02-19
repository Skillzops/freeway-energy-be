import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Delete,
  Patch,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
import { GetSessionUser } from 'src/auth/decorators/getUser';
import { ActionEnum, Agent, AgentCategory, SubjectEnum } from '@prisma/client';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiQuery,
  ApiExtraModels,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { DeviceAssignmentService } from '../services/device-assignment.service';
import {
  AssignDeviceDto,
  BulkAssignDevicesDto,
  ReassignDeviceDto,
} from '../dto/device-assignment.dto';
import { AgentAccessGuard } from 'src/auth/guards/agent-access.guard';
import { ListAgentDevicesQueryDto } from '../dto/list-agent-devices';
import { DeviceAssignmentMigrationService } from '../services/device-assignment-migration.service';

@Controller('devices/assignments')
@ApiTags('Device Assignments')
export class DeviceAssignmentController {
  constructor(
    private readonly service: DeviceAssignmentService,
    private readonly deviceAssignmentMigrationService: DeviceAssignmentMigrationService,
  ) {}

  /**
   * Assign device to agent - ONLY for unassigned devices
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Post('assign')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Assign Device to Agent',
    description: `Assign an unassigned device to a sales agent. 
    Device must not be currently assigned to any agent. 
    To move a device between agents, use the reassign endpoint.`,
  })
  @ApiBody({ type: AssignDeviceDto })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Agents}`],
  })
  async assignDevice(
    @Body() dto: AssignDeviceDto,
    @GetSessionUser('id') actorId: string,
  ) {
    return this.service.assignDevice(
      dto.deviceSerial,
      dto.agentId,
      actorId,
      dto.reason,
    );
  }

  /**
   * Reassign device from one agent to another
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Patch('reassign')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Reassign Device Between Agents',
    description: `Transfer a device from one sales agent to another. 
    Device must currently be assigned to the source agent.`,
  })
  @ApiBody({ type: ReassignDeviceDto })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Agents}`],
  })
  async reassignDevice(
    @Body() dto: ReassignDeviceDto,
    @GetSessionUser('id') actorId: string,
  ) {
    return this.service.reassignDevice(
      dto.deviceId,
      dto.fromAgentId,
      dto.toAgentId,
      actorId,
      dto.reason,
    );
  }

  /**
   * Bulk assign devices - only unassigned devices
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Post('assign-bulk')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Bulk Assign Devices',
    description: `Assign multiple unassigned devices to agent. 
    ATOMIC mode: Fails if any device not found or already assigned. 
    PARTIAL mode: Skips devices not found or already assigned, assigns the rest.`,
  })
  @ApiBody({ type: BulkAssignDevicesDto })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Agents}`],
  })
  async bulkAssignDevices(
    @Body() dto: BulkAssignDevicesDto,
    @GetSessionUser('id') actorId: string,
  ) {
    return this.service.bulkAssignDevices(
      dto.deviceSerials,
      dto.agentId,
      actorId,
      dto.mode,
      dto.reason,
    );
  }

  /**
   * Unassign device from agent
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Delete('unassign/:deviceId')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Unassign Device',
    description: 'Remove device from agent and return to unassigned pool',
  })
  @ApiParam({ name: 'deviceId', description: 'Device ID' })
  @ApiQuery({
    name: 'reason',
    description: 'Optional reason for unassignment',
    required: false,
  })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Agents}`],
  })
  async unassignDevice(
    @Param('deviceId') deviceId: string,
    @GetSessionUser('id') actorId: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.unassignDevice(deviceId, actorId, reason);
  }

  /**
   * Get unassigned devices (available for assignment)
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('unassigned')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Get Unassigned Devices',
    description: 'Get devices that have not been assigned to any agent yet',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Agents}`],
  })
  async getUnassignedDevices(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 100,
  ) {
    return this.service.getUnassignedDevices(page, limit);
  }

  /**
   * Get agent's assigned devices (agent endpoint)
   */
  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @Get('my-devices')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'My Assigned Devices',
    description: 'Get all devices assigned to the logged-in agent',
  })
  @ApiExtraModels(ListAgentDevicesQueryDto)
  async getMyDevices(
    @GetSessionUser('agent') agent: Agent,
    @Query() query: ListAgentDevicesQueryDto,
  ) {
    if (agent.category !== AgentCategory.SALES) {
      throw new ForbiddenException('Access denied - Sales Agent Access only');
    }
    return this.service.getAgentDevices(agent.id, query);
  }

  /**
   * Get agent's assigned devices (admin endpoint)
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('agent/:agentId/devices')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Get Agent Devices (Admin)',
    description: 'Admin view of devices assigned to a specific agent',
  })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Agents}`],
  })
  async getAgentDevices(
    @Param('agentId') agentId: string,
    @Query() query: ListAgentDevicesQueryDto,
  ) {
    return this.service.getAgentAssignedDevices(agentId, query);
  }

  /**
   * Get device assignment history by device ID
   */
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('history/:deviceId')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Device Assignment History',
    description: 'Get complete assignment history for a device (using device ID)',
  })
  @ApiParam({ name: 'deviceId', description: 'Device ID' })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Agents}`],
  })
  async getDeviceHistory(@Param('deviceId') deviceId: string) {
    return this.service.getDeviceHistory(deviceId);
  }

  /**
   * Backfill device assignments from sales (internal/migration)
   */
  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard)
  @Get('backfill')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Device Assignment Backfill',
    description: 'Backfill device assignments from sales',
  })
  async backfillDeviceAssignmentsFromSales() {
    return this.deviceAssignmentMigrationService.backfillDeviceAssignmentsFromSales();
  }
}