import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { GetSessionUser } from '../auth/decorators/getUser';
import { AgentAccessGuard } from '../auth/guards/agent-access.guard';
import { Agent, AgentCategory } from '@prisma/client';
import { InstallerService } from './installer.service';
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UpdateDeviceLocationDto } from 'src/device/dto/update-device.dto';
import { DeviceService } from 'src/device/device.service';
import { AgentsService } from 'src/agents/agents.service';

@Controller('installer')
@ApiTags('Installer')
@UseGuards(JwtAuthGuard, AgentAccessGuard)
export class InstallerController {
  constructor(
    private readonly installerTaskService: InstallerService,
    private readonly deviceService: DeviceService,
    private readonly agentService: AgentsService,
  ) {}

  @Get('')
  @ApiOperation({ description: 'Get installer agents by sales agents' })
  async getInstallerAgents() {
    return this.agentService.getAgentsByCategory(AgentCategory.INSTALLER);
  }

  @Get('dashboard')
  async getDashboard(@GetSessionUser('agent') agent: Agent) {
    return await this.installerTaskService.getInstallerDashboard(agent.id);
  }

  @Post('tasks/:id/accept')
  async acceptTask(
    @Param('id') taskId: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.acceptTask(taskId, agent.id);
  }

  @Post('tasks/:id/reject')
  async rejectTask(
    @Param('id') taskId: string,
    @Body() body: { reason?: string },
    @GetSessionUser('agent') agent: Agent,
  ) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.rejectTask(taskId, agent.id, body.reason);
  }

  @Post('tasks/:id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.completeTask(taskId, agent.id);
  }

  @Get('installation-history')
  async getInstallationHistory(@GetSessionUser('agent') agent: Agent) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.getInstallationHistory(agent.id);
  }

  @Get('task-history')
  async getTaskHistory(@GetSessionUser('agent') agent: Agent) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.getTaskHistory(agent.id);
  }

  @Get('devices')
  @ApiOperation({
    summary: 'Get devices assigned to installer',
    description: 'Get all devices assigned to the current installer agent',
  })
  async getInstallerDevices(@GetSessionUser('agent') agent: Agent) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.deviceService.getDevicesForInstaller(agent.id);
  }

  @Post('tasks/:id/location')
  @ApiOperation({
    summary: 'Update device installation location',
    description: 'Update device location after installation completion',
  })
  @ApiParam({ name: 'id', description: 'Installation Task ID' })
  @ApiBody({ type: UpdateDeviceLocationDto })
  async updateInstallationLocation(
    @Param('id') taskId: string,
    @Body() locationData: UpdateDeviceLocationDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    if (agent.category !== AgentCategory.INSTALLER) {
      throw new ForbiddenException('Access denied - Installer only');
    }

    return this.installerTaskService.updateInstallationLocation(
      agent,
      taskId,
      locationData,
    );
  }

  //hot-fix endpoint
  @ApiExcludeEndpoint()
  @Get('revert-tasks-accepted')
  async revertTasksAccepted(
  ) {
    return await this.installerTaskService.revertTasksAccepted();
  }
  
}
