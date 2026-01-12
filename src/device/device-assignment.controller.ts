import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Delete,
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
import { DeviceAssignmentService } from './device-assignment.service';
import {
  AssignDeviceDto,
  BulkAssignDevicesDto,
} from './dto/device-assignment.dto';
import { AgentAccessGuard } from 'src/auth/guards/agent-access.guard';
import { ListAgentDevicesQueryDto } from './dto/list-agent-devices';
import { DeviceAssignmentMigrationService } from './device-assignment-migration.service';

@Controller('devices/assignments')
@ApiTags('Device Assignments')
export class DeviceAssignmentController {
  constructor(
    private readonly service: DeviceAssignmentService,
    private readonly deviceAssignmentMigrationService: DeviceAssignmentMigrationService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Post('assign')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Assign Device to Agent',
    description: `Assign a single device by 
    serial number to an agent. If device is already assigned to a different agent,
     it will be unassigned from that agent and reassigned to the new agent.`,
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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Post('assign-bulk')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Bulk Assign Devices',
    description: 'Assign multiple devices to agent (ATOMIC or PARTIAL mode)',
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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Delete('unassign/:deviceId')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Unassign Device',
    description: 'Unassign device from agent',
  })
  @ApiParam({ name: 'deviceId', description: 'Device id' })
  @ApiQuery({ name: 'reason', description: 'Optional reason for unassignment' })
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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('agent/:agentId')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Get Agent Devices (Admin)',
    description: 'Admin view of devices assigned to agent',
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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('history/:serial')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Device Assignment History',
    description: 'Get complete assignment history for a device',
  })
  @ApiParam({ name: 'serial', description: 'Device serial number' })
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Agents}`],
  })
  async getDeviceHistory(@Param('serial') serial: string) {
    return this.service.getDeviceHistory(serial);
  }

  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard)
  @Get('backfill')
  @ApiOperation({
    summary: 'Device Assignment Backfill',
    description: 'Backfill device assignments from sales',
  })
  @ApiParam({ name: 'serial', description: 'Device serial number' })
  async backfillDeviceAssignmentsFromSales() {
    return this.deviceAssignmentMigrationService.backfillDeviceAssignmentsFromSales();
  }
}
