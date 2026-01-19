import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { MESSAGES } from '../constants';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalStatus, Prisma, UserStatus } from '@prisma/client';
import { ListCustomersQueryDto } from './dto/list-customers.dto';
import { getLastNDaysDate } from '../utils/helpers.util';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  ApproveCustomerDto,
  BulkApproveCustomersDto,
  ListRejectedCustomersDto,
  ResubmitCustomerDto,
} from './dto/customer-approval.dto';
import { ObjectId } from 'mongodb';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async uploadCustomerImage(file: Express.Multer.File) {
    return await this.cloudinary.uploadFile(file).catch((e) => {
      throw e;
    });
  }

  async createCustomer(
    requestUserId: string,
    createCustomerDto: CreateCustomerDto,
    passportPhoto?: Express.Multer.File,
    idImage?: Express.Multer.File,
    contractFormImage?: Express.Multer.File,
  ) {
    const {
      longitude,
      latitude,
      email,
      firstname,
      lastname,
      phone,
      alternatePhone,
      gender,
      addressType,
      installationAddress,
      lga,
      state,
      location,
      idType,
      idNumber,
      type,
      // ...rest
    } = createCustomerDto;

    const creator = await this.prisma.user.findUnique({
      where: { id: requestUserId },
      include: { agentDetails: true },
    });

    const isAgentUser = creator?.agentDetails;

    if (email) {
      const existingCustomer = await this.prisma.customer.findFirst({
        where: { email },
      });

      if (existingCustomer) {
        throw new BadRequestException(MESSAGES.EMAIL_EXISTS);
      }
    }

    // Upload images if provided
    let passportPhotoUrl: string | undefined;
    let idImageUrl: string | undefined;
    let contractFormImageUrl: string | undefined;

    if (passportPhoto) {
      const uploadResult = await this.uploadCustomerImage(passportPhoto);
      passportPhotoUrl = uploadResult.secure_url;
    }

    if (idImage) {
      const uploadResult = await this.uploadCustomerImage(idImage);
      idImageUrl = uploadResult.secure_url;
    }

    if (contractFormImage) {
      const uploadResult = await this.uploadCustomerImage(contractFormImage);
      contractFormImageUrl = uploadResult.secure_url;
    }

    const customer = await this.prisma.customer.create({
      data: {
        firstname,
        lastname,
        phone,
        email,
        addressType,
        location,
        creatorId: requestUserId,
        status: isAgentUser ? UserStatus.inactive : UserStatus.active,
        isApproved: isAgentUser ? false : true,
        ...(alternatePhone && { alternatePhone }),
        ...(gender && { gender }),
        ...(installationAddress && { installationAddress }),
        ...(lga && { lga }),
        ...(state && { state }),
        ...(longitude && { longitude }),
        ...(latitude && { latitude }),
        ...(idType && { idType }),
        ...(idNumber && { idNumber }),
        ...(type && { type }),
        ...(passportPhotoUrl && { passportPhotoUrl }),
        ...(idImageUrl && { idImageUrl }),
        ...(contractFormImageUrl && { contractFormImageUrl }),
        // ...rest,
      },
    });

    if (isAgentUser) {
      await this.prisma.agentCustomer.create({
        data: {
          agentId: creator.agentDetails.id,
          customerId: customer.id,
          assignedBy: requestUserId,
        },
      });
    }

    return {
      message: !isAgentUser
        ? MESSAGES.CREATED
        : 'Customer created successfully. Pending admin approval.',
    };
  }

  async customerFilter(
    query: ListCustomersQueryDto,
  ): Promise<Prisma.CustomerWhereInput> {
    const {
      search,
      firstname,
      lastname,
      email,
      phone,
      alternatePhone,
      gender,
      location,
      agentId,
      installationAddress,
      lga,
      state,
      status,
      type,
      idType,
      createdAt,
      updatedAt,
      isNew,
      isRejected,
      isApproved,
      isPending,
      isResubmitted,
    } = query;

    let creatorId;

    if (agentId) {
      const agentUserId = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: { userId: true },
      });
      if (!agentUserId) {
        throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
      }
      creatorId = agentUserId.userId;
    }

    const filterConditions: Prisma.CustomerWhereInput = {
      AND: [
        search
          ? {
              OR: [
                { firstname: { contains: search, mode: 'insensitive' } },
                { lastname: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { alternatePhone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        firstname
          ? { firstname: { contains: firstname, mode: 'insensitive' } }
          : {},
        agentId
          ? {
              OR: [
                { assignedAgents: { some: { agentId } } },
                ...(creatorId ? [{ creatorId }] : []),
              ],
            }
          : {},
        lastname
          ? { lastname: { contains: lastname, mode: 'insensitive' } }
          : {},
        email ? { email: { contains: email, mode: 'insensitive' } } : {},
        phone ? { phone: { contains: phone, mode: 'insensitive' } } : {},
        alternatePhone
          ? {
              alternatePhone: { contains: alternatePhone, mode: 'insensitive' },
            }
          : {},
        gender ? { gender: { contains: gender, mode: 'insensitive' } } : {},
        location
          ? { location: { contains: location, mode: 'insensitive' } }
          : {},
        installationAddress
          ? {
              installationAddress: {
                contains: installationAddress,
                mode: 'insensitive',
              },
            }
          : {},
        lga ? { lga: { contains: lga, mode: 'insensitive' } } : {},
        state ? { state: { contains: state, mode: 'insensitive' } } : {},
        status ? { status } : {},
        type ? { type } : {},
        idType ? { idType } : {},
        isNew
          ? {
              createdAt: {
                gte: getLastNDaysDate(7),
              },
            }
          : {},
        isRejected
          ? {
              rejectedAt: { not: null },
              isApproved: false,
            }
          : {},
        isApproved
          ? {
              isApproved: false,
            }
          : {},
        isPending
          ? {
              isApproved: false,
              rejectedAt: null,
            }
          : {},
        isResubmitted
          ? {
              isApproved: false,
              approvalStatus: ApprovalStatus.RESUBMITTED,
            }
          : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
      ],
    };
    return filterConditions;
  }

  async getCustomers(query: ListCustomersQueryDto) {
    const { page = 1, limit = 100, sortField = "createdAt", sortOrder } = query;
    const filterConditions = await this.customerFilter(query);
    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'desc',
    };

    const customers = await this.prisma.customer.findMany({
      skip,
      take: limitNumber,
      where: filterConditions,
      orderBy,
      include: {
        creatorDetails: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        approver: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          }
        },
        rejecter: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          }
        }
      },
    });

    const customerIds = customers.map((c) => c.id);

    const agents = await this.prisma.agentCustomer.findMany({
      where: {
        customerId: { in: customerIds },
        agentId: { not: null },
      },
      include: {
        agent: {
          include: {
            user: {
              select: {
                firstname: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const devices = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          customerId: { in: customerIds },
        },
      },
      select: {
        sale: {
          select: {
            customerId: true,
          },
        },
        devices: {
          select: {
            id: true,
            serialNumber: true,
            key: true,
            // productId: true,
            tokens: {
              select: {
                id: true,
                duration: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const agentMap = new Map();
    agents.forEach((ag) => {
      if (!agentMap.has(ag.customerId)) {
        agentMap.set(ag.customerId, []);
      }
      agentMap.get(ag.customerId).push({ agent: ag.agent });
    });

    const customerDevicesMap = new Map();
    const deviceIdSet = new Set();
    devices.forEach((item) => {
      const customerId = item.sale.customerId;
      if (!customerDevicesMap.has(customerId)) {
        customerDevicesMap.set(customerId, []);
      }
      item.devices.forEach((device) => {
        if (!deviceIdSet.has(device.id)) {
          customerDevicesMap.get(customerId).push(device);
          deviceIdSet.add(device.id); // Avoid duplicates
        }
      });
    });

    const mappedCustomers = customers.map((customer) => ({
      // All original customer fields
      ...customer,
      // Override with mapped agents from separate query
      assignedAgents: agentMap.get(customer.id) || [],
      // Append devices array
      devices: customerDevicesMap.get(customer.id) || [],
    }));

    const totalCount = await this.prisma.customer.count({
      where: filterConditions,
    });

    return {
      customers: mappedCustomers,
      total: totalCount,
      page: pageNumber,
      limit: limitNumber,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async getCustomer(id: string, agent?: string) {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid customer  ID: ${id}`);
    }

    let creatorId;

    if (agent) {
      if (!ObjectId.isValid(agent)) {
        throw new BadRequestException(`Invalid agent  ID: ${agent}`);
      }
      const agentUserId = await this.prisma.agent.findUnique({
        where: { id: agent },
        select: { userId: true },
      });
      if (!agentUserId) {
        throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
      }
      creatorId = agentUserId.userId;
    }

    const customer = await this.prisma.customer.findUnique({
      where: {
        id,
        ...(agent && {
          OR: [
            { assignedAgents: { some: { agentId: agent } } },
            ...(creatorId ? [{ creatorId }] : []),
          ],
        }),
        // assignedAgents: agent ? { some: { agentId: agent } } : undefined,
        // ...(creatorId? { creatorId } : {}),
      },
      include: {
        creatorDetails: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        assignedAgents: {
          where: {
            agentId: { not: null },
          },
          select: {
            agent: {
              include: {
                user: {
                  select: { firstname: true, lastname: true, email: true },
                },
              },
            },
          },
        },
        products: {
          include: {
            product: true,
          },
        },
        approver: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        rejecter: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    const devices = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          customerId: customer.id
        },
      },
      select: {
        sale: {
          select: {
            customerId: true,
          },
        },
        devices: {
          select: {
            id: true,
            serialNumber: true,
            key: true,
            // productId: true,
            tokens: {
              select: {
                id: true,
                duration: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const customerDevicesMap = new Map();
    const deviceIdSet = new Set();
    devices.forEach((item) => {
      const customerId = item.sale.customerId;
      if (!customerDevicesMap.has(customerId)) {
        customerDevicesMap.set(customerId, []);
      }
      item.devices.forEach((device) => {
        if (!deviceIdSet.has(device.id)) {
          customerDevicesMap.get(customerId).push(device);
          deviceIdSet.add(device.id); // Avoid duplicates
        }
      });
    });

    return {...customer, devices: customerDevicesMap.get(customer.id) || [],};
  }

  async updateCustomer(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
    passportPhoto?: Express.Multer.File,
    idImage?: Express.Multer.File,
    contractFormImage?: Express.Multer.File,
  ) {
    const {
      longitude,
      latitude,
      email,
      firstname,
      lastname,
      phone,
      alternatePhone,
      gender,
      addressType,
      installationAddress,
      lga,
      state,
      location,
      idType,
      idNumber,
      type,
      // ...rest
    } = updateCustomerDto;

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!existingCustomer) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    if (email && email !== existingCustomer.email) {
      const customerWithEmail = await this.prisma.customer.findFirst({
        where: {
          email,
          id: { not: id },
        },
      });

      if (customerWithEmail) {
        throw new BadRequestException(MESSAGES.EMAIL_EXISTS);
      }
    }

    // Handle image uploads
    let passportPhotoUrl: string | null | undefined = undefined;
    let idImageUrl: string | null | undefined = undefined;
    let contractFormImageUrl: string | undefined;

    if (passportPhoto) {
      const uploadResult = await this.uploadCustomerImage(passportPhoto);
      passportPhotoUrl = uploadResult.secure_url;
    }

    if (idImage) {
      const uploadResult = await this.uploadCustomerImage(idImage);
      idImageUrl = uploadResult.secure_url;
    }

    if (contractFormImage) {
      const uploadResult = await this.uploadCustomerImage(contractFormImage);
      contractFormImageUrl = uploadResult.secure_url;
    }

    // Prepare update data
    const updateData: any = {
      ...(firstname !== undefined && { firstname }),
      ...(lastname !== undefined && { lastname }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(addressType !== undefined && { addressType }),
      ...(location !== undefined && { location }),
      ...(alternatePhone !== undefined && { alternatePhone }),
      ...(gender !== undefined && { gender }),
      ...(installationAddress !== undefined && { installationAddress }),
      ...(lga !== undefined && { lga }),
      ...(state !== undefined && { state }),
      ...(longitude !== undefined && { longitude }),
      ...(latitude !== undefined && { latitude }),
      ...(idType !== undefined && { idType }),
      ...(idNumber !== undefined && { idNumber }),
      ...(type !== undefined && { type }),
      ...(passportPhotoUrl !== undefined && { passportPhotoUrl }),
      ...(idImageUrl !== undefined && { idImageUrl }),
      ...(contractFormImageUrl !== undefined && { contractFormImageUrl }),
      // ...rest,
    };

    const updatedCustomer = await this.prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        creatorDetails: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    return { message: MESSAGES.UPDATED, customer: updatedCustomer };
  }

  async deleteCustomer(id: string) {
    const user = await this.prisma.customer.findUnique({
      where: {
        id,
      },
    });

    if (!user) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    await this.prisma.customer.delete({
      where: { id },
    });

    return {
      message: MESSAGES.DELETED,
    };
  }

  async getCustomerStats() {
    const [
      totalCustomerCount,
      activeCustomerCount,
      barredCustomerCount,
      newCustomerCount,
      leadCustomerCount,
      purchaseCustomerCount,
      pendingApprovalCount,
      rejectedCount,
      approvedCount,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.customer.count({ where: { status: UserStatus.active } }),
      this.prisma.customer.count({ where: { status: UserStatus.barred } }),
      this.prisma.customer.count({
        where: { createdAt: { gte: getLastNDaysDate(7) } },
      }),
      this.prisma.customer.count({ where: { type: 'lead' } }),
      this.prisma.customer.count({ where: { type: 'purchase' } }),
      this.prisma.customer.count({
        where: { isApproved: false, rejectedAt: null },
      }),
      this.prisma.customer.count({
        where: { rejectedAt: { not: null }, isApproved: false },
      }),
      this.prisma.customer.count({ where: { isApproved: true } }),
    ]);

    return {
      totalCustomerCount,
      activeCustomerCount,
      barredCustomerCount,
      newCustomerCount,
      leadCustomerCount,
      purchaseCustomerCount,
      pendingApprovalCount,
      rejectedCount,
      approvedCount,
    };
  }

  async getCustomerTabs(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: customerId,
      },
    });

    if (!customer) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    const tabs = [
      {
        name: 'Customer Details',
        url: `/customers/single/${customerId}`,
      },
      {
        name: 'Registration History',
        url: `/customers/${customerId}/registration-history`,
      },
      {
        name: 'Products',
        url: `/customers/${customerId}/products`,
      },
      {
        name: 'Contracts',
        url: `/customers/${customerId}/contracts`,
      },
      {
        name: 'Transactions',
        url: `/customers/${customerId}/transactions`,
      },
      {
        name: 'Tickets',
        url: `/customers/${customerId}/tickets`,
      },
    ];

    return tabs;
  }

  async approveCustomer(
    customerId: string,
    approveDto: ApproveCustomerDto,
    approverUserId: string,
  ) {
    let customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (approveDto.approve) {
      customer = await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          isApproved: true,
          approvalStatus: ApprovalStatus.APPROVED,
          status: UserStatus.active,
          approvedAt: new Date(),
          approvedBy: approverUserId,
          requiresReview: false,
        },
      });
    } else {
      if (!approveDto.rejectionReason) {
        throw new BadRequestException(
          'Rejection reason is required when rejecting a customer',
        );
      }

      this.prisma.rejectionHistory.create({
        data: {
          customerId,
          rejectedBy: approverUserId,
          rejectionReason: approveDto.rejectionReason,
          rejectedAt: new Date(),
        },
      });

      customer = await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          isApproved: false,
          approvalStatus: ApprovalStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedBy: approverUserId,
          rejectionReason: approveDto.rejectionReason,
          requiresReview: true,
        },
      });
    }

    return {
      message: approveDto.approve
        ? 'Customer approved successfully'
        : 'Customer rejected successfully',
      customer,
    };
  }

  async bulkApproveCustomers(
    bulkApproveDto: BulkApproveCustomersDto,
    approverUserId: string,
  ) {
    const { customerIds, approve, rejectionReason } = bulkApproveDto;

    if (!approve && !rejectionReason) {
      throw new BadRequestException(
        'Rejection reason is required when rejecting customers',
      );
    }

    const updateData = approve
      ? {
          isApproved: true,
          status: UserStatus.active,
          approvalStatus: ApprovalStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: approverUserId,
          requiresReview: false,
        }
      : {
          isApproved: false,
          approvalStatus: ApprovalStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedBy: approverUserId,
          rejectionReason,
          requiresReview: true,
        };

    const result = await this.prisma.customer.updateMany({
      where: { id: { in: customerIds } },
      data: updateData,
    });

    if (!approve) {
      await Promise.all(
        customerIds.map((customerId) =>
          this.prisma.rejectionHistory.create({
            data: {
              customerId,
              rejectedBy: approverUserId,
              rejectionReason: rejectionReason || 'Rejected in bulk operation',
              rejectedAt: new Date(),
            },
          }),
        ),
      );
    }

    return result;
  }

  async getCustomerRejectionDetails(customerId: string, agentId?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        previousRejections: {
          orderBy: { rejectedAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (agentId && customer.creatorId !== agentId) {
      throw new ForbiddenException(
        'You can only view rejection details for your own customers',
      );
    }

    if (customer.approvalStatus !== ApprovalStatus.REJECTED) {
      throw new BadRequestException('This customer has not been rejected');
    }

    return {
      id: customer.id,
      firstname: customer.firstname,
      lastname: customer.lastname,
      email: customer.email,
      approvalStatus: customer.approvalStatus,
      rejectionReason: customer.rejectionReason,
      rejectedAt: customer.rejectedAt,
      resubmissionCount: customer.resubmissionCount,
      rejectionHistory: customer.previousRejections.map((rh) => ({
        rejectionReason: rh.rejectionReason,
        rejectedAt: rh.rejectedAt,
        resubmittedAt: rh.resubmittedAt,
      })),
    };
  }

  async listRejectedCustomers(
    agentId: string,
    query: ListRejectedCustomersDto,
  ) {
    const {
      search,
      sortField = 'rejectedAt',
      sortOrder = 'desc',
      page = '1',
      limit = '10',
    } = query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      creatorId: agentId,
      approvalStatus: ApprovalStatus.REJECTED,
      requiresReview: true,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { firstname: { contains: search, mode: 'insensitive' } },
        { lastname: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const total = await this.prisma.customer.count({ where });

    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        email: true,
        phone: true,
        type: true,
        status: true,
        rejectionReason: true,
        rejectedAt: true,
        resubmissionCount: true,
      },
      orderBy: {
        [sortField]: sortOrder,
      },
      skip,
      take: limitNum,
    });

    return {
      data: customers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  async resubmitCustomer(
    customerId: string,
    creatorId: string,
    resubmitDto: ResubmitCustomerDto,
    passportPhoto?: Express.Multer.File,
    idImage?: Express.Multer.File,
    contractFormImage?: Express.Multer.File,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.creatorId !== creatorId) {
      throw new ForbiddenException(
        'You can only resubmit customers you created',
      );
    }

    if (customer.approvalStatus !== ApprovalStatus.REJECTED) {
      throw new BadRequestException(
        'Only rejected customers can be resubmitted',
      );
    }

    let passportPhotoUrl = customer.passportPhotoUrl;
    let idImageUrl = customer.idImageUrl;
    let contractFormImageUrl = customer.contractFormImageUrl;

    if (passportPhoto) {
      const uploadResult = await this.uploadCustomerImage(passportPhoto);
      passportPhotoUrl = uploadResult.secure_url;
    }

    if (idImage) {
      const uploadResult = await this.uploadCustomerImage(idImage);
      idImageUrl = uploadResult.secure_url;
    }

    if (contractFormImage) {
      const uploadResult = await this.uploadCustomerImage(contractFormImage);
      contractFormImageUrl = uploadResult.secure_url;
    }

    const latestRejection = await this.prisma.rejectionHistory.findFirst({
      where: { customerId },
      orderBy: { rejectedAt: 'desc' },
    });

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(resubmitDto.firstname && { firstname: resubmitDto.firstname }),
        ...(resubmitDto.lastname && { lastname: resubmitDto.lastname }),
        ...(resubmitDto.email && { email: resubmitDto.email }),
        ...(resubmitDto.phone && { phone: resubmitDto.phone }),
        ...(resubmitDto.alternatePhone && {
          alternatePhone: resubmitDto.alternatePhone,
        }),
        ...(resubmitDto.gender && { gender: resubmitDto.gender }),
        ...(resubmitDto.addressType && {
          addressType: resubmitDto.addressType,
        }),
        ...(resubmitDto.installationAddress && {
          installationAddress: resubmitDto.installationAddress,
        }),
        ...(resubmitDto.lga && { lga: resubmitDto.lga }),
        ...(resubmitDto.state && { state: resubmitDto.state }),
        ...(resubmitDto.location && { location: resubmitDto.location }),
        ...(resubmitDto.longitude && { longitude: resubmitDto.longitude }),
        ...(resubmitDto.latitude && { latitude: resubmitDto.latitude }),
        ...(resubmitDto.idType && { idType: resubmitDto.idType }),
        ...(resubmitDto.idNumber && { idNumber: resubmitDto.idNumber }),
        ...(resubmitDto.type && { type: resubmitDto.type }),
        ...(passportPhotoUrl && { passportPhotoUrl }),
        ...(idImageUrl && { idImageUrl }),
        ...(contractFormImageUrl && { contractFormImageUrl }),
        approvalStatus: ApprovalStatus.RESUBMITTED,
        lastResubmittedAt: new Date(),
        resubmissionCount: customer.resubmissionCount + 1,
        requiresReview: false,
      },
    });

    if (latestRejection) {
      await this.prisma.rejectionHistory.update({
        where: { id: latestRejection.id },
        data: {
          resubmittedAt: new Date(),
        },
      });
    }

    return {
      message: 'Customer resubmitted successfully',
      customer: updatedCustomer,
    };
  }

  async cleanCustomers(
  ) {
    const startOf1925 = new Date('1925-01-01T00:00:00.000Z');
    const startOf1926 = new Date('1926-01-01T00:00:00.000Z');
  
    const customers = await this.prisma.customer.findMany({
      where: {
        createdAt: {
          gte: startOf1925,
          lt: startOf1926,
        },
      },
      include: {
        sales: true,
      },
    });

    console.log(customers.length)

    for (const customer of customers) {
      const sale = customer.sales[0]

      await this.prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          createdAt: sale.createdAt,
          updatedAt: sale.updatedAt
        },
      });
  
    }

    console.log("done")
  
    return customers
  }
}
