import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCustomerInteractionDto,
  UpdateCustomerInteractionDto,
  ListCustomerInteractionsDto,
} from './dto/customer-interaction.dto';
import { InteractionStatus, InteractionType, Prisma } from '@prisma/client';

@Injectable()
export class CustomerInteractionService {
  constructor(private readonly prisma: PrismaService) {}

  async createInteraction(
    customerId: string,
    createdByUserId: string,
    dto: CreateCustomerInteractionDto,
  ) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, isDonationCustomer: false },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    // Validate assigned user if provided
    if (dto.assignedToUserId) {
      const assignedUser = await this.prisma.user.findUnique({
        where: { id: dto.assignedToUserId },
      });

      if (!assignedUser) {
        throw new BadRequestException(
          `User with ID ${dto.assignedToUserId} not found`,
        );
      }
    }

    // Validate follow-up date is in the future
    if (dto.nextFollowUpDate) {
      const followUpDate = new Date(dto.nextFollowUpDate);
      if (followUpDate <= new Date()) {
        throw new BadRequestException('Follow-up date must be in the future');
      }
    }

    // Validate interaction date is not in the future
    const interactionDate = dto.interactionDate
      ? new Date(dto.interactionDate)
      : new Date();

    if (interactionDate > new Date()) {
      throw new BadRequestException('Interaction date cannot be in the future');
    }

    const interaction = await this.prisma.customerInteraction.create({
      data: {
        customerId,
        createdByUserId,
        interactionType: dto.interactionType,
        title: dto.title,
        description: dto.description,
        interactionDate,
        nextFollowUpDate: dto.nextFollowUpDate
          ? new Date(dto.nextFollowUpDate)
          : null,
        assignedToUserId: dto.assignedToUserId,
        tags: dto.tags || [],
      },
      include: {
        customer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        assignedToUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    return {
      message: 'Customer interaction created successfully',
      interaction,
    };
  }

  async getInteractionById(interactionId: string, customerId: string) {
    const interaction = await this.prisma.customerInteraction.findUnique({
      where: {
        id: interactionId,
        deletedAt: { isSet: false },
        customerId,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        assignedToUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        updatedByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    if (!interaction) {
      throw new NotFoundException(
        `Interaction with ID ${interactionId} not found for customer ${customerId}`,
      );
    }

    return interaction;
  }

  async listInteractions(
    customerId: string,
    query: ListCustomerInteractionsDto,
  ) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, isDonationCustomer: false },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const {
      page = 1,
      limit = 10,
      interactionType,
      status,
      search,
      tag,
      sortField = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const pageNum = Math.max(1, parseInt(String(page), 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(String(limit), 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: Prisma.CustomerInteractionWhereInput = {
      customerId,
      deletedAt: { isSet: false },
      ...(interactionType && { interactionType }),
      ...(status && { status }),
      ...(tag && { tags: { has: tag } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    // Fetch interactions with pagination
    const [interactions, total] = await Promise.all([
      this.prisma.customerInteraction.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
              phone: true,
            },
          },
          createdByUser: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
          assignedToUser: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
        orderBy: {
          [sortField]: sortOrder,
        },
        skip,
        take: limitNum,
      }),
      this.prisma.customerInteraction.count({ where }),
    ]);

    return {
      interactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: limitNum === 0 ? 0 : Math.ceil(total / limitNum),
      },
    };
  }

  async updateInteraction(
    interactionId: string,
    customerId: string,
    updatedByUserId: string,
    dto: UpdateCustomerInteractionDto,
  ) {
    // Verify interaction exists and belongs to the customer
    const interaction = await this.prisma.customerInteraction.findUnique({
      where: { id: interactionId, customerId },
    });

    if (!interaction) {
      throw new NotFoundException(
        `Interaction with ID ${interactionId} not found`,
      );
    }

    // Validate assigned user if provided
    if (dto.assignedToUserId) {
      const assignedUser = await this.prisma.user.findUnique({
        where: { id: dto.assignedToUserId },
      });

      if (!assignedUser) {
        throw new BadRequestException(
          `User with ID ${dto.assignedToUserId} not found`,
        );
      }
    }

    // Validate follow-up date is in the future
    if (dto.nextFollowUpDate) {
      const followUpDate = new Date(dto.nextFollowUpDate);
      if (followUpDate <= new Date()) {
        throw new BadRequestException('Follow-up date must be in the future');
      }
    }

    // Validate interaction date is not in the future
    if (dto.interactionDate) {
      const interactionDate = new Date(dto.interactionDate);
      if (interactionDate > new Date()) {
        throw new BadRequestException(
          'Interaction date cannot be in the future',
        );
      }
    }

    const updatedInteraction = await this.prisma.customerInteraction.update({
      where: { id: interactionId },
      data: {
        ...(dto.interactionType && { interactionType: dto.interactionType }),
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.interactionDate && {
          interactionDate: new Date(dto.interactionDate),
        }),
        ...(dto.nextFollowUpDate !== undefined && {
          nextFollowUpDate: dto.nextFollowUpDate
            ? new Date(dto.nextFollowUpDate)
            : null,
        }),
        ...(dto.assignedToUserId !== undefined && {
          assignedToUserId: dto.assignedToUserId,
        }),
        ...(dto.status && { status: dto.status }),
        ...(dto.tags && { tags: dto.tags }),
        updatedByUserId,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
          },
        },
        createdByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        assignedToUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        updatedByUser: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    return {
      message: 'Customer interaction updated successfully',
      interaction: updatedInteraction,
    };
  }

  async deleteInteraction(interactionId: string, customerId: string) {
    // Verify interaction exists and belongs to the customer
    const interaction = await this.prisma.customerInteraction.findUnique({
      where: { id: interactionId, customerId },
    });

    if (!interaction) {
      throw new NotFoundException(
        `Interaction with ID ${interactionId} not found`,
      );
    }

    // Soft delete
    await this.prisma.customerInteraction.update({
      where: { id: interactionId },
      data: { deletedAt: new Date() },
    });

    return {
      message: 'Customer interaction deleted successfully',
    };
  }

  async getInteractionStats(customerId: string) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, isDonationCustomer: false },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const where: Prisma.CustomerInteractionWhereInput = {
      customerId,
      deletedAt: null,
    };

    const [
      totalInteractions,
      openInteractions,
      completedInteractions,
      callInteractions,
      emailInteractions,
      meetingInteractions,
      upcomingFollowUps,
    ] = await Promise.all([
      this.prisma.customerInteraction.count({ where }),
      this.prisma.customerInteraction.count({
        where: { ...where, status: InteractionStatus.OPEN },
      }),
      this.prisma.customerInteraction.count({
        where: { ...where, status: InteractionStatus.COMPLETED },
      }),
      this.prisma.customerInteraction.count({
        where: { ...where, interactionType: InteractionType.CALL },
      }),
      this.prisma.customerInteraction.count({
        where: { ...where, interactionType: InteractionType.EMAIL },
      }),
      this.prisma.customerInteraction.count({
        where: { ...where, interactionType: InteractionType.MEETING },
      }),
      this.prisma.customerInteraction.count({
        where: {
          ...where,
          nextFollowUpDate: {
            lte: new Date(new Date().setDate(new Date().getDate() + 7)),
            gte: new Date(),
          },
        },
      }),
    ]);

    return {
      customerId,
      totalInteractions,
      openInteractions,
      completedInteractions,
      byType: {
        callInteractions,
        emailInteractions,
        meetingInteractions,
      },
      upcomingFollowUps,
    };
  }
}
