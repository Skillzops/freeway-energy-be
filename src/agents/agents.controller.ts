import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import {
  ActionEnum,
  Agent,
  AgentCategory,
  SaleItem,
  Sales,
  SubjectEnum,
} from '@prisma/client';
import { GetAgentsDto, GetAgentsInstallersDto } from './dto/get-agent.dto';
import { GetSessionUser } from '../auth/decorators/getUser';
import { AgentAccessGuard } from '../auth/guards/agent-access.guard';
import { ProductsService } from '../products/products.service';
import { GetAgentsProductsDto } from '../products/dto/get-products.dto';
import { CustomersService } from '../customers/customers.service';
import { ListAgentCustomersQueryDto } from 'src/customers/dto/list-customers.dto';
import {
  AssignAgentCustomersDto,
  AssignAgentInstallerssDto,
  AssignAgentProductsDto,
} from './dto/assign-agent.dto';
import { ListAgentSalesQueryDto } from 'src/sales/dto/list-sales.dto';
import { SalesService } from 'src/sales/sales.service';
import { InstallerService } from 'src/installer/installer.service';
import { CreateTaskDto } from 'src/task-management/dto/create-task.dto';
import { CreateAgentSalesDto } from 'src/sales/dto/create-sales.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { ListDevicesQueryDto } from 'src/device/dto/list-devices.dto';
import { DeviceService } from 'src/device/device.service';
import { GetAgentTaskQueryDto } from 'src/task-management/dto/get-task-query.dto';
import { DashboardFilterDto } from './dto/dashboard-filter.dto';
import { GetCommisionFilterDto } from './dto/get-commission-filter.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@SkipThrottle()
@ApiTags('Agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly productsService: ProductsService,
    private readonly customersService: CustomersService,
    private readonly salesService: SalesService,
    private readonly deviceService: DeviceService,
    private readonly installerService: InstallerService,
    @InjectQueue('agent-queue') private agentQueue: Queue,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  @ApiOkResponse({
    description: 'Create agent',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: '67484835c95cd2fe2f0ac63e' },
        agentId: { type: 'number', example: 52520059 },
        userId: { type: 'string', example: '67484835c95cd2fe2f0ac63d' },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2024-11-28T10:38:45.906Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2024-11-28T10:38:45.906Z',
        },
        deletedAt: { type: 'string', nullable: true, example: null },
      },
    },
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.CREATED)
  @Post('create')
  async create(
    @Body() CreateAgentDto: CreateAgentDto,
    @GetSessionUser('id') id: string,
  ) {
    return await this.agentsService.create(CreateAgentDto, id);
  }

  // @Get('analyze-missing-installers')
  // async analyzeMissingInstallers() {
  //   return this.agentsService.analyzeMissingInstallerAccounts();
  // }

  // @Post('create-missing-installers')
  // async createMissingInstallers(@Body() body: { confirmCreate?: boolean }) {
  //   if (!body.confirmCreate) {
  //     return {
  //       error: 'Please confirm creation by setting confirmCreate to true',
  //       message:
  //         'This will create separate user accounts for installers. Use analyze endpoint first.',
  //     };
  //   }

  //   return this.agentsService.createMissingInstallerAccounts();
  // }

  // @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  // @RolesAndPermissions({
  //   permissions: [
  //     `${ActionEnum.manage}:${SubjectEnum.Agents}`,
  //     `${ActionEnum.read}:${SubjectEnum.Agents}`,
  //   ],
  // })
  // @ApiBearerAuth('access_token')
  // @ApiHeader({
  //   name: 'Authorization',
  //   description: 'JWT token used for authentication',
  //   required: true,
  //   schema: {
  //     type: 'string',
  //     example: 'Bearer <token>',
  //   },
  // })
  @Get()
  @ApiOkResponse({
    description: 'Fetch all agents with pagination',
    schema: {
      type: 'object',
      properties: {
        agents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: '6742722249c6bcb5fb8b296f' },
              agentId: { type: 'number', example: 94350766 },
              userId: { type: 'string', example: '6742722249c6bcb5fb8b296e' },
              createdAt: {
                type: 'string',
                format: 'date-time',
                example: '2024-11-24T00:24:02.180Z',
              },
              updatedAt: {
                type: 'string',
                format: 'date-time',
                example: '2024-11-24T00:24:02.180Z',
              },
              deletedAt: { type: 'string', nullable: true, example: null },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: '6742722249c6bcb5fb8b296e' },
                  firstname: { type: 'string', example: 'daniel' },
                  lastname: { type: 'string', example: 'paul' },
                  username: { type: 'string', nullable: true, example: null },
                  password: { type: 'string', example: '$argon2id$...' },
                  email: { type: 'string', example: 'john.doe12@example.com' },
                  phone: { type: 'string', nullable: true, example: null },
                  location: { type: 'string', example: '1234 Street' },
                  addressType: { type: 'string', example: 'HOME' },
                  staffId: { type: 'string', nullable: true, example: null },
                  longitude: { type: 'string', nullable: true, example: null },
                  latitude: { type: 'string', nullable: true, example: null },
                  emailVerified: { type: 'boolean', example: true },
                  isBlocked: { type: 'boolean', example: false },
                  status: { type: 'string', example: 'barred' },
                  roleId: {
                    type: 'string',
                    example: '670189eb3253ce51203d2c03',
                  },
                  createdAt: {
                    type: 'string',
                    format: 'date-time',
                    example: '2024-11-24T00:24:02.162Z',
                  },
                  updatedAt: {
                    type: 'string',
                    format: 'date-time',
                    example: '2024-11-24T00:24:02.162Z',
                  },
                  deletedAt: { type: 'string', nullable: true, example: null },
                  lastLogin: { type: 'string', nullable: true, example: null },
                },
              },
            },
          },
        },
        total: { type: 'number', example: 3 },
        page: { type: 'number', example: 1 },
        lastPage: { type: 'number', example: 1 },
        limit: { type: 'number', example: 10 },
      },
    },
  })
  @ApiOperation({
    summary: 'Fetch all agents with pagination',
    description: 'Fetch all agents with pagination',
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(GetAgentsDto)
  @HttpCode(HttpStatus.OK)
  async getAllAgents(@Query() GetAgentsDto: GetAgentsDto) {
    return this.agentsService.getAll(GetAgentsDto);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch agent products by agent' })
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
  @ApiExtraModels(GetAgentsProductsDto)
  @Get('products')
  async getAgentProducts(
    @Query() getAgentsProductsDto: GetAgentsProductsDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return await this.productsService.getAllProducts(
      {...getAgentsProductsDto, agentId: agent.id},
    );
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch single product by agent' })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the product to fetch',
  })
  @Get('product/:id')
  async getAgentProduct(
    @Param('id') id: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return this.productsService.getProduct(id, agent.id);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ summary: 'Fetch all agent sale devices' })
  @ApiExtraModels(ListDevicesQueryDto)
  @Get('devices')
  async fetchDevices(
    @Query() query: ListDevicesQueryDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return await this.deviceService.fetchDevices(query, agent.id);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiParam({
    name: 'id',
    description: 'Device id to fetch details for agent sale devices',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch a single device by ID' })
  @Get('device/:id')
  async fetchDevice(
    @Param('id') id: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return await this.deviceService.validateDeviceExistsAndReturn({
      id,
      saleItems: {
        some: {
          sale: {
            creatorId: agent.id,
          },
        },
      },
    });
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch agent customers by agent' })
  @Get('customers')
  @ApiBearerAuth('access_token')
  @ApiExtraModels(ListAgentCustomersQueryDto)
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  async getAgentCustomers(
    @Query() query: ListAgentCustomersQueryDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return this.customersService.getCustomers(query, agent.id);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch single customer by agent' })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the customer to fetch',
  })
  @Get('customer/:id')
  async getAgentCustomer(
    @Param('id') id: string,
    @GetSessionUser('agent') agent: Agent,
  ) {
    return this.customersService.getCustomer(id, agent.id);
  }

  @Post(':id/assign-products')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to assign products to',
  })
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  async assignProducts(
    @Param('id') agentId: string,
    @Body() body: AssignAgentProductsDto,
    @GetSessionUser('id') adminId: string,
  ) {
    return this.agentsService.assignProductsToAgent(
      agentId,
      body.productIds,
      adminId,
    );
  }

  @Post(':id/unassign-products')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to unassign products to',
  })
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  async unassignProductsFromAgent(
    @Param('id') agentId: string,
    @Body() body: AssignAgentProductsDto,
  ) {
    return this.agentsService.unassignProductsFromAgent(
      agentId,
      body.productIds,
    );
  }

  @Post(':id/assign-agent-installer')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to assign installers to',
  })
  @ApiBody({
    type: AssignAgentInstallerssDto,
    description: 'Json structure for request payload',
  })
  async assignInstallersToAgent(
    @Param('id') agentId: string,
    @Body() body: AssignAgentInstallerssDto,
    @GetSessionUser('id') adminId: string,
  ) {
    return this.agentsService.assignInstallersToAgent(
      agentId,
      body.installerIds,
      adminId,
    );
  }

  @Post(':id/unassign-agent-installer')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to unassign installers to',
  })
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  async unassignInstallerFromAgent(
    @Param('id') agentId: string,
    @Body() body: AssignAgentInstallerssDto,
  ) {
    return this.agentsService.unassignInstallerFromAgent(
      agentId,
      body.installerIds,
    );
  }

  @Post(':id/assign-customers')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to assign customers to',
  })
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  async assignCustomers(
    @Param('id') agentId: string,
    @Body() body: AssignAgentCustomersDto,
    @GetSessionUser('id') adminId: string,
  ) {
    return this.agentsService.assignCustomersToAgent(
      agentId,
      body.customerIds,
      adminId,
    );
  }

  @Post(':id/unassign-customers')
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.write}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to unassign customers to',
  })
  @ApiBody({
    type: CreateAgentDto,
    description: 'Json structure for request payload',
  })
  async unassignCustomersFromAgent(
    @Param('id') agentId: string,
    @Body() body: AssignAgentCustomersDto,
  ) {
    return this.agentsService.unassignCustomersFromAgent(
      agentId,
      body.customerIds,
    );
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch all installers for authenticated agent' })
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
  @ApiExtraModels(GetAgentsInstallersDto)
  @Get('installers')
  async getAgentInstallers(
    @GetSessionUser('agent') agent: Agent,
    @Query() query: GetAgentsInstallersDto,
  ) {
    if (!agent || agent.category !== AgentCategory.SALES) {
      throw new ForbiddenException('User is not an agent');
    }
    return await this.agentsService.getAgentInstallers(agent.id, query);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({
    description: 'Fetch single installer for authenticated agent',
  })
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
  @ApiParam({
    name: 'id',
    description: 'Agent Installer id to fetch details.',
  })
  @Get('installers/:id')
  async getAgentInstaller(
    @GetSessionUser('agent') agent: any,
    @Param('id') installerId: string,
  ) {
    if (!agent || agent.category !== AgentCategory.SALES) {
      throw new ForbiddenException('User is not an agent');
    }
    return await this.agentsService.getAgentInstaller(agent.id, installerId);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch all agents installers are assigned to' })
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
  @ApiExtraModels(ListAgentSalesQueryDto)
  @Get('assignments')
  async getAgentAssignments(@GetSessionUser('agent') agent: any) {
    return await this.agentsService.getAgentAssignments(agent.id);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch sales created by agent' })
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
  @ApiExtraModels(ListAgentSalesQueryDto)
  @Get('sales')
  async getAgentSales(
    @GetSessionUser('id') agentUserId: any,
    @Query() query: ListAgentSalesQueryDto,
  ) {
    return await this.salesService.getAllSales(query, agentUserId);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Fetch sale created by agent' })
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
  @ApiParam({
    name: 'id',
    description: 'Sale id to fetch details.',
  })
  @Get('sales/:id')
  async getSale(
    @Param('id') saleId: string,
    @GetSessionUser('id') agentUserId: any,
  ) {
    return await this.salesService.getSale(saleId, agentUserId);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({
    description: 'Get tasks by agent user (sales agent)',
  })
  @Get('tasks')
  async getTasks(
    @Query() getTasksQuery?: GetAgentTaskQueryDto,
    @GetSessionUser('agent') agent?: Agent,
  ) {
    return this.agentsService.getAgentTasks(agent, getTasksQuery);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({
    description: 'Get single task by agent user (installer or sales agent)',
  })
  @Get('tasks/:id')
  async getTask(
    @Param('id') taskId: string,
    @GetSessionUser('agent') agent?: Agent,
  ) {
    return this.agentsService.getAgentTask(agent, taskId);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({
    description: 'Create installation task by sales agent for a sale',
  })
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
  @ApiParam({
    name: 'saleId',
    description: 'Sale id to create installation task for details.',
  })
  @Post('create-installer-task')
  async createInstallerTask(
    @Body() createTaskDto: CreateTaskDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    const sale = (await this.salesService.getSale(
      createTaskDto.saleId,
    )) as SaleItem & {
      sale: Sales;
    };

    if (agent.category !== AgentCategory.SALES) {
      throw new ForbiddenException('Access denied - Sales agent only');
    }

    if (sale.sale.creatorId !== agent.userId) {
      throw new ForbiddenException('You do not have access to this sale');
    }

    return this.installerService.createTask({
      ...createTaskDto,
      customerId: sale.sale.customerId,
      requestingAgentId: agent.id,
      saleId: sale.sale.id,
      scheduledDate: createTaskDto.scheduledDate,
    });
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @ApiOperation({ description: 'Create sale by agent' })
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
  @ApiBody({
    type: CreateAgentSalesDto,
    description: 'Json structure for request payload',
  })
  @Post('create-sale')
  async createSale(
    @Body() createSalesDto: CreateAgentSalesDto,
    @GetSessionUser('agent') agent: Agent,
  ) {
    if (agent.category !== AgentCategory.SALES) {
      throw new ForbiddenException('Only normal agents can create sales');
    }

    return await this.salesService.createSale(
      agent.userId,
      createSalesDto,
      agent.id,
    );
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @Get('commissions')
  @ApiOperation({
    summary: 'Get agent sales commissions (sales/installer agent)',
  })
  @ApiExtraModels(GetCommisionFilterDto)
  async getCommissions(
    @GetSessionUser('agent') agent: Agent,
    @Query() query: GetCommisionFilterDto,
  ) {
    if (!agent) {
      throw new ForbiddenException();
    }

    if (agent.category === AgentCategory.SALES) {
      return await this.agentsService.getAgentCommissions(agent.id, query);
    } else if (agent.category === AgentCategory.INSTALLER) {
      return await this.agentsService.getInstallerCommissions(agent.id, query);
    } else {
      throw new BadRequestException(
        'Invalid agent category for commission calculation',
      );
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
  @Get(':agentId/commissions')
  @ApiOperation({ summary: 'Get agent commissions (Admin)' })
  @ApiExtraModels(GetCommisionFilterDto)
  async getAgentCommissionsAdmin(
    @Param('agentId') agentId: string,
    @Query() query: GetCommisionFilterDto,
  ) {
    return this.agentsService.getAgentCommissionsByAdmin(agentId, query);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiOkResponse({
    description: 'Fetch Agent statistics',
    schema: {
      type: 'object',

      properties: {
        total: { type: 'number', example: 3 },
        active: { type: 'number', example: 2 },
        barred: { type: 'number', example: 1 },
      },
    },
  })
  @ApiOperation({
    summary: 'Fetch Agent statistics',
    description: 'Fetch Agent statistics',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get('/statistics/view')
  async getAgentsStatistics() {
    return this.agentsService.getAgentsStatistics();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'Agent id to fetch tabs by admin',
  })
  @ApiOkResponse({
    description: 'Fetch Agent statistics',
    isArray: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Agents Details' },
          url: {
            type: 'string',
            example: '/agent/6742722249c6bcb5fb8b296f/details',
          },
          count: { type: 'number', nullable: true, example: null },
        },
        examples: {
          fixedExample: {
            value: [
              {
                name: 'Agents Details',
                url: '/agent/6742722249c6bcb5fb8b296f/details',
              },
              {
                name: 'Customers',
                url: '/agent/6742722249c6bcb5fb8b296f/customers',
                count: 0,
              },
              {
                name: 'Inventory',
                url: '/agent/6742722249c6bcb5fb8b296f/inventory',
                count: 0,
              },
              {
                name: 'Transactions',
                url: '/agent/6742722249c6bcb5fb8b296f/transactions',
                count: 0,
              },
              {
                name: 'Stats',
                url: '/agent/6742722249c6bcb5fb8b296f/stats',
              },
              {
                name: 'Sales',
                url: '/agent/6742722249c6bcb5fb8b296f/sales',
                count: 0,
              },
              {
                name: 'Tickets',
                url: '/agent/6742722249c6bcb5fb8b296f/tickets',
                count: 0,
              },
            ],
          },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Fetch Agent Tabs for a particular agent',
    description: 'Fetch Agent Tabs for a particular agent',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get(':id/tabs')
  async getInventoryTabs(@Param('id') agentId: string) {
    return this.agentsService.getAgentTabs(agentId);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @Get('overview')
  @ApiOperation({ summary: 'Get agent dashboard overview' })
  @ApiOkResponse({ description: 'Agent dashboard data' })
  @ApiExtraModels(DashboardFilterDto)
  async getDashboardOverview(
    @GetSessionUser('agent') agent: any,
    @Query() filters?: DashboardFilterDto,
  ) {
    return this.agentsService.getAgentDashboardStats(agent.id, filters);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
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
  @ApiParam({
    name: 'id',
    description: 'ID of the agent to fetch',
  })
  @ApiOkResponse({
    description: 'Details of an agent',
    schema: {
      type: 'object',

      properties: {
        id: { type: 'string', example: '6742722249c6bcb5fb8b296f' },
        agentId: { type: 'number', example: 94350766 },
        userId: { type: 'string', example: '6742722249c6bcb5fb8b296e' },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2024-11-24T00:24:02.180Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2024-11-24T00:24:02.180Z',
        },
        deletedAt: { type: 'string', nullable: true, example: null },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '6742722249c6bcb5fb8b296e' },
            firstname: { type: 'string', example: 'daniel' },
            lastname: { type: 'string', example: 'paul' },
            username: { type: 'string', nullable: true, example: null },
            password: { type: 'string', example: '$argon2id$...' },
            email: { type: 'string', example: 'john.doe12@example.com' },
            phone: { type: 'string', nullable: true, example: null },
            location: { type: 'string', example: '1234 Street' },
            addressType: { type: 'string', example: 'HOME' },
            staffId: { type: 'string', nullable: true, example: null },
            longitude: { type: 'string', nullable: true, example: null },
            latitude: { type: 'string', nullable: true, example: null },
            emailVerified: { type: 'boolean', example: true },
            isBlocked: { type: 'boolean', example: false },
            status: { type: 'string', example: 'barred' },
            roleId: { type: 'string', example: '670189eb3253ce51203d2c03' },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-11-24T00:24:02.162Z',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-11-24T00:24:02.162Z',
            },
            deletedAt: { type: 'string', nullable: true, example: null },
            lastLogin: { type: 'string', nullable: true, example: null },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Agent not found.',
  })
  @ApiOperation({
    summary: 'Fetch agent details',
    description: 'This endpoint allows a permitted user fetch a agent details.',
  })
  @Get(':id')
  async getAgent(@Param('id') id: string): Promise<Agent> {
    const agent = await this.agentsService.findOne(id);

    return agent;
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.read}:${SubjectEnum.Agents}`,
    ],
  })
  @Post('generate-all')
  async generateAllAgentCredentials() {
    try {
      await this.agentQueue.waitUntilReady();

      const job = await this.agentQueue.add(
        'process-agent-credentials',
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
    } catch (err) {
      console.log({ err });
    }

    // await this.agentsService.generateAllAgentCredentials();
    // return {
    //   success: true,
    //   message: 'Agent credentials generation proceessing',
    // };
  }
}
