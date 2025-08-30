import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { InstallerService } from 'src/installer/installer.service';
import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
import {
  ActionEnum,
  Agent,
  AgentCategory,
  SaleItem,
  Sales,
  SubjectEnum,
} from '@prisma/client';
import { GetSessionUser } from 'src/auth/decorators/getUser';
import { CreateTaskDto } from './dto/create-task.dto';
import { SalesService } from 'src/sales/sales.service';
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { TaskManagementService } from './task-management.service';
import { GetTaskQueryDto } from './dto/get-task-query.dto';
import { AssignInstallerDto } from './dto/assign-task.dto';
import { DeviceService } from 'src/device/device.service';

@Controller('tasks')
@ApiTags('Task Management')
export class TaskManagementController {
  constructor(
    private readonly installerService: InstallerService,
    private readonly taskManagementService: TaskManagementService,
    private readonly salesService: SalesService,
    private readonly deviceService: DeviceService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Post('create/:saleId')
  @ApiParam({
    name: 'id',
    description: 'Sale id to create task for (admin).',
  })
  @ApiOperation({
    description: 'CReate task (admin).',
  })
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
    ],
  })
  async createTask(
    @Body() createTaskDto: CreateTaskDto,
    @Param('saleId') saleId: string,
    @GetSessionUser('id') userId: string,
  ) {
    const sale = (await this.salesService.getSale(saleId)) as SaleItem & {
      sale: Sales;
    };

    return this.installerService.createTask({
      ...createTaskDto,
      saleId: sale.sale.id,
      customerId: sale.sale.customerId,
      assignedBy: userId,
      scheduledDate: createTaskDto.scheduledDate,
    });
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('')
  @ApiOperation({
    description: 'Get all tasks with optional filters (admin).',
  })
  @ApiExtraModels(GetTaskQueryDto)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
  async getTasks(@Query() getTasksQuery?: GetTaskQueryDto) {
    return this.taskManagementService.getTasks(getTasksQuery);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    description:
      'Assign task to installer agent (allowed for admins / sales agents -> their own installers',
  })
  @Post(':id/assign-installer-task')
  @ApiExtraModels(AssignInstallerDto)
  @ApiBody({ type: AssignInstallerDto })
  async assignInstaller(
    @Param('id') taskId: string,
    @Body() body: AssignInstallerDto,
    @GetSessionUser('id') adminId: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    await this.deviceService.validateUpdatePermissions(
      adminId,
      undefined,
      [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.write, subject: SubjectEnum.Sales },
      ],
      true,
      AgentCategory.SALES,
    );

    return this.taskManagementService.assignInstallerTask(
      taskId,
      body.installerAgentId,
      adminId,
      agent.id,
    );
  }
}
