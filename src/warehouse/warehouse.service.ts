import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { GetWarehousesQueryDto } from './dto/get-warehouse-query.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { GetTransferRequestsQueryDto } from './dto/get-transfer-request-query.dto';
import { TransferRequestEntity } from './entities/transfer-request.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { FulfillTransferRequestDto } from './dto/fulfil-transfer-request.dto';
import { Prisma, TransferStatus, UserStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { WarehouseEntity } from './entities/warehouse.entity';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CreateTransferRequestDto } from './dto/create-transfer.dto';
import { AssignWarehouseManagerDto } from './dto/assign-warehouse-manager.dto';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async createWarehouse(
    createWarehouseDto: CreateWarehouseDto,
    userId: string,
    file?: Express.Multer.File,
  ) {
    const { name, location, description, isMain } = createWarehouseDto;

    if (isMain) {
      const existingMainWarehouse = await this.prisma.warehouse.findFirst({
        where: {
          isMain: true,
          deletedAt: {
            isSet: false,
          },
        },
      });

      if (existingMainWarehouse) {
        throw new ConflictException('A main warehouse already exists');
      }
    }

    const existingWarehouse = await this.prisma.warehouse.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (existingWarehouse) {
      throw new ConflictException('Warehouse with this name already exists');
    }

    let imageUrl: string | undefined;

    if (file) {
      const uploadResult = await this.cloudinary.uploadFile(file);
      imageUrl = uploadResult.secure_url;
    }

    const warehouse = await this.prisma.warehouse.create({
      data: {
        name,
        location,
        description,
        image: imageUrl,
        isMain: isMain || false,
        createdById: userId,
      },
      include: {
        _count: {
          select: {
            warehouseManagers: true,
            inventory: true,
          },
        },
      },
    });

    return {
      message: 'Warehouse created successfully',
      warehouse: plainToInstance(WarehouseEntity, warehouse),
    };
  }

  async getWarehouses(
    query: GetWarehousesQueryDto,
    userType?: string,
    warehouseManager?: any,
  ) {
    const {
      page = 1,
      limit = 10,
      search,
      isActive,
      isMain,
      sortField = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const whereConditions: Prisma.WarehouseWhereInput = {
      // deletedAt: { isSet: false },
      OR: [{ deletedAt: { isSet: false } }, { deletedAt: null }],
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(isActive !== undefined && { isActive }),
      ...(isMain !== undefined && { isMain }),
      ...(userType === 'warehouseManager' &&
        warehouseManager && {
          id: warehouseManager.warehouseId,
        }),
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;

    const orderBy = { [sortField]: sortOrder };

    const [warehouses, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { ...whereConditions },
        include: {
          _count: {
            select: {
              warehouseManagers: true,
              inventory: true,
              incomingRequests: {
                where: { status: TransferStatus.PENDING },
              },
            },
          },
          createdBy: {
            select: {
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
        skip,
        take: limitNumber,
        orderBy,
      }),
      this.prisma.warehouse.count({ where: whereConditions }),
    ]);

    const warehousesWithStats = await Promise.all(
      warehouses.map(async (warehouse) => {
        const inventoryStats = await this.prisma.inventoryBatch.aggregate({
          where: {
            inventory: {
              warehouseId: warehouse.id,
            },
            remainingQuantity: { gt: 0 },
          },
          _sum: {
            remainingQuantity: true,
          },
        });

        const totalValue = await this.prisma.inventoryBatch.findMany({
          where: {
            inventory: {
              warehouseId: warehouse.id,
            },
            remainingQuantity: { gt: 0 },
          },
          select: {
            remainingQuantity: true,
            price: true,
          },
        });

        const calculatedValue = totalValue.reduce(
          (sum, batch) => sum + batch.remainingQuantity * batch.price,
          0,
        );

        return {
          ...warehouse,
          managerCount: warehouse._count.warehouseManagers,
          totalItems: inventoryStats._sum.remainingQuantity || 0,
          totalValue: calculatedValue,
          pendingRequests: warehouse._count.incomingRequests,
        };
      }),
    );

    return {
      warehouses: plainToInstance(WarehouseEntity, warehousesWithStats),
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async getWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        deletedAt: {
          isSet: false,
        },
      },
      include: {
        _count: {
          select: {
            warehouseManagers: true,
            inventory: true,
            incomingRequests: true,
            outgoingRequests: true,
          },
        },
        warehouseManagers: {
          include: {
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
        createdBy: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    // Get inventory statistics
    const inventoryStats = await this.getWarehouseInventoryStats(id);

    return {
      ...warehouse,
      ...inventoryStats,
      managersCount: warehouse._count.warehouseManagers,
    };
  }

  async updateWarehouse(
    id: string,
    updateWarehouseDto: UpdateWarehouseDto,
    file?: Express.Multer.File,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const { name, location, description, isActive } = updateWarehouseDto;

    if (name && name !== warehouse.name) {
      const existingWarehouse = await this.prisma.warehouse.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
          deletedAt: {
            isSet: false,
          },
        },
      });

      if (existingWarehouse) {
        throw new ConflictException('Warehouse with this name already exists');
      }
    }

    let imageUrl = warehouse.image;
    if (file) {
      const uploadResult = await this.cloudinary.uploadFile(file);
      imageUrl = uploadResult.secure_url;
    }

    const updatedWarehouse = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(location && { location }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(imageUrl && { image: imageUrl }),
      },
    });

    return {
      message: 'Warehouse updated successfully',
      warehouse: plainToInstance(WarehouseEntity, updatedWarehouse),
    };
  }

  async deleteWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        deletedAt: {
          isSet: false,
        },
      },
      include: {
        _count: {
          select: {
            inventory: {
              where: {
                batches: {
                  some: { remainingQuantity: { gt: 0 } },
                },
              },
            },
            warehouseManagers: true,
            incomingRequests: { where: { status: TransferStatus.PENDING } },
            outgoingRequests: { where: { status: TransferStatus.PENDING } },
          },
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (warehouse.isMain) {
      throw new BadRequestException('Cannot delete the main warehouse');
    }

    if (warehouse._count.inventory > 0) {
      throw new BadRequestException(
        'Cannot delete warehouse with existing inventory',
      );
    }

    if (
      warehouse._count.incomingRequests > 0 ||
      warehouse._count.outgoingRequests > 0
    ) {
      throw new BadRequestException(
        'Cannot delete warehouse with pending transfer requests',
      );
    }

    // Soft delete
    await this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: 'Warehouse deleted successfully' };
  }

  async deactivateWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (warehouse.isMain) {
      throw new BadRequestException('Cannot deactivate the main warehouse');
    }

    await this.prisma.warehouse.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: 'Warehouse deactivated successfully' };
  }

  async activateWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    await this.prisma.warehouse.update({
      where: { id },
      data: { isActive: true },
    });

    return { message: 'Warehouse activated successfully' };
  }

  async createTransferRequest(
    createTransferRequestDto: CreateTransferRequestDto,
    requestedBy: string,
    warehouseAgent?: any,
  ) {
    const {
      fromWarehouseId,
      toWarehouseId,
      inventoryBatchId,
      requestedQuantity,
      notes,
    } = createTransferRequestDto;

    // Validate warehouse agent can make requests for their warehouse
    if (warehouseAgent) {
      if (warehouseAgent.warehouseId === fromWarehouseId) {
        throw new BadRequestException('Cannot request from your own warehouse');
      }

      if (warehouseAgent.warehouseId !== toWarehouseId) {
        throw new BadRequestException(
          'You can only request to your own warehouse',
        );
      }
    }

    const fromWareHouseAsMainExists = await this.prisma.warehouse.findFirst({
      where: {
        id: fromWarehouseId,
        deletedAt: {
          isSet: false,
        },
        isMain: true,
        isActive: true,
      },
    });

    if (!fromWareHouseAsMainExists) {
      throw new BadRequestException(
        'You can only request transfer from a valid main warehouse',
      );
    }

    const toWareHouseAsExists = await this.prisma.warehouse.findFirst({
      where: {
        id: toWarehouseId,
        deletedAt: {
          isSet: false,
        },
        isActive: true,
      },
    });

    if (toWareHouseAsExists) {
      throw new BadRequestException('toWarehouse id is invalid warehouse');
    }

    // Validate inventory batch exists and has sufficient quantity
    const inventoryBatch = await this.prisma.inventoryBatch.findFirst({
      where: {
        id: inventoryBatchId,
        inventory: {
          warehouseId: fromWarehouseId,
        },
        remainingQuantity: { gte: requestedQuantity },
      },
      include: {
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    if (!inventoryBatch) {
      throw new NotFoundException(
        'Inventory batch not found or insufficient quantity',
      );
    }

    // Generate request ID
    const requestCount = await this.prisma.inventoryTransferRequest.count();
    const requestId = `tr-${String(requestCount + 1).padStart(3, '0')}`;

    const transferRequest = await this.prisma.inventoryTransferRequest.create({
      data: {
        requestId,
        fromWarehouseId,
        toWarehouseId,
        inventoryBatchId,
        requestedQuantity,
        notes,
        requestedById: requestedBy,
      },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        inventoryBatch: {
          include: { inventory: true },
        },
        requestedBy: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
    });

    return {
      message: 'Transfer request created successfully',
      transferRequest: plainToInstance(TransferRequestEntity, transferRequest),
    };
  }

  async getTransferRequests(
    query: GetTransferRequestsQueryDto,
    warehouseAgent?: any,
  ) {
    const {
      page = 1,
      limit = 10,
      status,
      fromWarehouseId,
      toWarehouseId,
      search,
      sortField = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const whereConditions: Prisma.InventoryTransferRequestWhereInput = {
      AND: [
        // Filter by warehouse if user is a warehouse agent
        warehouseAgent
          ? {
              OR: [
                { fromWarehouseId: warehouseAgent.warehouseId },
                { toWarehouseId: warehouseAgent.warehouseId },
              ],
            }
          : {},
        status ? { status } : {},
        fromWarehouseId ? { fromWarehouseId } : {},
        toWarehouseId ? { toWarehouseId } : {},
        search
          ? {
              inventoryBatch: {
                inventory: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
            }
          : {},
      ],
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;

    const orderBy = { [sortField]: sortOrder };

    const [requests, total] = await Promise.all([
      this.prisma.inventoryTransferRequest.findMany({
        where: whereConditions,
        include: {
          fromWarehouse: {
            select: {
              id: true,
              name: true,
              location: true,
            },
          },
          toWarehouse: {
            select: {
              id: true,
              name: true,
              location: true,
            },
          },
          inventoryBatch: {
            include: {
              inventory: {
                select: {
                  name: true,
                  manufacturerName: true,
                },
              },
            },
          },
          requestedBy: {
            select: {
              firstname: true,
              lastname: true,
              email: true,
            },
          },
          fulfilledBy: {
            select: {
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
        skip,
        take: limitNumber,
        orderBy,
      }),
      this.prisma.inventoryTransferRequest.count({ where: whereConditions }),
    ]);

    return {
      transferRequests: plainToInstance(TransferRequestEntity, requests),
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }

  async fulfillTransferRequest(
    requestId: string,
    fulfillTransferRequestDto: FulfillTransferRequestDto,
    fulfilledBy: string,
    warehouseManager?: any,
  ) {
    const { fulfilledQuantity, notes } = fulfillTransferRequestDto;

    const transferRequest =
      await this.prisma.inventoryTransferRequest.findUnique({
        where: {
          id: requestId,
          ...(warehouseManager
            ? { fromWarehouseId: warehouseManager?.warehouseId }
            : {}),
        },
        include: {
          inventoryBatch: true,
          toWarehouse: true,
        },
      });

    if (!transferRequest) {
      throw new NotFoundException('Transfer request not found');
    }

    if (transferRequest.status === TransferStatus.FULFILLED) {
      throw new BadRequestException('Transfer request already fulfilled');
    }

    if (transferRequest.status === TransferStatus.REJECTED) {
      throw new BadRequestException('Cannot fulfill rejected request');
    }

    const remainingToFulfill =
      transferRequest.requestedQuantity - transferRequest.fulfilledQuantity;

    if (fulfilledQuantity > remainingToFulfill) {
      throw new BadRequestException(
        'Fulfilled quantity exceeds remaining request',
      );
    }

    if (fulfilledQuantity > transferRequest.inventoryBatch.remainingQuantity) {
      throw new BadRequestException('Insufficient inventory quantity');
    }

    // Start transaction
    return await this.prisma.$transaction(async (prisma) => {
      // Update source batch quantity
      await prisma.inventoryBatch.update({
        where: { id: transferRequest.inventoryBatchId },
        data: {
          remainingQuantity: {
            decrement: fulfilledQuantity,
          },
        },
      });

      // Create or update destination batch
      const destinationBatch = await prisma.inventoryBatch.findFirst({
        where: {
          inventory: {
            id: transferRequest.inventoryBatch.inventoryId,
            warehouseId: transferRequest.toWarehouseId,
          },
          price: transferRequest.inventoryBatch.price,
        },
      });

      if (destinationBatch) {
        await prisma.inventoryBatch.update({
          where: { id: destinationBatch.id },
          data: {
            remainingQuantity: {
              increment: fulfilledQuantity,
            },
            numberOfStock: {
              increment: fulfilledQuantity,
            },
          },
        });
      } else {
        await prisma.inventoryBatch.create({
          data: {
            inventoryId: transferRequest.inventoryBatch.inventoryId,
            price: transferRequest.inventoryBatch.price,
            costOfItem: transferRequest.inventoryBatch.costOfItem,
            batchNumber: Date.now(),
            numberOfStock: fulfilledQuantity,
            remainingQuantity: fulfilledQuantity,
          },
        });
      }

      // Update transfer request
      const totalFulfilled =
        transferRequest.fulfilledQuantity + fulfilledQuantity;
      const newStatus =
        totalFulfilled >= transferRequest.requestedQuantity
          ? TransferStatus.FULFILLED
          : TransferStatus.PARTIAL;

      const updatedRequest = await prisma.inventoryTransferRequest.update({
        where: { id: requestId },
        data: {
          fulfilledQuantity: totalFulfilled,
          status: newStatus,
          fulfilledById: fulfilledBy,
          notes: notes || transferRequest.notes,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          inventoryBatch: {
            include: { inventory: true },
          },
          fulfilledBy: {
            select: {
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
      });

      return {
        message: 'Transfer request fulfilled successfully',
        transferRequest: plainToInstance(TransferRequestEntity, updatedRequest),
      };
    });
  }

  async rejectTransferRequest(
    requestId: string,
    notes?: string,
    warehouseManager?: any,
  ) {
    const transferRequest =
      await this.prisma.inventoryTransferRequest.findUnique({
        where: {
          id: requestId,
          ...(warehouseManager
            ? { fromWarehouseId: warehouseManager?.warehouseId }
            : {}),
        },
      });

    if (!transferRequest) {
      throw new NotFoundException('Transfer request not found');
    }

    if (transferRequest.status !== TransferStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    const updatedRequest = await this.prisma.inventoryTransferRequest.update({
      where: { id: requestId },
      data: {
        status: TransferStatus.REJECTED,
        notes: notes || transferRequest.notes,
      },
    });

    return {
      message: 'Transfer request rejected',
      transferRequest: updatedRequest,
    };
  }

  async getWarehouseStats() {
    const [
      totalWarehouses,
      activeWarehouses,
      mainWarehouses,
      pendingTransferRequests,
    ] = await Promise.all([
      this.prisma.warehouse.count({
        where: {
          deletedAt: {
            isSet: false,
          },
        },
      }),
      this.prisma.warehouse.count({
        where: {
          isActive: true,
          deletedAt: {
            isSet: false,
          },
        },
      }),
      this.prisma.warehouse.count({
        where: {
          isMain: true,
          deletedAt: {
            isSet: false,
          },
        },
      }),
      this.prisma.inventoryTransferRequest.count({
        where: { status: TransferStatus.PENDING },
      }),
    ]);

    return {
      totalWarehouses,
      activeWarehouses,
      inactiveWarehouses: totalWarehouses - activeWarehouses,
      mainWarehouses,
      subsidiaryWarehouses: totalWarehouses - mainWarehouses,
      pendingTransferRequests,
    };
  }

  async assignWarehouseManagers(
    warehouseId: string,
    assignWarehouseManagerDto: AssignWarehouseManagerDto,
    assignedBy: string,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const { userIds } = assignWarehouseManagerDto;

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        status: UserStatus.active,
        deletedAt: {
          isSet: false,
        },
        warehouseManager: null,
        agentDetails: null,
      },
    });

    if (users.length !== userIds.length) {
      throw new BadRequestException(
        'Some users are invalid or already assigned',
      );
    }

    await this.prisma.warehouseManager.createMany({
      data: userIds.map((userId) => ({
        warehouseId,
        userId,
        assignedById: assignedBy,
      })),
    });

    return { message: 'Warehouse managers assigned successfully' };
  }

  async unassignWarehouseManager(warehouseManagerId: string) {
    const warehouseManager = await this.prisma.warehouseManager.findUnique({
      where: { id: warehouseManagerId },
    });

    if (!warehouseManager) {
      throw new NotFoundException('Warehouse manager not found');
    }

    await this.prisma.warehouseManager.delete({
      where: { id: warehouseManagerId },
    });

    return { message: 'Warehouse manager unassigned successfully' };
  }

  async getWarehouseManagers(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        deletedAt: {
          isSet: false,
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const managers = await this.prisma.warehouseManager.findMany({
      where: { warehouseId },
      include: {
        user: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        warehouse: {
          select: {
            name: true,
            location: true,
            isMain: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { managers };
  }

  private async getWarehouseInventoryStats(warehouseId: string) {
    const inventoryBatches = await this.prisma.inventoryBatch.findMany({
      where: {
        inventory: {
          warehouseId,
        },
        remainingQuantity: { gt: 0 },
      },
      select: {
        remainingQuantity: true,
        price: true,
      },
    });

    const totalItems = inventoryBatches.reduce(
      (sum, batch) => sum + batch.remainingQuantity,
      0,
    );

    const totalValue = inventoryBatches.reduce(
      (sum, batch) => sum + batch.remainingQuantity * batch.price,
      0,
    );

    return { totalItems, totalValue };
  }
}
