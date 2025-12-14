import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateAgentDto } from './dto/create-agent.dto';
import { PrismaService } from '../prisma/prisma.service';
import { generateRandomPassword } from '../utils/generate-pwd';
import { calculateDistance, cleanPhoneNumber, hashPassword } from '../utils/helpers.util';
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
import { TermiiService } from 'src/termii/termii.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../mailer/email.service';
import { GetAgentTaskQueryDto } from 'src/task-management/dto/get-task-query.dto';
import { DashboardFilterDto } from './dto/dashboard-filter.dto';
import { GetCommisionFilterDto } from './dto/get-commission-filter.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UpdateAgentDto } from './dto/update-agent.dto';

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

export interface AgentImportRow {
  name: string;
  surname: string;
  position: string;
  phone?: string;
  location?: string;
}

export interface CreatedAgent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  position: AgentCategory;
  phone?: string;
  location?: string;
  agentId: number;
  createdAt: string;
}

export interface AgentBulkImportResult {
  totalRecords: number;
  agentsCreated: number;
  usersCreated: number;
  errors: Array<{ row: number; error: string }>;
  createdAgents: CreatedAgent[];
  credentialsFile?: string;
}


export interface AgentImportRow {
  name: string;
  surname: string;
  position: string;
  phone?: string;
  location?: string;
}

export interface CreatedAgent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  position: AgentCategory;
  phone?: string;
  location?: string;
  agentId: number;
  createdAt: string;
}

export interface AgentBulkImportResult {
  totalRecords: number;
  agentsCreated: number;
  usersCreated: number;
  errors: Array<{ row: number; error: string }>;
  createdAgents: CreatedAgent[];
  credentialsFile?: string;
}

@Injectable()
export class AgentsService {
  private logger = new Logger(AgentsService.name);
  private agentCounter: number = 0;

  constructor(
    private prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private readonly termiiService: TermiiService,
  ) {}

  async create(createAgentDto: CreateAgentDto, userId) {
    const { email: emailFromDto, location, phone, category, ...otherData } = createAgentDto;

    let email = emailFromDto;
    if (!email) {
      email = await this.generateUniqueEmail(
        createAgentDto.firstname,
        createAgentDto.lastname
      );
    }

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

    const password = generateRandomPassword(10);
    const hashedPassword = await hashPassword(password);

    let defaultRole = await this.prisma.role.findFirst({
      where: {
        role: 'AssignedAgent',
      },
      include: {
        permissions: true,
      },
    });


    if (!defaultRole) {
      try {
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
          include: {
            permissions: true,
          },
        });
      } catch (error) {
        // If role already exists (race condition), fetch it
        if (error.code === 'P2002') {
          defaultRole = await this.prisma.role.findFirst({
            where: { role: 'AssignedAgent' },
            include: { permissions: true },
          });
        } else {
          throw error;
        }
      }
    }

    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        location,
        phone: cleanPhoneNumber(phone),
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


    if (newUser.phone) {
      try{
        await this.termiiService.sendSms({
          to: newUser.phone,
          message: await this.termiiService.formatAgentCredentialsMessage(
            newUser.firstname,
            email,
            password,
            category
          ),
          type: 'plain',
          channel: 'generic',
        });
      }catch (error){
        console.log({error})
      }
    }

    // if (category != AgentCategory.BUSINESS) {
    //   const resetToken = uuidv4();
    //   const expirationTime = new Date();
    //   expirationTime.setHours(expirationTime.getFullYear() + 1);

    //   const token = await this.prisma.tempToken.create({
    //     data: {
    //       token: resetToken,
    //       expiresAt: expirationTime,
    //       token_type: TokenType.email_verification,
    //       userId: newUser.id,
    //     },
    //   });

    //   const platformName = 'A4T Energy';
    //   const clientUrl = this.config.get<string>('CLIENT_URL');

    //   const createPasswordUrl = `${clientUrl}create-password/${newUser.id}/${token.token}/`;

    //   await this.Email.sendMail({
    //     userId: newUser.id,
    //     to: email,
    //     from: this.config.get<string>('MAIL_FROM'),
    //     subject: `Welcome to ${platformName} Agent Platform - Let's Get You Started!`,
    //     template: './new-user-onboarding',
    //     context: {
    //       firstname: `Agent ${newUser.firstname}`,
    //       userEmail: email,
    //       platformName,
    //       createPasswordUrl,
    //       supportEmail: this.config.get<string>('MAIL_FROM') || 'a4t@gmail.com',
    //     },
    //   });
    // }

    return newUser;
  }

  async updateAgentDetails(agentId: string, updateAgentDto: UpdateAgentDto) {
    if (!this.isValidObjectId(agentId)) {
      throw new BadRequestException(`Invalid agent ID: ${agentId}`);
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (!agent) {
      throw new NotFoundException(MESSAGES.AGENT_NOT_FOUND);
    }

    // Check if email is being updated and if it's already taken
    if (updateAgentDto.email && updateAgentDto.email !== agent.user.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: {
          email: updateAgentDto.email,
          id: { not: agent.userId }, // Exclude current user
        },
      });

      if (existingEmail) {
        throw new ConflictException('Email is already in use by another user');
      }
    }

    // Prepare update data for user
    const userUpdateData: any = {};

    if (updateAgentDto.firstname) {
      userUpdateData.firstname = updateAgentDto.firstname;
    }

    if (updateAgentDto.lastname) {
      userUpdateData.lastname = updateAgentDto.lastname;
    }

    if (updateAgentDto.email) {
      userUpdateData.email = updateAgentDto.email;
    }

    if (updateAgentDto.phone) {
      userUpdateData.phone = cleanPhoneNumber(updateAgentDto.phone);
    }

    if (updateAgentDto.location) {
      userUpdateData.location = updateAgentDto.location;
    }

    if (updateAgentDto.addressType) {
      userUpdateData.addressType = updateAgentDto.addressType;
    }

    if (updateAgentDto.latitude !== undefined) {
      userUpdateData.latitude = updateAgentDto.latitude;
    }

    if (updateAgentDto.longitude !== undefined) {
      userUpdateData.longitude = updateAgentDto.longitude;
    }

    // Update user details
    const updatedUser = await this.prisma.user.update({
      where: { id: agent.userId },
      data: userUpdateData,
    });

    return updatedUser;
  }

  async getAll(getProductsDto: GetAgentsDto) {
    const {
      page = 1,
      limit = 100,
      status,
      sortField = "createdAt",
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
        sales: {
          select: {
            id: true,
            status: true,
            saleItems: {
              select: {
                devices: {
                  select: {
                    id: true,
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

    const agentsWithStats = await Promise.all(
      agents.map(async (agent) => {
        const totalAssignedCustomers = agent.assignedCustomers.length;

        const totalSales = agent.sales.length;

        const totalInventoryInPossession = agent.sales.reduce((sum, sale) => {
          const deviceCount = sale.saleItems.reduce(
            (itemSum, item) => itemSum + item.devices.length,
            0,
          );
          return sum + deviceCount;
        }, 0);

        const ongoingSales = agent.sales.filter(
          (sale) =>
            sale.status === SalesStatus.IN_INSTALLMENT ||
            sale.status === SalesStatus.UNPAID,
        ).length;

        return {
          ...agent,
          user: plainToInstance(UserEntity, agent.user),
          statistics: {
            totalRegisteredCustomers: totalAssignedCustomers,
            totalSales,
            totalInventoryInPossession,
            ongoingSales,
          },
        };
      }),
    );

    return {
      agents: agentsWithStats,
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
    // Get the requesting agent's location
    const requestingAgent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        user: {
          select: {
            longitude: true,
            latitude: true,
          },
        },
      },
    });

    if (!requestingAgent) {
      throw new NotFoundException('Agent not found');
    }

    const RADIUM_KM = 50;

    // Get all installers
    const allInstallers = await this.prisma.agent.findMany({
      where: {
        category: AgentCategory.INSTALLER,
        user: {
          status: UserStatus.active,
        },
      },
      include: {
        user: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            longitude: true,
            latitude: true,
          },
        },
        assignedAsInstaller: {
          where: { agentId },
          select: { id: true },
        },
      },
    });

    // Filter by distance if requesting agent has coordinates
    let nearbyInstallers = allInstallers;

    if (requestingAgent.user.longitude && requestingAgent.user.latitude) {
      const agentLat = parseFloat(requestingAgent.user.latitude);
      const agentLon = parseFloat(requestingAgent.user.longitude);

      nearbyInstallers = allInstallers.filter((installer) => {
        if (!installer.user.longitude || !installer.user.latitude) return false;

        const installerLat = parseFloat(installer.user.latitude);
        const installerLon = parseFloat(installer.user.longitude);

        const distance = calculateDistance(
          agentLat,
          agentLon,
          installerLat,
          installerLon,
        );
        return distance <= RADIUM_KM;
      });

      // Sort by distance (closest first)
      nearbyInstallers.sort((a, b) => {
        const distanceA = calculateDistance(
          agentLat,
          agentLon,
          parseFloat(a.user.latitude),
          parseFloat(a.user.longitude),
        );
        const distanceB = calculateDistance(
          agentLat,
          agentLon,
          parseFloat(b.user.latitude),
          parseFloat(b.user.longitude),
        );
        return distanceA - distanceB;
      });
    }

    // Add directly assigned installers even if they're outside radius
    const directlyAssignedIds = new Set(
      nearbyInstallers
        .filter((i) => i.assignedAsInstaller.length > 0)
        .map((i) => i.id),
    );

    const directlyAssigned = allInstallers.filter(
      (installer) =>
        installer.assignedAsInstaller.length > 0 &&
        !directlyAssignedIds.has(installer.id),
    );

    const finalInstallers = [...nearbyInstallers, ...directlyAssigned];

    // Apply pagination and search filters
    let filteredInstallers = finalInstallers;

    if (query?.search) {
      filteredInstallers = finalInstallers.filter(
        (installer) =>
          installer.user.firstname
            ?.toLowerCase()
            .includes(query.search.toLowerCase()) ||
          installer.user.lastname
            ?.toLowerCase()
            .includes(query.search.toLowerCase()) ||
          installer.user.email
            ?.toLowerCase()
            .includes(query.search.toLowerCase()),
      );
    }

    const total = filteredInstallers.length;
    const pageNumber = parseInt(String(query?.page || 1), 10);
    const limitNumber = parseInt(String(query?.limit || 100), 10);
    const skip = (pageNumber - 1) * limitNumber;

    const paginatedInstallers = filteredInstallers.slice(
      skip,
      skip + limitNumber,
    );

    return {
      installers: paginatedInstallers.map((installer) => ({
        ...installer,
        isDirectlyAssigned: installer.assignedAsInstaller.length > 0,
        distance:
          requestingAgent.user.longitude &&
          requestingAgent.user.latitude &&
          installer.user.longitude &&
          installer.user.latitude
            ? calculateDistance(
                parseFloat(requestingAgent.user.latitude),
                parseFloat(requestingAgent.user.longitude),
                parseFloat(installer.user.latitude),
                parseFloat(installer.user.longitude),
              )
            : null,
      })),
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
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
      ...(startDate || endDate
        ? {
            sale: {
              createdAt: {
                ...(startDate ? { gte: new Date(startDate) } : {}),
                ...(endDate ? { lte: new Date(endDate) } : {}),
              },
            },
          }
        : {}),
    };

    // if (startDate || endDate) {
    //   where.paymentDate = {};
    //   if (startDate) where.paymentDate.gte = startDate;
    //   if (endDate) where.paymentDate.lte = endDate;
    // }

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
      throw new BadRequestException('Invalid agent');
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
      ...(startDate || endDate
        ? {
            sale: {
              createdAt: {
                ...(startDate ? { gte: new Date(startDate) } : {}),
                ...(endDate ? { lte: new Date(endDate) } : {}),
              },
            },
          }
        : {}),
    };

    // Add date filters if provided
    // if (startDate || endDate) {
    //   // where.completedDate = {};
    //   // if (startDate) where.completedDate.gte = startDate;
    //   // if (endDate) where.completedDate.lte = endDate;
    // }

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
      sortField = "createdAt",
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
        where: {...finalWhereConditions,  NOT: {
          // sale: null,
          sale: {
            customer: null,
          },
        },},
        skip,
        take,
        orderBy,
        include: {
          sale: {
            include: {
              saleItems: {
                include: {
                  product: true,
                  devices: {
                    include: {
                      tokens: true,
                    },
                  },
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

  /**
   * Analyze sales records to find installer names that don't have separate installer accounts
   */
  async analyzeMissingInstallerAccounts(): Promise<{
    missingAccounts;
    summary: {
      totalUniqueInstallers: number;
      missingInstallerAccounts: number;
      existingInstallerAccounts: number;
    };
  }> {
    // Get all sales with installer names
    const salesWithInstallers = await this.prisma.sales.findMany({
      where: {
        installerName: { not: null },
      },
      select: {
        installerName: true,
        agentName: true,
        creatorId: true,
      },
    });

    // Get all existing installer agents
    const existingInstallers = await this.prisma.agent.findMany({
      where: {
        category: AgentCategory.INSTALLER,
      },
      include: {
        user: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
            username: true,
          },
        },
      },
    });

    // Get all sales agents
    const existingSalesAgents = await this.prisma.agent.findMany({
      where: {
        category: AgentCategory.SALES,
      },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            username: true,
          },
        },
      },
    });

    // Group sales by installer name
    const installerGroups = new Map<string, typeof salesWithInstallers>();
    salesWithInstallers.forEach((sale) => {
      if (sale.installerName) {
        const normalizedName = this.normalizeName(sale.installerName);
        if (!installerGroups.has(normalizedName)) {
          installerGroups.set(normalizedName, []);
        }
        installerGroups.get(normalizedName)!.push(sale);
      }
    });

    // Create a map of existing installer names
    const existingInstallerNames = new Set(
      existingInstallers.map((installer) =>
        this.normalizeName(
          `${installer.user.firstname} ${installer.user.lastname}`,
        ),
      ),
    );

    // Create a map of sales agent names to their details
    const salesAgentMap = new Map();
    existingSalesAgents.forEach((agent) => {
      const normalizedName = this.normalizeName(
        `${agent.user.firstname} ${agent.user.lastname}`,
      );
      salesAgentMap.set(normalizedName, {
        agentId: agent.agentId,
        userId: agent.user.id,
        email: agent.user.email,
        username: agent.user.username,
      });
    });

    // Find missing installer accounts
    const missingAccounts = [];

    for (const [installerName, salesRecords] of installerGroups) {
      if (!existingInstallerNames.has(installerName)) {
        const existingSalesAgent = salesAgentMap.get(installerName);

        missingAccounts.push({
          installerName: salesRecords[0].installerName!, // Use original name
          salesCount: salesRecords.length,
          existingSalesAgent,
          shouldCreateSeparateAccount: true,
        });
      }
    }

    return {
      missingAccounts,
      summary: {
        totalUniqueInstallers: installerGroups.size,
        missingInstallerAccounts: missingAccounts.length,
        existingInstallerAccounts: existingInstallerNames.size,
      },
    };
  }

  /**
   * Create missing installer accounts with separate credentials
   */
  async createMissingInstallerAccounts(): Promise<{
    created: any;
    errors: string[];
    credentialsFile?: string;
  }> {
    const analysis = await this.analyzeMissingInstallerAccounts();
    const created = [];
    const errors = [];

    for (const missingAccount of analysis.missingAccounts) {
      try {
        const createdAccount =
          await this.createInstallerAccount(missingAccount);
        created.push(createdAccount);
      } catch (error) {
        const errorMsg = `Failed to create installer account for ${missingAccount.installerName}: ${error.message}`;
        errors.push(errorMsg);
      }
    }

    // Generate credentials file
    let credentialsFile: string | undefined;
    if (created.length > 0) {
      credentialsFile = await this.generateInstallerCredentialsFile(created);
    }

    return {
      created,
      errors,
      credentialsFile,
    };
  }

  private async createInstallerAccount(missingAccount) {
    const parsedName = this.parseFullName(missingAccount.installerName);
    const plainPassword = generateRandomPassword(12);
    const hashedPassword = await hashPassword(plainPassword);

    // Generate unique username and email for installer
    const baseUsername = this.generateUsername(
      parsedName.firstname,
      parsedName.lastname,
    );
    const installerUsername = `${baseUsername}.installer`;
    const installerEmail = `${baseUsername}.installer@gmail.com`;

    // Get default role
    const defaultRole = await this.prisma.role.findFirst({
      where: {
        role: 'AssignedAgent',
      },
    });

    if (!defaultRole) {
      throw new Error('Default agent role not found');
    }

    // Create new user for installer
    const newUser = await this.prisma.user.create({
      data: {
        firstname: parsedName.firstname,
        lastname: parsedName.lastname,
        username: installerUsername,
        email: installerEmail,
        password: hashedPassword,
        roleId: defaultRole.id,
      },
    });

    // Create installer agent
    const nextAgentId = Math.floor(10000000 + Math.random() * 90000000);
    const newAgent = await this.prisma.agent.create({
      data: {
        agentId: nextAgentId,
        userId: newUser.id,
        category: AgentCategory.INSTALLER,
      },
    });

    // Update installer tasks to reference the new installer agent
    await this.prisma.installerTask.updateMany({
      where: {
        installerAgent: null, // Tasks that don't have an installer agent assigned
        // You might need to add more specific criteria here
      },
      data: {
        installerAgentId: newAgent.id,
      },
    });

    return {
      installerName: missingAccount.installerName,
      newUserId: newUser.id,
      newAgentId: nextAgentId,
      email: installerEmail,
      username: installerUsername,
      password: plainPassword,
      linkedToSalesAgent: missingAccount.existingSalesAgent?.email,
    };
  }

  private parseFullName(fullName: string): {
    firstname: string;
    lastname: string;
  } {
    if (!fullName || fullName.trim() === '') {
      return { firstname: 'Unknown', lastname: 'Installer' };
    }

    const names = fullName
      .trim()
      .split(' ')
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      return { firstname: 'Unknown', lastname: 'Installer' };
    } else if (names.length === 1) {
      return { firstname: names[0], lastname: 'Installer' };
    } else {
      return {
        firstname: names[0],
        lastname: names.slice(1).join(' '),
      };
    }
  }

  private generateUsername(firstname: string, lastname: string): string {
    const base = `${firstname.trim().toLowerCase()}.${lastname.trim().toLowerCase()}`;
    const timestamp = Date.now().toString().slice(-4);
    return `${base}.${timestamp}`.replace(/[^a-z0-9.]/g, '');
  }

  private normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private async generateInstallerCredentialsFile(accounts): Promise<string> {
    const fileName = `missing_installer_accounts_${Date.now()}.txt`;
    const filePath = path.join(
      process.cwd(),
      'uploads',
      'agent_credentials',
      fileName,
    );

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const content = [
      '='.repeat(80),
      'NEWLY CREATED INSTALLER ACCOUNTS',
      `Generated on: ${new Date().toISOString()}`,
      `Total New Installer Accounts: ${accounts.length}`,
      '='.repeat(80),
      '',
      'These installer accounts were missing and have now been created:',
      '',
      ...accounts.map((account, index) =>
        [
          `${index + 1}. Installer Name: ${account.installerName}`,
          `   Agent ID: ${account.newAgentId}`,
          `   Username: ${account.username}`,
          `   Email: ${account.email}`,
          `   Password: ${account.password}`,
          `   User ID: ${account.newUserId}`,
          ...(account.linkedToSalesAgent
            ? [`   Related Sales Agent: ${account.linkedToSalesAgent}`]
            : []),
          '-'.repeat(50),
        ].join('\n'),
      ),
      '',
      'NOTE: These are separate accounts from any sales agents with the same names.',
      'Each installer has their own unique login credentials.',
      '='.repeat(80),
    ].join('\n');

    await fs.writeFile(filePath, content, 'utf8');

    // Optionally send email with credentials
    await this.Email.sendMail({
      to: 'francisalexander000@gmail.com',
      from: this.config.get<string>('MAIL_FROM'),
      subject: 'New Installer Accounts Created',
      html: `
        <h2>Missing Installer Accounts Created</h2>
        <p>${accounts.length} new installer accounts have been created.</p>
        <p>Please find the credentials file attached.</p>
      `,
      attachments: [
        {
          filename: fileName,
          path: filePath,
          contentType: 'text/plain',
        },
      ],
    });

    return filePath;
  }

  private async getSalesStatistics(userId: string, where: any) {
    const sales = await this.prisma.sales.findMany({
      where: { ...where, saleItems: { some: {} }, creatorId: userId },
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

  private async initializeAgentCounter() {
    try {
      const lastAgent = await this.prisma.agent.findFirst({
        orderBy: { agentId: 'desc' },
      });
      this.agentCounter = lastAgent ? lastAgent.agentId : 0;
    } catch (error) {
      this.logger.warn('Could not initialize agent counter: ' + error.message);
      this.agentCounter = 0;
    }
  }

  // ADD THIS METHOD to your bulk-agent-import.service-FIXED.ts

  /**
   * Detect delimiter (tab or multiple spaces)
   */
  private detectDelimiter(csvContent: string): string {
    const lines = csvContent.trim().split('\n');
    if (lines.length === 0) return '\t';

    const firstLine = lines[0];

    // Count tabs
    const tabCount = (firstLine.match(/\t/g) || []).length;

    // Count multiple spaces (2+)
    const spaceCount = (firstLine.match(/\s{2,}/g) || []).length;

    // If more spaces than tabs, use space delimiter
    if (spaceCount > tabCount) {
      return ' '; // Will be handled as multiple spaces in split
    }

    return '\t';
  }

  /**
   * Enhanced parse CSV that handles both tab and space delimiters
   */
  private parseCsv(csvContent: string): AgentImportRow[] {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV must contain headers and at least one data row',
      );
    }

    // Detect delimiter
    const delimiter = this.detectDelimiter(csvContent);
    let headers: string[];

    if (delimiter === ' ') {
      // Split by multiple spaces
      headers = lines[0].split(/\s{2,}/).map((h) => h.trim().toLowerCase());
    } else {
      // Split by tabs
      headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
    }
    console.log({ csvContent, delimiter, headers });

    // Find column indices
    const columnIndices = {
      name: headers.indexOf('name'),
      surname: headers.indexOf('surname'),
      position: headers.indexOf('position'),
      phone: headers.indexOf('phone'),
      location: headers.indexOf('location'),
    };

    // Validate required columns
    if (
      columnIndices.name === -1 ||
      columnIndices.surname === -1 ||
      columnIndices.position === -1 ||
      columnIndices.phone === -1 ||
      columnIndices.location === -1
    ) {
      throw new BadRequestException(
        `CSV must contain "NAME", "SURNAME", "POSITION", "PHONE", and "LOCATION" columns. Found: ${headers.join(', ')}`,
      );
    }

    const parsedRows: AgentImportRow[] = [];

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      let columns: string[];

      if (delimiter === ' ') {
        // Split by multiple spaces
        columns = line.split(/\s{2,}/).map((c) => c.trim());
      } else {
        // Split by tabs
        columns = line.split('\t').map((c) => c.trim());
      }

      if (
        columns.length > columnIndices.name &&
        columns.length > columnIndices.surname &&
        columns.length > columnIndices.position &&
        columns.length > columnIndices.phone &&
        columns.length > columnIndices.location
      ) {
        const name = columns[columnIndices.name];
        const surname = columns[columnIndices.surname];
        const position = columns[columnIndices.position];
        const phone = columns[columnIndices.phone];
        const location = columns[columnIndices.location];

        if (name && surname && position) {
          parsedRows.push({
            name,
            surname,
            position,
            phone,
            location,
          });
        }
      }
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException(
        'CSV file contains headers but no valid data rows. Check formatting.',
      );
    }

    return parsedRows;
  }

  /**
   * Normalize position to AgentCategory
   */
  private normalizePosition(position: string): AgentCategory {
    const normalized = position.trim().toUpperCase();

    if (normalized.includes('SALES')) {
      return 'SALES';
    } else if (normalized.includes('INSTALLER')) {
      return 'INSTALLER';
    }

    // Default to SALES if unknown
    return 'SALES';
  }

  /**
   * Generate unique email
   */
  private async generateUniqueEmail(
    firstName: string,
    lastName: string,
    attempt: number = 0,
  ): Promise<string> {
    const baseEmail = `${firstName.toLowerCase() || "user"}.${lastName.toLowerCase() || "ln"}`;
    const email =
      attempt === 0
        ? `${baseEmail}@gmail.com`
        : `${baseEmail}${attempt}@gmail.com`;

    // Check if email exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // Try next attempt
      return this.generateUniqueEmail(firstName, lastName, attempt + 1);
    }

    return email;
  }

  /**
   * Generate unique username
   */
  private async generateUniqueUsername(
    firstName: string,
    lastName: string,
    attempt: number = 0,
  ): Promise<string> {
    const baseUsername =
      `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}`.substring(
        0,
        20,
      );
    const username = attempt === 0 ? baseUsername : `${baseUsername}${attempt}`;

    // Check if username exists
    const existingUser = await this.prisma.user.findFirst({
      where: { username },
    });

    if (existingUser) {
      // Try next attempt
      return this.generateUniqueUsername(firstName, lastName, attempt + 1);
    }

    return username;
  }

  /**
   * Generate random password
   */
  private generatePassword(length: number = 12): string {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';

    // Ensure at least one uppercase, one lowercase, one number, one special char
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
    password += '0123456789'[Math.floor(Math.random() * 10)];
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)];

    // Fill rest with random characters
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle password
    password = password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');

    return password;
  }

  /**
   * Get agent role ID
   */
  private async getAgentRoleId(): Promise<string> {
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

    return defaultRole.id;
  }

  /**
   * Create user and agent profile
   */
  private async createAgentUser(
    row: AgentImportRow,
  ): Promise<{ user: any; agent: any; credentials: CreatedAgent }> {
    try {
      // Generate unique credentials
      const email = await this.generateUniqueEmail(row.name, row.surname);
      const username = await this.generateUniqueUsername(row.name, row.surname);
      const plainPassword = generateRandomPassword(10);
      const hashedPassword = await hashPassword(plainPassword);

      // Normalize position
      const position = this.normalizePosition(row.position);

      // Get agent role
      // const roleId = await this.getAgentRoleId();

      // Create user with phone and location
      const user = await this.prisma.user.create({
        data: {
          firstname: row.name,
          lastname: row.surname,
          username,
          email,
          password: hashedPassword,
          phone: cleanPhoneNumber(row.phone) || null,
          location: row.location || null,
          roleId: '687a8565e7b4874bfbcd78e6',
          status: UserStatus.active,
        },
      });

      this.logger.log(`Created user: ${email}`);

      // Increment agent counter
      this.agentCounter++;

      // Create agent profile
      const agent = await this.prisma.agent.create({
        data: {
          userId: user.id,
          agentId: this.agentCounter,
          category: position,
        },
      });

      this.logger.log(`Created agent: ${agent.id} (${position})`);

      return {
        user,
        agent,
        credentials: {
          id: agent.id,
          firstName: row.name,
          lastName: row.surname,
          email,
          username,
          password: plainPassword,
          position,
          phone: row.phone,
          location: row.location,
          agentId: this.agentCounter,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `Error creating agent for ${row.name} ${row.surname}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Generate credentials file
   */
  private async generateCredentialsFile2(
    createdAgents: CreatedAgent[],
  ): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const fileName = `agent_credentials_${timestamp}.txt`;
    const filePath = path.join(process.cwd(), 'uploads', fileName);

    // Ensure uploads directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Generate credentials content
    const header = `
═══════════════════════════════════════════════════════════════════════════════
                          AGENT LOGIN CREDENTIALS
                          Generated: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════════════════════════

⚠️  IMPORTANT: Keep these credentials secure and share with agents via secure channel
⚠️  First Login: Agents should change their password on first login

───────────────────────────────────────────────────────────────────────────────
`;

    let content = header;

    content += `\nTotal Agents Created: ${createdAgents.length}\n\n`;

    // Group by position
    const byPosition = {
      SALES: createdAgents.filter((a) => a.position === 'SALES'),
      INSTALLER: createdAgents.filter((a) => a.position === 'INSTALLER'),
    };

    // SALES AGENTS
    if (byPosition.SALES.length > 0) {
      content += `\n${'═'.repeat(80)}\nSALES AGENTS (${byPosition.SALES.length})\n${'═'.repeat(80)}\n\n`;

      for (const agent of byPosition.SALES) {
        content += `Name: ${agent.firstName} ${agent.lastName}
Username: ${agent.username}
Email: ${agent.email}
Password: ${agent.password}
Phone: ${agent.phone || 'N/A'}
Location: ${agent.location || 'N/A'}
Agent ID: ${agent.agentId}
Position: ${agent.position}
Created: ${agent.createdAt}
────────────────────────────────────────────────────────────────────────────────\n\n`;
      }
    }

    // INSTALLERS
    if (byPosition.INSTALLER.length > 0) {
      content += `\n${'═'.repeat(80)}\nINSTALLERS (${byPosition.INSTALLER.length})\n${'═'.repeat(80)}\n\n`;

      for (const agent of byPosition.INSTALLER) {
        content += `Name: ${agent.firstName} ${agent.lastName}
Username: ${agent.username}
Email: ${agent.email}
Password: ${agent.password}
Phone: ${agent.phone || 'N/A'}
Location: ${agent.location || 'N/A'}
Agent ID: ${agent.agentId}
Position: ${agent.position}
Created: ${agent.createdAt}
────────────────────────────────────────────────────────────────────────────────\n\n`;
      }
    }

    // Footer
    const footer = `
═══════════════════════════════════════════════════════════════════════════════

LOGIN INFORMATION:
- Login URL: http://yourapp.com/login
- Username or Email can be used for login
- Agents should change passwords on first login

SECURITY NOTES:
✓ All passwords are securely hashed in the database
✓ Keep this file in a secure location
✓ Delete after sharing with agents
✓ Consider using encrypted email or secure file sharing

═══════════════════════════════════════════════════════════════════════════════
`;

    content += footer;

    // Write to file
    await fs.writeFile(filePath, content, 'utf8');
    this.logger.log(`Credentials file created: ${filePath}`);

    return filePath;
  }

  /**
   * Generate CSV credentials file (optional, for import to Excel)
   */
  private async generateCredentialsCsv(
    createdAgents: CreatedAgent[],
  ): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const fileName = `agent_credentials_${timestamp}.csv`;
    const filePath = path.join(process.cwd(), 'uploads', fileName);

    // Ensure uploads directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // CSV content
    const headers = [
      'First Name',
      'Last Name',
      'Username',
      'Email',
      'Password',
      'Phone',
      'Location',
      'Position',
      'Agent ID',
      'Created At',
    ];
    const rows = createdAgents.map((agent) => [
      agent.firstName,
      agent.lastName,
      agent.username,
      agent.email,
      agent.password,
      agent.phone || 'N/A',
      agent.location || 'N/A',
      agent.position,
      agent.agentId,
      agent.createdAt,
    ]);

    // Convert to CSV
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    // Write to file
    await fs.writeFile(filePath, csvContent, 'utf8');
    this.logger.log(`CSV credentials file created: ${filePath}`);

    return filePath;
  }

  /**
   * Import agents from CSV
   */
  async importAgentsFromCsv(
    csvContent: string,
  ): Promise<AgentBulkImportResult> {
    const result: AgentBulkImportResult = {
      totalRecords: 0,
      agentsCreated: 0,
      usersCreated: 0,
      errors: [],
      createdAgents: [],
    };

    try {
      // Ensure counter is initialized
      if (this.agentCounter === 0) {
        await this.initializeAgentCounter();
      }

      // Parse CSV
      const parsedRows = this.parseCsv(csvContent);
      result.totalRecords = parsedRows.length;

      this.logger.log(
        `Starting bulk agent import: ${parsedRows.length} records to process`,
      );

      // Process each row
      for (let i = 0; i < parsedRows.length; i++) {
        try {
          const row = parsedRows[i];

          // Create agent user
          const { user, agent, credentials } = await this.createAgentUser(row);

          result.usersCreated++;
          result.agentsCreated++;
          result.createdAgents.push(credentials);

          this.logger.log(
            `Created agent ${i + 1}/${parsedRows.length}: ${row.name} ${row.surname}`,
          );
        } catch (error) {
          this.logger.error(`Error processing row ${i + 1}: ${error.message}`);
          result.errors.push({
            row: i + 1,
            error: error.message,
          });
        }
      }

      // Generate credentials files
      if (result.createdAgents.length > 0) {
        const credentialsFile = await this.generateCredentialsFile2(
          result.createdAgents,
        );
        await this.generateCredentialsCsv(result.createdAgents);

        result.credentialsFile = credentialsFile;

        this.logger.log(
          `Bulk import completed: ${result.agentsCreated} agents created, ${result.errors.length} errors`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`CSV parsing error: ${error.message}`);
      throw new BadRequestException(`Failed to parse CSV: ${error.message}`);
    }
  }

  /**
   * Import agents from file buffer
   */
  async importAgentsFromFile(
    fileBuffer: Buffer,
  ): Promise<AgentBulkImportResult> {
    const csvContent = fileBuffer.toString('utf-8');
    return this.importAgentsFromCsv(csvContent);
  }

  async importAgentsFromJson(
    agents: Array<{
      name: string;
      surname: string;
      position: string;
      phone?: string;
      location?: string;
    }>,
  ): Promise<AgentBulkImportResult> {
    const result: AgentBulkImportResult = {
      totalRecords: agents.length,
      agentsCreated: 0,
      usersCreated: 0,
      errors: [],
      createdAgents: [],
    };

    try {
      if (this.agentCounter === 0) {
        await this.initializeAgentCounter();
      }

      this.logger.log(`Starting JSON import: ${agents.length} agents`);

      for (let i = 0; i < agents.length; i++) {
        try {
          const agent = agents[i];

          if (!agent.name || !agent.surname || !agent.position) {
            throw new Error('Missing required fields: name, surname, position');
          }

          const row: AgentImportRow = {
            name: agent.name,
            surname: agent.surname,
            position: agent.position,
            phone: agent.phone,
            location: agent.location,
          };

          const {
            user,
            agent: createdAgent,
            credentials,
          } = await this.createAgentUser(row);

          result.usersCreated++;
          result.agentsCreated++;
          result.createdAgents.push(credentials);

          this.logger.log(
            `Created agent ${i + 1}/${agents.length}: ${agent.name} ${agent.surname}`,
          );
        } catch (error) {
          this.logger.error(
            `Error processing agent ${i + 1}: ${error.message}`,
          );
          result.errors.push({
            row: i + 1,
            error: error.message,
          });
        }
      }

      if (result.createdAgents.length > 0) {
        const credentialsFile = await this.generateCredentialsFile2(
          result.createdAgents,
        );
        await this.generateCredentialsCsv(result.createdAgents);
        result.credentialsFile = credentialsFile;

        this.logger.log(
          `JSON import completed: ${result.agentsCreated} agents created, ${result.errors.length} errors`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`JSON import error: ${error.message}`);
      throw new BadRequestException(
        `Failed to import from JSON: ${error.message}`,
      );

    }
  }

  private generateAgentNumber(): number {
    return Math.floor(10000000 + Math.random() * 90000000);
  }

  // Helper function to validate MongoDB ObjectId
  private isValidObjectId(id: string): boolean {
    return ObjectId.isValid(id);
  }
}
