import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../constants';
import { CategoryTypes, InventoryClass, Prisma } from '@prisma/client';
import { FetchInventoryQueryDto } from './dto/fetch-inventory.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateInventoryBatchDto } from './dto/create-inventory-batch.dto';
import { InventoryEntity } from './entity/inventory.entity';
import { plainToInstance } from 'class-transformer';
import { InventoryBatchEntity } from './entity/inventory-batch.entity';
import { CategoryEntity } from '../utils/entity/category';

@Injectable()
export class InventoryService {
  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly prisma: PrismaService,
  ) {}

  async inventoryFilter(
    query: FetchInventoryQueryDto,
  ): Promise<Prisma.InventoryWhereInput> {
    const {
      search,
      inventoryCategoryId,
      inventorySubCategoryId,
      createdAt,
      updatedAt,
      class: inventoryClass,
      warehouseId,
    } = query;

    const filterConditions: Prisma.InventoryWhereInput = {
      AND: [
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { manufacturerName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        inventoryCategoryId ? { inventoryCategoryId } : {},
        inventorySubCategoryId ? { inventorySubCategoryId } : {},
        warehouseId ? { warehouseId } : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
        inventoryClass ? { class: inventoryClass as InventoryClass } : {},
      ],
    };

    return filterConditions;
  }

  async uploadInventoryImage(file: Express.Multer.File) {
    return await this.cloudinary.uploadFile(file).catch((e) => {
      throw e;
    });
  }

  async createInventory(
    requestUserId: string,
    createInventoryDto: CreateInventoryDto,
    file: Express.Multer.File,
  ) {
    const { inventorySubCategoryId, inventoryCategoryId } = createInventoryDto;

    const isCategoryValid = await this.prisma.category.findFirst({
      where: {
        id: inventoryCategoryId,
        children: {
          some: {
            id: inventorySubCategoryId,
            type: CategoryTypes.INVENTORY,
          },
        },
        type: CategoryTypes.INVENTORY,
      },
    });

    if (!isCategoryValid) {
      throw new BadRequestException(
        'Invalid inventorySubCategoryId or inventoryCategoryId',
      );
    }

    // const warehouseManager = await this.prisma.warehouseManager.findFirst({
    //   where: {
    //     userId: requestUserId,
    //     warehouse: { isMain: true, isActive: true},
    //   },
    // });

    // const warehouseId =
    //   warehouseManager?.warehouseId ?? createInventoryDto.warehouseId;

    // if(warehouseId){
    //   const warehouse = await this.prisma.warehouse.findFirst({
    //     where: {
    //       id: warehouseId
    //     }
    //   })

    //   if(!warehouse){
    //     throw new NotFoundException("Warehouse not found")
    //   }
    // }

    const { id: warehouseId } = await this.prisma.warehouse.findFirst({
      where: { isMain: true, isActive: true },
    });

    const image = (await this.uploadInventoryImage(file)).secure_url;

    const inventoryData = await this.prisma.inventory.create({
      data: {
        name: createInventoryDto.name,
        manufacturerName: createInventoryDto.manufacturerName,
        dateOfManufacture: createInventoryDto.dateOfManufacture,
        ...(warehouseId ? { warehouseId } : {}),
        sku: createInventoryDto.sku,
        image,
        class: createInventoryDto.class,
        inventoryCategoryId: createInventoryDto.inventoryCategoryId,
        inventorySubCategoryId: createInventoryDto.inventorySubCategoryId,
      },
    });

    // Create initial batch in main warehouse
    await this.prisma.inventoryBatch.create({
      data: {
        creatorId: requestUserId,
        inventoryId: inventoryData.id,
        batchNumber: Date.now() - 100,
        costOfItem: parseFloat(createInventoryDto.costOfItem),
        price: parseFloat(createInventoryDto.price),
        numberOfStock: createInventoryDto.numberOfStock,
        remainingQuantity: createInventoryDto.numberOfStock,
      },
    });

    return {
      message: MESSAGES.INVENTORY_CREATED,
    };
  }

  async createInventoryBatch(
    requestUserId: string,
    createInventoryBatchDto: CreateInventoryBatchDto,
  ) {
    const warehouseManager = await this.prisma.warehouseManager.findFirst({
      where: {
        userId: requestUserId,
        warehouse: { isMain: true, isActive: true, deletedAt: null },
      },
    });

    const warehouseId =
      warehouseManager?.warehouseId ?? createInventoryBatchDto.warehouseId;

    const isInventoryValid = await this.prisma.inventory.findFirst({
      where: {
        id: createInventoryBatchDto.inventoryId,
        ...(warehouseId ? { warehouseId } : {}),
      },
    });

    if (!isInventoryValid) {
      throw new BadRequestException('Invalid inventoryId');
    }

    await this.prisma.inventoryBatch.create({
      data: {
        creatorId: requestUserId,
        batchNumber: Date.now() - 100,
        inventoryId: createInventoryBatchDto.inventoryId,
        costOfItem: parseFloat(createInventoryBatchDto.costOfItem),
        price: parseFloat(createInventoryBatchDto.price),
        numberOfStock: createInventoryBatchDto.numberOfStock,
        remainingQuantity: createInventoryBatchDto.numberOfStock,
      },
    });

    return {
      message: MESSAGES.INVENTORY_CREATED,
    };
  }

  async getInventories(query: FetchInventoryQueryDto, requestUserId?: string) {
    const {
      page = 1,
      limit = 100,
      sortField = 'createdAt',
      sortOrder,
      inventoryCategoryId,
      inventorySubCategoryId,
    } = query;

    if (inventoryCategoryId || inventorySubCategoryId) {
      const categoryIds = [inventoryCategoryId, inventorySubCategoryId].filter(
        Boolean,
      );

      const isCategoryValid = await this.prisma.category.findFirst({
        where: {
          id: {
            in: categoryIds,
          },
          type: CategoryTypes.INVENTORY,
        },
      });

      if (!isCategoryValid) {
        throw new BadRequestException(
          'Invalid inventorySubCategoryId or inventoryCategoryId',
        );
      }
    }

    const warehouseManager = await this.prisma.warehouseManager.findFirst({
      where: {
        userId: requestUserId,
        warehouse: { isMain: true, isActive: true, deletedAt: null },
      },
    });

    const filterConditions = await this.inventoryFilter({
      ...query,
      ...(warehouseManager
        ? { warehouseId: warehouseManager.warehouseId }
        : {}),
    });

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    const result = await this.prisma.inventory.findMany({
      skip,
      take,
      where: {...filterConditions, hideInventory: false},
      orderBy,
      include: {
        batches: {
          include: {
            creatorDetails: {
              select: {
                firstname: true,
                lastname: true,
              },
            },
          },
        },
        inventoryCategory: true,
        inventorySubCategory: true,
      },
    });

    const updatedResults = result.map(this.mapInventoryToResponseDto);

    const totalCount = await this.prisma.inventory.count({
      where: {...filterConditions, hideInventory: false},
    });

    return {
      inventories: plainToInstance(InventoryEntity, updatedResults),
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async getInventory(inventoryId: string, requestUserId?: string) {
    const warehouseManager = await this.prisma.warehouseManager.findFirst({
      where: {
        userId: requestUserId,
        warehouse: { isMain: true, isActive: true, deletedAt: null },
      },
    });

    const inventory = await this.prisma.inventory.findUnique({
      where: {
        id: inventoryId,
        ...(warehouseManager
          ? { warehouseId: warehouseManager.warehouseId }
          : {}),
      },
      include: {
        batches: {
          include: {
            creatorDetails: {
              select: {
                firstname: true,
                lastname: true,
              },
            },
          },
        },
        inventoryCategory: true,
        inventorySubCategory: true,
      },
    });

    if (!inventory) {
      throw new NotFoundException(MESSAGES.INVENTORY_NOT_FOUND);
    }

    return this.mapInventoryToResponseDto(inventory);
  }

  async getInventoryBatch(inventoryBatchId: string, requestUserId: string) {
    const warehouseManager = await this.prisma.warehouseManager.findFirst({
      where: {
        userId: requestUserId,
        warehouse: { isMain: true, isActive: true, deletedAt: null },
      },
    });

    const inventorybatch = await this.prisma.inventoryBatch.findUnique({
      where: {
        id: inventoryBatchId,
        inventory: {
          ...(warehouseManager
            ? { warehouseId: warehouseManager.warehouseId }
            : {}),
        },
      },
      include: {
        inventory: true,
      },
    });

    if (!inventorybatch) {
      throw new NotFoundException(MESSAGES.BATCH_NOT_FOUND);
    }

    return plainToInstance(InventoryBatchEntity, {
      ...inventorybatch,
      inventory: plainToInstance(InventoryEntity, inventorybatch.inventory),
    });
  }

  async createInventoryCategory(categories: CreateCategoryDto[]) {
    // const existingCategoryNames = [];

    for (const category of categories) {
      const { name, subCategories, parentId } = category;

      const existingCategoryByName = await this.prisma.category.findFirst({
        where: { name, type: CategoryTypes.INVENTORY },
      });

      if (existingCategoryByName) {
        throw new ConflictException(
          `An inventory category with this name: ${name} already exists`,
        );
      }

      if (parentId) {
        const existingParentCategory = await this.prisma.category.findFirst({
          where: { id: parentId },
        });

        if (!existingParentCategory) {
          throw new BadRequestException('Invalid Parent Id');
        }
      }

      await this.prisma.category.create({
        data: {
          name,
          ...(parentId ? { parentId } : {}),
          type: CategoryTypes.INVENTORY,
          children: {
            create: subCategories?.map((subCat) => ({
              name: subCat.name,
              type: CategoryTypes.INVENTORY,
            })),
          },
        },
      });
    }

    return { message: MESSAGES.CREATED };
  }

  async getInventoryCategories() {
    return await this.prisma.category.findMany({
      where: {
        type: CategoryTypes.INVENTORY,
        parent: null,
      },
      include: {
        children: true,
      },
    });
  }

  async getInventoryStats(requestUserId: string) {
    const warehouseManager = await this.prisma.warehouseManager.findFirst({
      where: {
        userId: requestUserId,
        warehouse: { isMain: true, isActive: true, deletedAt: null },
      },
    });

    // const inventory = await this.prisma.inventory.findUnique({
    //   where: {
    //     id: inventoryId,
    // ...(warehouseManager
    //   ? { warehouseId: warehouseManager.warehouseId }
    //   : {}),
    //   },
    const inventoryClassCounts = await this.prisma.inventory.groupBy({
      by: ['class'],
      _count: {
        class: true,
      },
    });

    const transformedClassCounts = inventoryClassCounts.map((item) => ({
      inventoryClass: item.class,
      count: item._count.class,
    }));

    const totalInventoryCount = await this.prisma.inventory.count({
      where: {
        ...(warehouseManager
          ? { warehouseId: warehouseManager.warehouseId }
          : {}),
        hideInventory: false,
      },
    });

    const deletedInventoryCount = await this.prisma.inventory.count({
      where: {
        ...(warehouseManager
          ? { warehouseId: warehouseManager.warehouseId }
          : {}),
        hideInventory: false,
        deletedAt: {
          not: null,
        },
      },
    });

    return {
      inventoryClassCounts: transformedClassCounts,
      totalInventoryCount,
      deletedInventoryCount,
    };
  }

  async getInventoryTabs(inventoryId: string) {
    const inventory = await this.prisma.inventory.findUnique({
      where: { id: inventoryId },
    });

    if (!inventory) throw new NotFoundException(MESSAGES.INVENTORY_NOT_FOUND);

    const tabs = [
      {
        name: 'Details',
        url: `/inventory/${inventoryId}`,
      },
      {
        name: 'History',
        url: `/inventory/${inventoryId}/history`,
      },
      {
        name: 'Stats',
        url: `/inventory/${inventoryId}/stats`,
      },
    ];

    return tabs;
  }

  mapInventoryToResponseDto(
    inventory: Prisma.InventoryGetPayload<{
      include: {
        inventoryCategory: true;
        inventorySubCategory: true;
        batches: {
          include: {
            creatorDetails: {
              select: {
                firstname: true;
                lastname: true;
              };
            };
          };
        };
      };
    }>,
  ) {
    const { batches, inventoryCategory, inventorySubCategory, ...rest } =
      inventory;
    const salePrice = {
      minimumInventoryBatchPrice: 0,
      maximumInventoryBatchPrice: 0,
    };
    if (batches.length) {
      const batchPrices = batches
        .filter(({ remainingQuantity }) => remainingQuantity > 0)
        .map((batch) => batch.price);
      const minimumInventoryBatchPrice = Math.floor(Math.min(...batchPrices));
      const maximumInventoryBatchPrice = Math.ceil(Math.max(...batchPrices));
      salePrice.minimumInventoryBatchPrice = minimumInventoryBatchPrice;
      salePrice.maximumInventoryBatchPrice = maximumInventoryBatchPrice;
    }
    const inventoryValue = batches.reduce(
      (sum, batch) => sum + batch.remainingQuantity * batch.price,
      0,
    );

    const totalRemainingQuantities = batches.reduce(
      (sum, batch) => sum + batch.remainingQuantity,
      0,
    );

    const totalInitialQuantities = batches.reduce(
      (sum, batch) => sum + batch.numberOfStock,
      0,
    );

    const updatedBatches = batches.map((batch) => ({
      ...batch,
      stockValue: (batch.remainingQuantity * batch.price).toFixed(2),
    }));

    return {
      ...rest,
      inventoryCategory: plainToInstance(CategoryEntity, inventoryCategory),
      inventorySubCategory: plainToInstance(
        CategoryEntity,
        inventorySubCategory,
      ),
      batches: plainToInstance(InventoryBatchEntity, updatedBatches),
      salePrice,
      inventoryValue,
      totalRemainingQuantities,
      totalInitialQuantities,
    };
  }
}
