import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateAgentDto } from './dto/create-agent.dto';
import { PrismaService } from '../prisma/prisma.service';
import { generateRandomPassword } from '../utils/generate-pwd';
import { hashPassword } from '../utils/helpers.util';
import { GetAgentsDto, GetAgentsInstallersDto } from './dto/get-agent.dto';
import { MESSAGES } from '../constants';
import { ObjectId } from 'mongodb';
import {
  ActionEnum,
  Agent,
  AgentCategory,
  PaymentStatus,
  Prisma,
  SalesStatus,
  SubjectEnum,
  TaskStatus,
  TokenType,
  UserStatus,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from '../users/entity/user.entity';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../mailer/email.service';
import { GetAgentTaskQueryDto } from 'src/task-management/dto/get-task-query.dto';
import { DashboardFilterDto } from './dto/dashboard-filter.dto';
import { GetCommisionFilterDto } from './dto/get-commission-filter.dto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AgentCredentialInfo {
  id: string;
  agentId: number;
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  username: string;
  salesCount: number;
  category: AgentCategory;
}

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async create(createAgentDto: CreateAgentDto, userId) {
    const { email, location, category, ...otherData } = createAgentDto;

    const agentId = this.generateAgentNumber();

    const existingEmail = await this.prisma.user.findFirst({
      where: { email },
    });

    if (existingEmail) {
      throw new ConflictException('A user with this email already exists');
    }

    // Check if email or agentId already exists
    const existingAgent = await this.prisma.agent.findFirst({
      where: { userId },
    });

    if (existingAgent) {
      throw new ConflictException(`Agent with email ${email} already exists`);
    }

    const existingAgentId = await this.prisma.agent.findFirst({
      where: { agentId },
    });

    if (existingAgentId) {
      throw new ConflictException('Agent with the agent ID already exists');
    }

    const password = generateRandomPassword(30);
    const hashedPassword = await hashPassword(password);

    let defaultRole = await this.prisma.role.findFirst({
      where: {
        role: 'AssignedAgent',
        permissions: {
          some: {
            subject: SubjectEnum.Assignments,
            action: ActionEnum.manage,
          },
        },
      },
    });

    if (!defaultRole) {
      defaultRole = await this.prisma.role.create({
        data: {
          role: 'AssignedAgent',
          permissions: {
            create: {
              subject: SubjectEnum.Assignments,
              action: ActionEnum.manage,
            },
          },
        },
      });
    }

    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        location,
        roleId: defaultRole.id,
        ...otherData,
      },
    });

    await this.prisma.agent.create({
      data: {
        agentId,
        userId: newUser.id,
        category,
      },
    });

    if (category != AgentCategory.BUSINESS) {
      const resetToken = uuidv4();
      const expirationTime = new Date();
      expirationTime.setHours(expirationTime.getFullYear() + 1);

      const token = await this.prisma.tempToken.create({
        data: {
          token: resetToken,
          expiresAt: expirationTime,
          token_type: TokenType.email_verification,
          userId: newUser.id,
        },
      });

      const platformName = 'A4T Energy';
      const clientUrl = this.config.get<string>('CLIENT_URL');

      const createPasswordUrl = `${clientUrl}create-password/${newUser.id}/${token.token}/`;

      await this.Email.sendMail({
        userId: newUser.id,
        to: email,
        from: this.config.get<string>('MAIL_FROM'),
        subject: `Welcome to ${platformName} Agent Platform - Let's Get You Started!`,
        template: './new-user-onboarding',
        context: {
          firstname: `Agent ${newUser.firstname}`,
          userEmail: email,
          platformName,
          createPasswordUrl,
          supportEmail: this.config.get<string>('MAIL_FROM') || 'a4t@gmail.com',
        },
      });
    }

    return newUser;
  }

  async getAll(getProductsDto: GetAgentsDto) {
    const {
      page = 1,
      limit = 100,
      status,
      sortField,
      sortOrder,
      search,
      createdAt,
      updatedAt,
      category,
    } = getProductsDto;

    const whereConditions: Prisma.AgentWhereInput = {
      AND: [
        search
          ? {
              user: {
                OR: [
                  { firstname: { contains: search, mode: 'insensitive' } },
                  { lastname: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { username: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {},
        status ? { user: { status } } : {},
        category ? { category } : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
      ],
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    // Fetch Agents with pagination and filters
    const agents = await this.prisma.agent.findMany({
      where: whereConditions,
      include: {
        user: true,
        installerTask: true,
        assignedTasks: true,
        assignedProducts: true,
        assignedCustomers: true,
        assignedInstallers: {
          select: {
            agent: {
              select: {
                user: {
                  select: {
                    firstname: true,
                    lastname: true,
                    email: true,
                    location: true,
                    longitude: true,
                    latitude: true,
                  },
                },
              },
            },
          },
        },
      },
      skip,
      take,
      orderBy: {
        user: orderBy,
      },
    });

    const total = await this.prisma.agent.count({
      where: whereConditions,
    });

    return {
      agents: agents.map((agent) => ({
        ...agent,
        user: plainToInstance(UserEntity, agent.user),
      })),
      total,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(total / limitNumber),
    };
  }

  async findOne(id: string) {
    if (!this.isValidObjectId(id)) {
      throw new BadRequestException(`Invalid permission ID: ${id}`);
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });

    if (!agent) {
      throw new NotFoundException(MESSAGES.AGENT_NOT_FOUND);
    }

    return agent;
  }

  async getAgentDevices(agentId: string, status?: string) {
    const agent = await this.findOne(agentId);

    if (!agent) {
      throw new BadRequestException('Agent not found');
    }

    // Get devices from sales created by the agent's user
    const devices = await this.prisma.device.findMany({
      where: {
        saleItems: {
          some: {
            sale: {
              creatorId: agent.userId,
            },
          },
        },
        ...(status && { installation_status: status }),
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: {
                  select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    phone: true,
                    installationAddress: true,
                  },
                },
                payment: {
                  select: {
                    paymentStatus: true,
                    paymentDate: true,
                  },
                },
              },
            },
            product: {
              select: {
                name: true,
                category: true,
              },
            },
          },
        },
        tokens: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return devices;
  }

  async getAgentsStatistics() {
    // Count all agents
    const allAgents = await this.prisma.agent.count();

    // Count active agents by checking the status in the related User model
    const activeAgentsCount = await this.prisma.agent.count({
      where: {
        user: {
          status: UserStatus.active,
        },
      },
    });

    // Count barred agents by checking the status in the related User model
    const barredAgentsCount = await this.prisma.agent.count({
      where: {
        user: {
          status: UserStatus.barred,
        },
      },
    });

    // Throw an error if no agents are found
    if (!allAgents) {
      throw new NotFoundException('No agents found.');
    }

    return {
      total: allAgents,
      active: activeAgentsCount,
      barred: barredAgentsCount,
    };
  }

  async getAgentTabs(agentId: string) {
    if (!this.isValidObjectId(agentId)) {
      throw new BadRequestException(`Invalid permission ID: ${agentId}`);
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        user: {
          include: {
            _count: {
              select: { createdCustomers: true },
            },
          },
        },
      },
    });

    if (!agent) {
      throw new NotFoundException(MESSAGES.AGENT_NOT_FOUND);
    }

    const tabs = [
      {
        name: 'Agents Details',
        url: `/agent/${agentId}/details`,
      },
      {
        name: 'Customers',
        url: `/agent/${agentId}/customers`,
        count: agent.user._count.createdCustomers,
      },
      {
        name: 'Inventory',
        url: `/agent/${agentId}/inventory`,
        count: 0,
      },
      {
        name: 'Transactions',
        url: `/agent/${agentId}/transactions`,
        count: 0,
      },
      {
        name: 'Stats',
        url: `/agent/${agentId}/stats`,
      },
      {
        name: 'Sales',
        url: `/agent/${agentId}/sales`,
        count: 0,
      },
      {
        name: 'Tickets',
        url: `/agent/${agentId}/tickets`,
        count: 0,
      },
    ];

    return tabs;
  }

  async assignInstallersToAgent(
    agentId: string,
    installerIds: string[],
    assignedBy: string,
  ) {
    await this.findOne(agentId);

    const products = await this.prisma.agent.findMany({
      where: { id: { in: installerIds } },
    });

    if (products.length !== installerIds.length) {
      throw new BadRequestException('Some agents not found');
    }

    const alreadyAssigned = await this.prisma.agentInstallerAssignment.findMany(
      {
        where: {
          agentId,
          installerId: { in: installerIds },
        },
      },
    );

    if (alreadyAssigned.length > 0) {
      const assignedIds = alreadyAssigned.map((p) => p.installerId).join(', ');
      throw new BadRequestException(
        `Agent has already been assigned the following installer(s): ${assignedIds}`,
      );
    }

    await this.prisma.agentInstallerAssignment.createMany({
      data: installerIds.map((installerId) => ({
        agentId,
        installerId,
        assignedBy,
      })),
    });

    return { message: 'Agents assigned successfully' };
  }

  async unassignInstallerFromAgent(agentId: string, installerIds: string[]) {
    await this.findOne(agentId);

    const assigned = await this.prisma.agentInstallerAssignment.findMany({
      where: {
        agentId,
        installerId: { in: installerIds },
      },
    });

    if (assigned.length === 0) {
      throw new BadRequestException(
        'No matching installer-agent assignments found',
      );
    }

    await this.prisma.agentInstallerAssignment.deleteMany({
      where: {
        agentId,
        installerId: { in: installerIds },
      },
    });

    return { message: 'Products unassigned successfully' };
  }

  async getAgentInstallers(agentId: string, query?: GetAgentsInstallersDto) {
    const {
      page = 1,
      limit = 100,
      status,
      sortField,
      sortOrder,
      search,
      createdAt,
      updatedAt,
    } = query;

    const whereConditions: Prisma.AgentWhereInput = {
      AND: [
        search
          ? {
              user: {
                OR: [
                  { firstname: { contains: search, mode: 'insensitive' } },
                  { lastname: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { username: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {},
        status ? { user: { status } } : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
      ],
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    const installers = await this.prisma.agentInstallerAssignment.findMany({
      where: {
        agent: {
          id: agentId,
        },
        installer: {
          ...whereConditions,
        },
      },
      select: {
        installer: {
          select: {
            id: true,
            user: {
              select: {
                firstname: true,
                lastname: true,
                email: true,
                location: true,
                longitude: true,
                latitude: true,
              },
            },
          },
        },
      },
      skip,
      take,
      orderBy: {
        installer: {
          user: orderBy,
        },
      },
    });

    const total = await this.prisma.agentInstallerAssignment.count({
      where: {
        agent: {
          id: agentId,
        },
      },
    });

    return {
      installers: installers.map((installer) => {
        return {
          ...installer,
          ...installer.installer,
          ...installer.installer.user,
          installer: undefined,
          user: undefined,
        };
      }),
      total,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(total / limitNumber),
    };
  }

  async getAgentInstaller(agentId: string, installerId: string) {
    const installers = await this.prisma.agentInstallerAssignment.findFirst({
      where: { installerId },
      select: {
        installer: {
          select: {
            id: true,
            user: {
              select: {
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
              },
            },
            installerTask: true,
          },
        },
      },
    });

    if (!installers)
      throw new NotFoundException(`Agent with id (${agentId}) not found`);

    return installers;
  }

  async getAgentAssignments(agentId: string) {
    const agent = await this.findOne(agentId);

    if (!agent || agent.category !== AgentCategory.INSTALLER) {
      throw new BadRequestException('User is not an installer');
    }

    return await this.prisma.agentInstallerAssignment.findMany({
      where: { installerId: agentId },
      select: {
        agent: {
          select: {
            id: true,
            user: {
              select: {
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });
  }

  async assignProductsToAgent(
    agentId: string,
    productIds: string[],
    assignedBy: string,
  ) {
    await this.findOne(agentId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('Some products not found');
    }

    const alreadyAssigned = await this.prisma.agentProduct.findMany({
      where: {
        agentId,
        productId: { in: productIds },
      },
      select: { productId: true },
    });

    if (alreadyAssigned.length > 0) {
      const assignedIds = alreadyAssigned.map((p) => p.productId).join(', ');
      throw new BadRequestException(
        `Agent has already been assigned the following product(s): ${assignedIds}`,
      );
    }

    await this.prisma.agentProduct.createMany({
      data: productIds.map((productId) => ({
        agentId,
        productId,
        assignedBy,
      })),
    });

    return { message: 'Products assigned successfully' };
  }

  async unassignProductsFromAgent(agentId: string, productIds: string[]) {
    await this.findOne(agentId);

    const assigned = await this.prisma.agentProduct.findMany({
      where: {
        agentId,
        productId: { in: productIds },
      },
    });

    if (assigned.length === 0) {
      throw new BadRequestException(
        'No matching product-agent assignments found',
      );
    }

    const failed = [];
    for (const product of assigned) {
      const isInUse = await this.prisma.sales.findFirst({
        where: {
          agentId,
          saleItems: { some: { productId: product.productId } },
          status: {
            not: SalesStatus.CANCELLED,
          },
        },
      });

      if (isInUse) {
        failed.push(product.productId);
      }
    }

    if (failed.length > 0) {
      throw new BadRequestException(
        `Cannot unassign products that are in use: ${failed.join(', ')}`,
      );
    }

    await this.prisma.agentProduct.deleteMany({
      where: {
        agentId,
        productId: { in: productIds },
      },
    });

    return { message: 'Products unassigned successfully' };
  }

  async assignCustomersToAgent(
    agentId: string,
    customerIds: string[],
    assignedBy: string,
  ) {
    await this.findOne(agentId);

    const existing = await this.prisma.agentCustomer.findMany({
      where: {
        agentId,
        customerId: { in: customerIds },
      },
    });

    if (existing.length > 0) {
      const ids = existing.map((c) => c.customerId).join(', ');
      throw new BadRequestException(
        `Agent already assigned to customer(s): ${ids}`,
      );
    }

    await this.prisma.agentCustomer.createMany({
      data: customerIds.map((customerId) => ({
        agentId,
        customerId,
        assignedBy,
      })),
    });

    return { message: 'Customers assigned successfully' };
  }

  async unassignCustomersFromAgent(agentId: string, customerIds: string[]) {
    const assigned = await this.prisma.agentCustomer.findMany({
      where: {
        agentId,
        customerId: { in: customerIds },
      },
    });

    if (assigned.length === 0) {
      throw new BadRequestException(
        'No matching customer-agent assignments found',
      );
    }

    await this.prisma.agentCustomer.deleteMany({
      where: {
        agentId,
        customerId: { in: customerIds },
      },
    });

    return { message: 'Customers unassigned successfully' };
  }

  async getAgentUserId(agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true },
    });
    return agent?.userId;
  }

  async getAgentCommissions(agentId: string, query?: GetCommisionFilterDto) {
    const { page = 1, limit = 100, endDate, startDate } = query;
    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    // Base filter
    const where: Prisma.PaymentWhereInput = {
      sale: { creatorId: agent.userId },
      paymentStatus: PaymentStatus.COMPLETED,
    };

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = startDate;
      if (endDate) where.paymentDate.lte = endDate;
    }

    const commissionRate = 0.07; // 7%

    const [payments, totalCount, allPaymentsTotal] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          sale: {
            include: {
              customer: {
                select: {
                  firstname: true,
                  lastname: true,
                  phone: true,
                },
              },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where,
      }),
    ]);

    const commissionsData = payments.map((payment) => ({
      id: payment.id,
      transactionRef: payment.transactionRef,
      amount: payment.amount,
      commissionAmount: (payment.amount * commissionRate).toFixed(2),
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      customer: {
        name: `${payment.sale.customer.firstname} ${payment.sale.customer.lastname}`,
        phone: payment.sale.customer.phone,
      },
      saleId: payment.saleId,
    }));

    // Calculate summary using all payments, not just paginated
    const totalCommission =
      (allPaymentsTotal._sum.amount || 0) * commissionRate;

    return {
      data: commissionsData,
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
      summary: {
        agentType: agent.category,
        totalCommission,
        totalPayments: totalCount,
        commissionRate: (commissionRate * 100).toFixed(2),
      },
    };
  }

  async getAgentCommissionsByAdmin(
    agentId: string,
    query?: GetCommisionFilterDto,
  ) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (agent.category === AgentCategory.SALES) {
      return await this.getAgentCommissions(agent.id, query);
    } else if (agent.category === AgentCategory.INSTALLER) {
      return await this.getInstallerCommissions(agent.id, query);
    } else {
      throw new BadRequestException(
        'Invalid agent',
      );
    }
  }

  async getInstallerCommissions(
    installerId: string,
    query?: GetCommisionFilterDto,
  ) {
    const { page = 1, limit = 100, endDate, startDate } = query || {};
    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const installer = await this.prisma.agent.findUnique({
      where: { id: installerId, category: AgentCategory.INSTALLER },
      include: { user: true },
    });

    if (!installer) {
      throw new NotFoundException('Installer not found');
    }

    // Base filter for completed tasks
    const where: Prisma.InstallerTaskWhereInput = {
      installerAgentId: installerId,
      status: TaskStatus.COMPLETED,
    };

    // Add date filters if provided
    if (startDate || endDate) {
      where.completedDate = {};
      if (startDate) where.completedDate.gte = startDate;
      if (endDate) where.completedDate.lte = endDate;
    }

    const commissionPerTask = 2000; // 2000 Naira per completed task

    const [completedTasks, totalCount, allTasksCount] = await Promise.all([
      this.prisma.installerTask.findMany({
        where,
        include: {
          customer: {
            select: {
              firstname: true,
              lastname: true,
              phone: true,
              installationAddress: true,
            },
          },
          sale: {
            select: {
              id: true,
              totalPrice: true,
            },
          },
          requestingAgent: {
            include: {
              user: {
                select: {
                  firstname: true,
                  lastname: true,
                },
              },
            },
          },
        },
        orderBy: { completedDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.installerTask.count({ where }),
      this.prisma.installerTask.count({
        where: {
          installerAgentId: installerId,
          status: TaskStatus.COMPLETED,
          // ...(startDate || endDate
          //   ? {
          //       completedDate: {
          //         ...(startDate ? { gte: startDate } : {}),
          //         ...(endDate ? { lte: endDate } : {}),
          //       },
          //     }
          //   : {}),
        },
      }),
    ]);

    const commissionsData = completedTasks.map((task) => ({
      id: task.id,
      taskId: task.id,
      commissionAmount: commissionPerTask,
      completedDate: task.completedDate,
      scheduledDate: task.scheduledDate,
      customer: {
        name: `${task.customer.firstname} ${task.customer.lastname}`,
        phone: task.customer.phone,
        address: task.customer.installationAddress,
      },
      requestingAgent: task.requestingAgent
        ? `${task.requestingAgent.user.firstname} ${task.requestingAgent.user.lastname}`
        : null,
      saleId: task.saleId,
      saleAmount: task.sale?.totalPrice || 0,
      description: task.description,
    }));

    // Calculate total commission using all completed tasks in date range
    const totalCommission = allTasksCount * commissionPerTask;

    return {
      data: commissionsData,
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
      summary: {
        agentType: installer.category,
        totalCommission,
        totalCompletedTasks: allTasksCount,
        commissionPerTask,
        installer: {
          id: installer.id,
          agentId: installer.agentId,
          name: `${installer.user.firstname} ${installer.user.lastname}`,
        },
      },
    };
  }

  async getAgentDashboardStats(agentId: string, filters: DashboardFilterDto) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true, wallet: true },
    });

    if (!agent || agent.category !== AgentCategory.SALES) {
      throw new BadRequestException('Invalid agent or category');
    }

    const where: Prisma.SalesWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) {
        where.transactionDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.transactionDate.lte = filters.endDate;
      }
    }

    // product filter → must go through SaleItem
    // if (filters.productType) {
    //   where.saleItems = {
    //     some: {
    //       product: {
    //         id: filters.productType, // or product.type if you have enum
    //       },
    //     },
    //   };
    // }

    // apply filters when fetching sales stats
    const salesStats = await this.getSalesStatistics(agent.userId, where);
    const customerStats = await this.getCustomerStatistics(agentId);
    const walletInfo = await this.getWalletInfo(agentId);
    const recentTransactions = await this.getRecentTransactions(agentId);
    const monthlySalesData = await this.getMonthlySalesData(
      agent.userId,
      filters,
      where,
    );
    const transactionLineData = await this.getTransactionLineData(
      agentId,
      filters,
    );

    return {
      overview: {
        totalSales: salesStats.totalValue,
        salesCount: salesStats.count,
        totalCustomers: customerStats.total,
        walletBalance: walletInfo.balance,
      },
      salesStatistics: {
        totalValue: salesStats.totalValue,
        totalCount: salesStats.count,
        completedSales: salesStats.completed,
        pendingSales: salesStats.pending,
        monthlySalesData,
      },
      walletInfo: {
        balance: walletInfo.balance,
        recentTransactions,
      },
      charts: {
        salesGraph: monthlySalesData,
        transactionGraph: transactionLineData,
        productCategoriesPieChart: await this.getProductCategoriesData(
          agent.userId,
          where,
        ),
      },
    };
  }

  async generateAllAgentCredentials(): Promise<{
    filePath: string;
    totalAgents: number;
    newPasswordsGenerated: number;
  }> {
    try {
      // Fetch all agents with user details and sales count
      const agents = await this.prisma.agent.findMany({
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstname: true,
              lastname: true,
              username: true,
              password: true,
            },
          },
          sales: {
            select: {
              id: true,
            },
          },
        },
        orderBy: {
          agentId: 'asc',
        },
      });

      if (agents.length === 0) {
        throw new Error('No agents found in the database');
      }

      // const credentialsList: AgentCredentialInfo[] = [];
      let newPasswordsGenerated = 0;

      const credentialsList = [];

      // Process each agent
      for (const agent of agents) {
        console.log({ newPasswordsGenerated });
        const user = agent.user;

        const plainPassword = generateRandomPassword(12);
        const hashedPassword = await hashPassword(plainPassword);

        // Update user with new password
        await this.prisma.user.update({
          where: { id: user.id },
          data: { password: hashedPassword },
        });

        newPasswordsGenerated++;

        credentialsList.push({
          id: user.id,
          agentId: agent.agentId,
          email: user.email,
          password: plainPassword,
          firstname: user.firstname || 'N/A',
          lastname: user.lastname || 'N/A',
          username: user.username || 'N/A',
          salesCount: agent.sales.length,
          category: agent.category,
        });
      }

      const filePath = await this.generateCredentialsFile(credentialsList);

      const fileContent = await fs.readFile(filePath, 'utf8');
      const fileName = path.basename(filePath);

      await this.Email.sendMail({
        from: this.config.get<string>('EMAIL_USER'),
        to: 'francisalexander000@gmail.com',
        subject: `Agent Credentials Generated`,
        html: `<h1>🔐 Agent Credentials Generated Successfully</h1>`,
        attachments: [
          {
            filename: fileName,
            content: fileContent,
            contentType: 'text/plain',
          },
        ],
      });

      // Generate the credentials file
      // const filePath = await this.generateCredentialsFile(credentialsList);

      return {
        filePath,
        totalAgents: agents.length,
        newPasswordsGenerated,
      };
    } catch (error) {
      throw error;
    }
  }

  private async generateCredentialsFile(
    credentialsList: AgentCredentialInfo[],
    prefix: string = 'all_agents',
  ): Promise<string> {
    const fileName = `${prefix}_credentials_.txt`;
    const filePath = path.join(
      process.cwd(),
      'uploads',
      'agent_credentials',
      fileName,
    );

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const sortedCredentials = credentialsList.sort(
      (a, b) => a.agentId - b.agentId,
    );

    const content = [
      '='.repeat(100),
      'AGENT LOGIN CREDENTIALS',
      `Generated on: ${new Date().toISOString()}`,
      '='.repeat(100),
      '',
      ...sortedCredentials.map((agent, index) =>
        [
          `${index + 1}. Agent ID: ${agent.agentId}`,
          `   Name: ${agent.firstname} ${agent.lastname}`,
          `   Username: ${agent.username}`,
          `   Email: ${agent.email}`,
          `   Password: ${agent.password}`,
          `   Type: ${agent.category || 'SALES'}`,
          `   Sales Count: ${agent.salesCount}`,
          '-'.repeat(80),
          '',
        ].join('\n'),
      ),
      '='.repeat(100),
      'INSTRUCTIONS:',
      '1. Distribute these credentials securely to respective agents',
      '2. Advise agents to change passwords after first login',
      '3. Delete this file after credentials are distributed',
      '4. Monitor for any unauthorized access attempts',
      '='.repeat(100),
    ].join('\n');

    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  private async getProductCategoriesData(userId: string, where: any) {
    const salesWithCategories = await this.prisma.sales.findMany({
      where: { ...where, creatorId: userId },
      include: {
        saleItems: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    const categoryStats = new Map<string, { count: number; value: number }>();

    salesWithCategories.forEach((sale) => {
      sale.saleItems.forEach((item) => {
        const categoryName = item.product.category.name;
        const existing = categoryStats.get(categoryName) || {
          count: 0,
          value: 0,
        };
        existing.count += item.quantity;
        existing.value += item.totalPrice;
        categoryStats.set(categoryName, existing);
      });
    });

    const totalValue = Array.from(categoryStats.values()).reduce(
      (sum, cat) => sum + cat.value,
      0,
    );

    return Array.from(categoryStats.entries()).map(([name, stats]) => ({
      name,
      count: stats.count,
      value: stats.value,
      percentage:
        totalValue > 0 ? ((stats.value / totalValue) * 100).toFixed(2) : '0',
    }));
  }

  async getAgentTasks(agent: Agent, getTasksQuery?: GetAgentTaskQueryDto) {
    const {
      page = 1,
      limit = 10,
      agentId,
      sortField,
      sortOrder,
      search,
      status,
      customerId,
      isAssigned,
    } = getTasksQuery;

    const whereConditions: Prisma.InstallerTaskWhereInput = {
      AND: [
        search
          ? {
              OR: [
                {
                  installationAddress: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        agentId
          ? {
              requestingAgentId: agentId,
            }
          : {},
        customerId
          ? {
              customerId: customerId,
            }
          : {},
        isAssigned !== undefined
          ? {
              installerAgentId:
                isAssigned === false ? { isSet: false } : { not: null },
            }
          : {},
        agent.category === AgentCategory.INSTALLER
          ? {
              installerAgentId: agent.id,
            }
          : agent.category === AgentCategory.SALES
            ? {
                requestingAgentId: agent.id,
              }
            : {},
      ],
    };

    const finalWhereConditions = {
      ...whereConditions,
      ...(status ? { status } : {}),
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    const [tasks, total] = await Promise.all([
      this.prisma.installerTask.findMany({
        where: finalWhereConditions,
        skip,
        take,
        orderBy,
        include: {
          sale: {
            include: {
              saleItems: {
                include: {
                  product: true,
                  devices: true,
                },
              },
            },
          },
          customer: true,
          requestingAgent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  email: true,
                },
              },
            },
          },
          installerAgent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.installerTask.count({
        where: finalWhereConditions,
      }),
    ]);

    return {
      data: tasks,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async getAgentTask(agent: Agent, taskId?: string) {
    const task = await this.prisma.installerTask.findFirst({
      where: {
        id: taskId,
        AND: [
          agent.category === AgentCategory.INSTALLER
            ? {
                installerAgentId: agent.id,
              }
            : agent.category === AgentCategory.SALES
              ? {
                  requestingAgentId: agent.id,
                }
              : {},
        ],
      },
      include: {
        sale: {
          include: {
            saleItems: {
              include: {
                product: true,
                devices: true,
              },
            },
          },
        },
        customer: true,
        requestingAgent: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  private async getSalesStatistics(userId: string, where: any) {
    const sales = await this.prisma.sales.findMany({
      where: { ...where, creatorId: userId },
      include: { saleItems: true },
    });

    const totalValue = sales.reduce((sum, sale) => sum + sale.totalPrice, 0);
    const completed = sales.filter(
      (sale) => sale.status === SalesStatus.COMPLETED,
    ).length;
    const pending = sales.filter(
      (sale) => sale.status !== SalesStatus.COMPLETED,
    ).length;

    return {
      totalValue,
      count: sales.length,
      completed,
      pending,
    };
  }

  private async getCustomerStatistics(agentId: string) {
    const total = await this.prisma.customer.count({
      where: {
        assignedAgents: { some: { agentId: agentId } },
      },
    });

    return {
      total,
    };
  }

  private async getWalletInfo(agentId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { agentId },
    });

    return {
      balance: wallet?.balance || 0,
    };
  }

  private async getRecentTransactions(agentId: string) {
    return this.prisma.walletTransaction.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        createdAt: true,
        status: true,
      },
    });
  }

  private async getMonthlySalesData(
    userId: string,
    filters: DashboardFilterDto,
    where: any,
  ) {
    const dateWhere: any = {};

    if (filters.startDate || filters.endDate) {
      dateWhere.gte =
        filters.startDate ?? new Date(`${new Date().getFullYear()}-01-01`);
      dateWhere.lte =
        filters.endDate ?? new Date(`${new Date().getFullYear() + 1}-01-01`);
    } else {
      // fallback: current year
      const currentYear = new Date().getFullYear();
      dateWhere.gte = new Date(`${currentYear}-01-01`);
      dateWhere.lte = new Date(`${currentYear + 1}-01-01`);
    }

    const salesData = await this.prisma.sales.findMany({
      where: {
        creatorId: userId,
        createdAt: dateWhere,
        ...where,
      },
      select: {
        createdAt: true,
        totalPrice: true,
      },
    });

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(2000, i).toLocaleString('default', { month: 'short' }),
      sales: 0,
      value: 0,
    }));

    salesData.forEach((s) => {
      const idx = new Date(s.createdAt).getMonth();
      months[idx].sales += 1;
      months[idx].value += s.totalPrice;
    });

    return months;
  }

  private async getTransactionLineData(
    agentId: string,
    filters: DashboardFilterDto,
  ) {
    const dateWhere: any = {};

    if (filters.startDate || filters.endDate) {
      if (filters.startDate) dateWhere.gte = filters.startDate;
      if (filters.endDate) dateWhere.lte = filters.endDate;
    } else {
      const currentYear = new Date().getFullYear();
      dateWhere.gte = new Date(`${currentYear}-01-01`);
      dateWhere.lte = new Date(`${currentYear + 1}-01-01`);
    }

    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        agentId,
        createdAt: dateWhere,
      },
      select: {
        createdAt: true,
        amount: true,
      },
    });

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(2000, i).toLocaleString('default', { month: 'short' }),
      amount: 0,
      count: 0,
    }));

    transactions.forEach((t) => {
      const idx = new Date(t.createdAt).getMonth();
      months[idx].amount += t.amount;
      months[idx].count += 1;
    });

    return months;
  }

  async getAgentsByCategory(category: AgentCategory) {
    return this.prisma.agent.findMany({
      where: { category },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  }

  private generateAgentNumber(): number {
    return Math.floor(10000000 + Math.random() * 90000000);
  }

  // Helper function to validate MongoDB ObjectId
  private isValidObjectId(id: string): boolean {
    return ObjectId.isValid(id);
  }
}
