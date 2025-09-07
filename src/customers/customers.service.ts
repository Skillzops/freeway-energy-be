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

    return { message: MESSAGES.CREATED };
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

    const result = await this.prisma.customer.findMany({
      skip,
      take,
      where: {
        ...filterConditions,
        assignedAgents: agent ? { some: { agentId: agent } } : undefined,
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
    const customer = await this.prisma.customer.findUnique({
      where: {
        id,
        assignedAgents: agent ? { some: { agentId: agent } } : undefined,
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
    const barredCustomerCount = await this.prisma.customer.count({
      where: {
        status: UserStatus.barred,
      },
    });

    const newCustomerCount = await this.prisma.customer.count({
      where: {
        createdAt: {
          gte: getLastNDaysDate(7),
        },
      },
    });

    const activeCustomerCount = await this.prisma.customer.count({
      where: {
        status: UserStatus.active,
      },
    });

    const totalCustomerCount = await this.prisma.customer.count();

    const leadCustomerCount = await this.prisma.customer.count({
      where: {
        type: 'lead',
      },
    });

    const purchaseCustomerCount = await this.prisma.customer.count({
      where: {
        type: 'purchase',
      },
    });

    return {
      barredCustomerCount,
      newCustomerCount,
      activeCustomerCount,
      totalCustomerCount,
      leadCustomerCount,
      purchaseCustomerCount,
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
}
