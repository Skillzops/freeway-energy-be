import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { MESSAGES } from '../constants';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from '../users/entity/user.entity';
import { ListCustomersQueryDto } from './dto/list-customers.dto';
import { getLastNDaysDate } from '../utils/helpers.util';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  ApproveCustomerDto,
  BulkApproveCustomersDto,
} from './dto/customer-approval.dto';

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

    await this.prisma.customer.create({
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
    } = query;

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
              assignedAgents: {
                some: { agentId },
              },
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
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
      ],
    };

    return filterConditions;
  }

  async getCustomers(query: ListCustomersQueryDto, agent?: string) {
    const { page = 1, limit = 100, sortField, sortOrder } = query;

    const filterConditions = await this.customerFilter(query);

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'desc',
    };

    let creatorId;

    if (agent) {
      const agentUserId = await this.prisma.agent.findUnique({
        where: { id: agent },
        select: { userId: true },
      });
      if (!agentUserId) {
        throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
      }
      creatorId = agentUserId.userId;
    }

    const result = await this.prisma.customer.findMany({
      skip,
      take,
      where: {
        ...filterConditions,
        // assignedAgents: agent ? { some: { agentId: agent } } : undefined,
        ...(agent
          ? {
              OR: [
                { assignedAgents: { some: { agentId: agent } } },
                ...(creatorId ? [{ creatorId }] : []),
              ],
            }
          : {}),
      },
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
        // assignedAgents: true

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
      },
    });

    const customers = plainToInstance(UserEntity, result);

    const totalCount = await this.prisma.customer.count({
      where: {
        ...filterConditions,
        ...(creatorId ? [{ creatorId }] : []),
        assignedAgents: agent ? { some: { agentId: agent } } : undefined,
      },
    });

    return {
      customers,
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async getCustomer(id: string, agent?: string) {
    let creatorId;

    if (agent) {
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
        assignedAgents: agent ? { some: { agentId: agent } } : undefined,
        ...(creatorId ? [{ creatorId }] : []),
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
      },
    });

    if (!customer) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    return customer;
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
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.isApproved) {
      throw new BadRequestException('Customer is already approved');
    }

    if (!approveDto.approve && !approveDto.rejectionReason) {
      throw new BadRequestException(
        'Rejection reason is required when rejecting a customer',
      );
    }

    const updateData: any = {
      status: approveDto.approve ? UserStatus.active : UserStatus.inactive,
      updatedAt: new Date(),
    };

    if (approveDto.approve) {
      updateData.isApproved = true;
      updateData.approvedAt = new Date();
      updateData.approvedBy = approverUserId;
    } else {
      updateData.rejectedAt = new Date();
      updateData.rejectedBy = approverUserId;
      updateData.rejectionReason = approveDto.rejectionReason;
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      include: {
        approver: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        rejecter: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    return {
      message: approveDto.approve
        ? 'Customer approved successfully'
        : 'Customer rejected successfully',
      customer: updatedCustomer,
    };
  }

  async bulkApproveCustomers(
    bulkApproveDto: BulkApproveCustomersDto,
    approverUserId: string,
  ) {
    if (!bulkApproveDto.approve && !bulkApproveDto.rejectionReason) {
      throw new BadRequestException(
        'Rejection reason is required for bulk rejection',
      );
    }

    const customers = await this.prisma.customer.findMany({
      where: {
        id: { in: bulkApproveDto.customerIds },
        isApproved: false,
      },
    });

    if (customers.length === 0) {
      throw new BadRequestException(
        'No pending customers found with the provided IDs',
      );
    }

    const updateData: any = {
      status: bulkApproveDto.approve ? UserStatus.active : UserStatus.inactive,
      updatedAt: new Date(),
    };

    if (bulkApproveDto.approve) {
      updateData.isApproved = true;
      updateData.approvedAt = new Date();
      updateData.approvedBy = approverUserId;
    } else {
      updateData.rejectedAt = new Date();
      updateData.rejectedBy = approverUserId;
      updateData.rejectionReason = bulkApproveDto.rejectionReason;
    }

    await this.prisma.customer.updateMany({
      where: {
        id: { in: customers.map((c) => c.id) },
      },
      data: updateData,
    });

    return {
      message: bulkApproveDto.approve
        ? `${customers.length} customers approved successfully`
        : `${customers.length} customers rejected successfully`,
      affectedCount: customers.length,
    };
  }
}
