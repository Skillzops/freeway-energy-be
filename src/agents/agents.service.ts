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
import {
  calculateDistance,
  cleanPhoneNumber,
  hashPassword,
} from '../utils/helpers.util';
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
  email?: string;
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

  private readonly AGENT_COLUMN_MAPPINGS = new Map([
    // First Name
    ['first name', 'firstName'],
    ['firstname', 'firstName'],
    ['first_name', 'firstName'],
    ['name', 'firstName'],

    // Surname
    ['surname', 'surname'],
    ['last name', 'surname'],
    ['lastname', 'surname'],
    ['last_name', 'surname'],

    // Position
    ['position', 'position'],
    ['role', 'position'],
    ['job title', 'position'],

    // Phone
    ['whatsapp number', 'phone'],
    ['whatsapp_number', 'phone'],
    ['phone number', 'phone'],
    ['phone', 'phone'],
    ['mobile', 'phone'],

    // Email
    ['email address', 'email'],
    ['email_address', 'email'],
    ['email', 'email'],

    // Location
    ['state', 'state'],
    ['lga', 'lga'],
    ['village', 'village'],
    ['location', 'location'],

    // Gender (optional)
    ['gender', 'gender'],
    ['sex', 'gender'],

    // Ignore these
    ['timestamp', null],
    ['password', null],
  ]);

  async create(createAgentDto: CreateAgentDto, userId: string) {
    const {
      email: emailFromDto,
      location,
      phone,
      category,
      ...otherData
    } = createAgentDto;

    let email = emailFromDto;

    if (!email) {
      email = await this.generateUniqueEmail(
        createAgentDto.firstname,
        createAgentDto.lastname,
      );
    }

    const agentId = this.generateAgentNumber();

    const existingEmail = await this.prisma.user.findFirst({
      where: { email },
    });

    if (existingEmail) {
      throw new ConflictException('A user with this email already exists');
    }

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
      where: { role: 'AssignedAgent' },
      include: { permissions: true },
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
          include: { permissions: true },
        });
      } catch (error) {
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

    /**
     * FIRE AND FORGET SMS
     */
    if (newUser.phone) {
      this.termiiService
        .sendSms({
          to: newUser.phone,
          message: await this.termiiService.formatAgentCredentialsMessage(
            newUser.firstname,
            email,
            password,
            category,
          ),
          type: 'plain',
          channel: 'generic',
        })
        .catch((error) => {
          this.logger.error('SMS sending failed', error);
        });
    }

    /**
     * RETURN CREDENTIALS IN RESPONSE
     */
    return {
      agentId,
      email,
      password,
      category,
      fistname: newUser.firstname,
      lastname: newUser.lastname,
    };
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
      sortField = 'createdAt',
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
      where: { ...whereConditions, NOT: { user: null } },
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
        include: {
          installer: {
            select: {
              user: {
                select: {
                  firstname: true,
                },
              },
            },
          },
        },
      },
    );

    if (alreadyAssigned.length > 0) {
      const assignedIds = alreadyAssigned
        .map((p) => p.installer.user.firstname)
        .join(', ');
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
      where: { id: { in: productIds }, hideProduct: false },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('Some products not found');
    }

    const alreadyAssigned = await this.prisma.agentProduct.findMany({
      where: {
        agentId,
        productId: { in: productIds },
      },
      include: { product: true },
    });

    if (alreadyAssigned.length > 0) {
      const assignedIds = alreadyAssigned.map((p) => p.product.name).join(', ');
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

  async reassignCustomersToNewAgent(
    fromAgentId: string,
    toAgentId: string,
    customerIds: string[],
    reason?: string,
    reassignedBy?: string,
  ) {
    if (fromAgentId === toAgentId) {
      throw new BadRequestException(
        'Source and destination agents must be different',
      );
    }

    if (!customerIds || customerIds.length === 0) {
      throw new BadRequestException(
        'At least one customer ID must be provided',
      );
    }

    const uniqueCustomerIds = [...new Set(customerIds)];

    // Validate both agents exist
    const [fromAgent, toAgent] = await Promise.all([
      this.findOne(fromAgentId),
      this.findOne(toAgentId),
    ]);

    if (!fromAgent || !toAgent) {
      throw new NotFoundException('One or both agents not found');
    }

    // Fetch customer details to validate
    const customers = await this.prisma.customer.findMany({
      where: {
        id: { in: uniqueCustomerIds },
      },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
      },
    });

    if (customers.length !== uniqueCustomerIds.length) {
      const foundIds = customers.map((c) => c.id);
      const notFound = uniqueCustomerIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(
        `Customers not found: ${notFound.join(', ')}`,
      );
    }

    const currentAssignments = await this.prisma.agentCustomer.findMany({
      where: {
        agentId: fromAgentId,
        customerId: { in: uniqueCustomerIds },
      },
      select: {
        customerId: true,
        assignedAt: true,
        assignedBy: true,
      },
    });

    if (currentAssignments.length === 0) {
      throw new BadRequestException(
        `Agent ${fromAgent.agentId || fromAgentId} is not assigned to any of these customers`,
      );
    }

    // Find customers already assigned to destination agent
    const alreadyAssigned = await this.prisma.agentCustomer.findMany({
      where: {
        agentId: toAgentId,
        customerId: { in: uniqueCustomerIds },
      },
      select: {
        customerId: true,
      },
    });

    const alreadyAssignedIds = alreadyAssigned.map((a) => a.customerId);
    const customersToReassign = uniqueCustomerIds.filter(
      (id) => !alreadyAssignedIds.includes(id),
    );
    const conflictingCustomers = uniqueCustomerIds.filter((id) =>
      alreadyAssignedIds.includes(id),
    );

    let reassignmentResult: any;

    try {
      reassignmentResult = await this.prisma.$transaction(
        async (tx) => {
          // Step 1: Create audit log for reassignment
          const reassignmentLog = await tx.agentCustomerReassignmentLog.create({
            data: {
              fromAgentId,
              toAgentId,
              customerCount: customersToReassign.length,
              reason: reason || 'Manual reassignment',
              reassignedBy: reassignedBy,
              details: {
                customersReassigned: customersToReassign,
                customersAlreadyAssigned: conflictingCustomers,
              } as any,
            },
          });

          // Step 2: Remove from old agent
          await tx.agentCustomer.deleteMany({
            where: {
              agentId: fromAgentId,
              customerId: { in: customersToReassign },
            },
          });

          // Step 3: Assign to new agent
          await tx.agentCustomer.createMany({
            data: customersToReassign.map((customerId) => ({
              agentId: toAgentId,
              customerId,
              assignedBy: reassignedBy,
              reassignmentReason: reason,
              reassignedFrom: fromAgentId,
              reassignedAt: new Date(),
            })),
          });

          return reassignmentLog;
        },
        {
          timeout: 15000,
          maxWait: 30000,
        },
      );
    } catch (error) {
      this.logger.error(
        `Transaction failed for reassignment from ${fromAgentId} to ${toAgentId}:`,
        error.message,
      );

      if (error.code === 'P2028') {
        throw new BadRequestException(
          'Reassignment operation timed out. Please try again.',
        );
      }

      throw new BadRequestException(`Reassignment failed: ${error.message}`);
    }

    return {
      success: true,
      message: `${customersToReassign.length} customer(s) reassigned successfully`,
      data: {
        reassignmentLogId: reassignmentResult.id,
        summary: {
          total: uniqueCustomerIds.length,
          reassigned: customersToReassign.length,
          alreadyAssigned: conflictingCustomers.length,
          fromAgent: {
            id: fromAgent.id,
            agentId: fromAgent.agentId,
            name: fromAgent.user?.firstname + ' ' + fromAgent.user?.lastname,
          },
          toAgent: {
            id: toAgent.id,
            agentId: toAgent.agentId,
            name: toAgent.user?.firstname + ' ' + toAgent.user?.lastname,
          },
        },
        reassignedCustomers: customers
          .filter((c) => customersToReassign.includes(c.id))
          .map((c) => ({
            id: c.id,
            name: `${c.firstname} ${c.lastname}`,
            phone: c.phone,
          })),
        ...(conflictingCustomers.length > 0 && {
          warnings: {
            message: `${conflictingCustomers.length} customer(s) already assigned to destination agent`,
            customerIds: conflictingCustomers,
          },
        }),
      },
    };
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

    const where: Prisma.PaymentWhereInput = {
      sale: {
        OR: [{ creatorId: agent.userId }, { agentId: agent.id }],
      },
      paymentStatus: PaymentStatus.COMPLETED,
      ...(startDate || endDate
        ? {
            paymentDate: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    };

    const commissionRate = 0.07;

    const [payments, allPaymentAmounts] = await Promise.all([
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
      this.prisma.payment.findMany({
        where: {
          paymentStatus: PaymentStatus.COMPLETED,
          sale: {
            OR: [{ creatorId: agent.userId }, { agentId: agent.id }],
          },
        },
        select: {
          amount: true,
          saleId: true,
        },
      }),
    ]);

    const paginatedSaleIds = payments.map((p) => p.saleId);
    const allSaleIds = allPaymentAmounts.map((p) => p.saleId);

    const [paymentsWithTokens, paymentsForSummary] = await Promise.all([
      this.filterPaymentsByTokens(paginatedSaleIds),
      this.filterPaymentsByTokens(allSaleIds),
    ]);

    const commissionsData = payments
      .filter((p) => paymentsWithTokens.has(p.saleId))
      .map((payment) => ({
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

    const totalPaymentAmount = Array.from(paymentsWithTokens).reduce(
      (sum, saleId) => {
        return (
          sum +
          (allPaymentAmounts.find((p) => p.saleId === saleId)?.amount || 0)
        );
      },
      0,
    );

    const overallPaymentAmount = Array.from(paymentsForSummary).reduce(
      (sum, saleId) => {
        return (
          sum +
          (allPaymentAmounts.find((p) => p.saleId === saleId)?.amount || 0)
        );
      },
      0,
    );

    const totalCommission = (totalPaymentAmount * commissionRate).toFixed(2);
    const overAllCommission = (overallPaymentAmount * commissionRate).toFixed(
      2,
    );

    return {
      data: commissionsData,
      total: paymentsWithTokens.size,
      page,
      limit,
      totalPages:
        limitNumber === 0
          ? 0
          : Math.ceil(paymentsWithTokens.size / limitNumber),
      summary: {
        agentType: agent.category,
        totalCommission,
        overAllCommission,
        totalPayments: paymentsForSummary.size,
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
      select: { id: true, category: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    if (agent.category === AgentCategory.SALES) {
      return await this.getAgentCommissions(agent.id, query);
    } else if (agent.category === AgentCategory.INSTALLER) {
      return await this.getInstallerCommissions(agent.id, query);
    } else {
      throw new BadRequestException('Invalid agent category');
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

    const where: Prisma.InstallerTaskWhereInput = {
      installerAgentId: installerId,
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

    const commissionPerTask = 2000;

    const [completedTasks, allTaskSaleIds] = await Promise.all([
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
              totalPrice: true,
              createdAt: true,
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
      this.prisma.installerTask.findMany({
        where: {
          installerAgentId: installerId,
        },
        select: { saleId: true },
        distinct: ['saleId'],
      }),
    ]);

    const [tasksToReturn, tasksForSummary] = await Promise.all([
      this.filterTasksByTokens(completedTasks.map((t) => t.saleId)),
      this.filterTasksByTokens(allTaskSaleIds.map((t) => t.saleId)),
    ]);

    const commissionsData = completedTasks
      .filter((t) => tasksToReturn.has(t.saleId))
      .map((task) => ({
        id: task.id,
        taskId: task.id,
        commissionAmount: commissionPerTask,
        // completedDate: task.completedDate,
        completedDate: task.sale.createdAt,
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

    const totalCommission = (tasksToReturn.size * commissionPerTask).toFixed(2);
    const overAllCommission = (
      tasksForSummary.size * commissionPerTask
    ).toFixed(2);

    return {
      data: commissionsData,
      total: tasksToReturn.size,
      page,
      limit,
      totalPages:
        limitNumber === 0 ? 0 : Math.ceil(tasksToReturn.size / limitNumber),
      summary: {
        agentType: installer.category,
        totalCommission,
        overAllCommission,
        totalCompletedTasks: tasksForSummary.size,
        commissionPerTask,
        installer: {
          id: installer.id,
          agentId: installer.agentId,
          name: `${installer.user.firstname} ${installer.user.lastname}`,
        },
      },
    };
  }

  /**
   * Filter payments by checking if devices have tokens
   * Only counts commissions for sales where devices have generated tokens
   */
  private async filterPaymentsByTokens(
    saleIds: string[],
  ): Promise<Set<string>> {
    if (saleIds.length === 0) return new Set();

    const saleItems = await this.prisma.saleItem.findMany({
      where: { saleId: { in: saleIds } },
      select: { saleId: true, deviceIDs: true },
    });

    const deviceIds = new Set<string>();
    saleItems.forEach((si) => {
      si.deviceIDs?.forEach((dId) => deviceIds.add(dId));
    });

    if (deviceIds.size === 0) return new Set();

    const devicesWithTokens = await this.prisma.device.findMany({
      where: {
        id: { in: Array.from(deviceIds) },
        tokens: { some: {} },
      },
      select: { id: true },
    });

    const devicesWithTokensSet = new Set(devicesWithTokens.map((d) => d.id));

    const salesWithTokens = new Set<string>();
    saleItems.forEach((si) => {
      if (si.deviceIDs?.some((dId) => devicesWithTokensSet.has(dId))) {
        salesWithTokens.add(si.saleId);
      }
    });

    return salesWithTokens;
  }

  /**
   * Filter installer tasks by device tokens
   */
  private async filterTasksByTokens(saleIds: string[]): Promise<Set<string>> {
    if (saleIds.length === 0) return new Set();

    // Get saleItems ONLY for these specific sales
    const saleItems = await this.prisma.saleItem.findMany({
      where: { saleId: { in: saleIds } },
      select: { saleId: true, deviceIDs: true },
    });

    // Extract unique device IDs
    const deviceIds = new Set<string>();
    saleItems.forEach((si) => {
      si.deviceIDs?.forEach((dId) => deviceIds.add(dId));
    });

    if (deviceIds.size === 0) return new Set();

    // Get devices with tokens
    const devicesWithTokens = await this.prisma.device.findMany({
      where: {
        id: { in: Array.from(deviceIds) },
        tokens: { some: {} },
      },
      select: { id: true },
    });

    const devicesWithTokensSet = new Set(devicesWithTokens.map((d) => d.id));

    // Return sale IDs that have at least one token device
    const salesWithTokens = new Set<string>();
    saleItems.forEach((si) => {
      if (si.deviceIDs?.some((dId) => devicesWithTokensSet.has(dId))) {
        salesWithTokens.add(si.saleId);
      }
    });

    return salesWithTokens;
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
      sortField = 'createdAt',
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
        where: {
          ...finalWhereConditions,
          NOT: {
            // sale: null,
            sale: {
              customer: null,
            },
          },
        },
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

  private detectDelimiter(line: string): string {
    const tabCount = (line.match(/\t/g) || []).length;
    const commaCount = (line.match(/,/g) || []).length;
    const semicolonCount = (line.match(/;/g) || []).length;

    if (tabCount >= commaCount && tabCount >= semicolonCount) return '\t';
    if (commaCount >= semicolonCount) return ',';
    return ';';
  }

  private parseCsv(csvContent: string): AgentImportRow[] {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV must contain headers and at least one data row',
      );
    }

    // Auto-detect delimiter from header line
    const delimiter = this.detectDelimiter(lines[0]);

    // Parse and normalize headers
    const rawHeaders = lines[0].split(delimiter);
    const normalizedHeaders = rawHeaders.map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 _]/g, ''),
    );

    // Map each header to a field name using AGENT_COLUMN_MAPPINGS
    const fieldMap: Record<number, string> = {};
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const header = normalizedHeaders[i];
      if (this.AGENT_COLUMN_MAPPINGS.has(header)) {
        const field = this.AGENT_COLUMN_MAPPINGS.get(header);
        if (field !== null) {
          fieldMap[i] = field;
        }
      }
    }

    // Check required fields are present
    const foundFields = new Set(Object.values(fieldMap));
    const required = ['firstName', 'surname', 'position'];
    const missing = required.filter((f) => !foundFields.has(f));

    if (missing.length > 0) {
      throw new BadRequestException(
        `CSV missing required columns: ${missing.join(', ')}. ` +
          `Headers found: [${normalizedHeaders.join(' | ')}]`,
      );
    }

    const parsedRows: AgentImportRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(delimiter).map((c) => c.trim());

      // Map columns to fields dynamically
      const row: Record<string, string> = {};
      for (const [colIndex, fieldName] of Object.entries(fieldMap)) {
        row[fieldName] = columns[parseInt(colIndex)] || '';
      }

      const firstName = row['firstName'];
      const surname = row['surname'];
      const position = row['position'];

      if (!firstName || !surname || !position) continue;

      // Build location from state + lga + village
      const locationParts = [row['village'], row['lga'], row['state']].filter(
        Boolean,
      );
      const location =
        locationParts.length > 0 ? locationParts.join(', ') : undefined;

      parsedRows.push({
        name: firstName,
        surname: surname,
        position: position,
        phone: row['phone'] || undefined,
        location: location,
        email: row['email'] || undefined,
      });
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException(
        'No valid data rows found. Check that required columns have values.',
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
    // Strip spaces and special chars, lowercase
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const base = `${cleanFirst}.${cleanLast}`;
    const email =
      attempt === 0 ? `${base}@gmail.com` : `${base}${attempt}@gmail.com`;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
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
      // Use sheet email if provided and not taken, otherwise generate
      let email: string;
      if (row.email) {
        const exists = await this.prisma.user.findUnique({
          where: { email: row.email },
        });
        email = exists
          ? await this.generateUniqueEmail(row.name, row.surname)
          : row.email;
      } else {
        email = await this.generateUniqueEmail(row.name, row.surname);
      }

      const username = await this.generateUniqueUsername(row.name, row.surname);
      const plainPassword = generateRandomPassword(10);
      const hashedPassword = await hashPassword(plainPassword);
      const position = this.normalizePosition(row.position);

      const user = await this.prisma.user.create({
        data: {
          firstname: row.name,
          lastname: row.surname,
          username,
          email,
          password: hashedPassword,
          phone: row.phone ? cleanPhoneNumber(row.phone) : null,
          location: row.location || null,
          roleId: '687a8565e7b4874bfbcd78e6', // TOdo: Make this non-static
          status: UserStatus.active,
        },
      });

      this.agentCounter++;

      const agent = await this.prisma.agent.create({
        data: {
          userId: user.id,
          agentId: this.agentCounter,
          category: position,
        },
      });

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
          const { credentials } = await this.createAgentUser(row);

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
            // user,
            // agent: createdAgent,
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
