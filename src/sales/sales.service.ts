import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSalesDto,
  SaleItemDto,
  UpdateSaleDto,
} from './dto/create-sales.dto';
import {
  BatchAlocation,
  PaymentGateway,
  PaymentMethod,
  PaymentMode,
  PaymentStatus,
  Prisma,
  SalesStatus,
  TaskStatus,
} from '@prisma/client';
import { ValidateSaleProductItemDto } from './dto/validate-sale-product.dto';
import { ContractService } from '../contract/contract.service';
import { PaymentService } from '../payment/payment.service';
import { BatchAllocation, ProcessedSaleItem } from './sales.interface';
import { CreateFinancialMarginDto } from './dto/create-financial-margins.dto';
import { CreateNextPaymentDto } from 'src/payment/dto/cash-payment.dto';
import { ListSalesQueryDto } from './dto/list-sales.dto';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from '../users/entity/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ReferenceGeneratorService } from 'src/payment/reference-generator.service';
import { SalesIdGeneratorService } from './saleid-generator';
import { DeviceAssignmentService } from 'src/device/device-assignment.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contractService: ContractService,
    private readonly paymentService: PaymentService,
    private readonly walletService: WalletService,
    private readonly referenceGenerator: ReferenceGeneratorService,
    private readonly salesIdGenerator: SalesIdGeneratorService,
    private readonly deviceAssignmentService: DeviceAssignmentService,
    @InjectQueue('payment-queue') private paymentQueue: Queue,
  ) {}

  async createSale(creatorId: string, dto: CreateSalesDto, agentId?: string) {
    if (agentId) {
      await this.validateAgentAccess(agentId, dto);
      // await this.validateAgentDevices(agentId, dto);
      await this.validateCustomerForAgentSale(dto.customerId, agentId);
    }

    // Validate sales relations
    await this.validateSalesRelations(dto);

    // Validate inventory availability
    await this.validateSaleProductQuantity(dto.saleItems);

    await this.validateDeviceAvailability(dto.saleItems);

    const financialSettings = await this.prisma.financialSettings.findFirst();

    if (!financialSettings) {
      throw new BadRequestException('Financial settings not configured');
    }

    const formattedSaleId =
      await this.salesIdGenerator.generateFormattedSaleId();

    const processedItems: ProcessedSaleItem[] = [];
    for (const item of dto.saleItems) {
      const processedItem = await this.calculateItemPrice(
        item,
        financialSettings,
        dto.applyMargin,
      );
      processedItems.push(processedItem);
    }

    const totalAmount = processedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0,
    );

    const totalAmountToPay = processedItems.reduce(
      (sum, item) => sum + (item.installmentTotalPrice || item.totalPrice),
      0,
    );

    const totalInstallmentStartingPrice = processedItems.reduce(
      (sum, item) => sum + (item.installmentTotalPrice || 0),
      0,
    );

    // const totalInstallmentDuration = processedItems.reduce(
    //   (sum, item) => sum + (item.duration || 0),
    //   0,
    // );

    const totalInstallmentDuration = Math.max(
      ...processedItems
        .filter((item) => item.paymentMode === PaymentMode.INSTALLMENT)
        .map((item) => item.duration || 0),
      0,
    );

    const totalMonthlyPayment = processedItems.reduce(
      (sum, item) => sum + (item.monthlyPayment || 0),
      0,
    );

    const totalMiscellaneousPrice = processedItems.reduce(
      (sum, item) => sum + (item.miscTotal || 0),
      0,
    );

    const hasInstallmentItems = processedItems.some(
      (item) => item.paymentMode === PaymentMode.INSTALLMENT,
    );

    // if (hasInstallmentItems && !dto.bvn) {
    //   throw new BadRequestException(`Bvn is required for installment payments`);
    // }
    // if (
    //   hasInstallmentItems &&
    //   (!dto.nextOfKinDetails ||
    //     !dto.identificationDetails ||
    //     !dto.guarantorDetails)
    // ) {
    //   throw new BadRequestException(
    //     'Contract details are required for installment payments',
    //   );
    // }
    // if (
    //   hasInstallmentItems &&
    //   (!dto.identificationDetails || !dto.guarantorDetails)
    // ) {
    //   throw new BadRequestException(
    //     'Contract details are required for installment payments',
    //   );
    // }

    if (agentId) {
      const walletBalance = await this.walletService.getWalletBalance(agentId);
      if (walletBalance < totalAmountToPay) {
        throw new BadRequestException(
          `Insufficient wallet balance. Required: ₦${totalAmountToPay}, Available: ₦${walletBalance}`,
        );
      }
    }

    let sale: any;

    await this.prisma.$transaction(async (prisma) => {
      sale = await prisma.sales.create({
        data: {
          category: dto.category,
          customerId: dto.customerId,
          totalPrice: totalAmount,
          installmentStartingPrice: totalInstallmentStartingPrice,
          formattedSaleId,
          totalInstallmentDuration,
          // remainingInstallments: totalInstallmentDuration - 1,
          remainingInstallments: totalInstallmentDuration,
          totalMiscellaneousPrice,
          totalMonthlyPayment,
          status: SalesStatus.UNPAID,
          batchAllocations: {
            createMany: {
              data: processedItems.flatMap(({ batchAllocation }) =>
                batchAllocation.map(({ batchId, price, quantity }) => ({
                  inventoryBatchId: batchId,
                  price,
                  quantity,
                })),
              ),
            },
          },
          creatorId,
        },
        include: {
          customer: true,
        },
      });

      for (const item of processedItems) {
        await prisma.saleItem.create({
          data: {
            sale: {
              connect: {
                id: sale.id,
              },
            },
            product: {
              connect: {
                id: item.productId,
              },
            },
            paymentMode: item.paymentMode,
            discount: item.discount,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            monthlyPayment: item.monthlyPayment,
            miscellaneousPrices: item.miscellaneousPrices,
            installmentDuration: item.installmentDuration,
            installmentStartingPrice: item.installmentStartingPrice,
            devices: {
              connect: item.devices.map((deviceId) => ({ id: deviceId })),
            },
            ...(item.saleRecipient && {
              SaleRecipient: {
                create: item.saleRecipient,
              },
            }),
          },
        });

        // Deduct from inventory batches
        for (const allocation of item.batchAllocation) {
          await this.prisma.inventoryBatch.update({
            where: { id: allocation.batchId },
            data: {
              remainingQuantity: {
                decrement: allocation.quantity,
              },
            },
          });
        }
      }
    });

    const transactionRef = `sale-${sale.id}-${Date.now()}`;

    if (hasInstallmentItems) {
      const totalInitialPayment = processedItems
        .filter((item) => item.paymentMode === PaymentMode.INSTALLMENT)
        .reduce((sum, item) => sum + item.installmentStartingPrice, 0);

      const contract = await this.contractService.createContract(
        dto,
        totalInitialPayment,
      );

      await this.prisma.sales.update({
        where: { id: sale.id },
        data: { contractId: contract.id },
      });

      // if (dto.bvn && dto.paymentMethod === PaymentMethod.ONLINE) {
      //   const tempAccountDetails =
      //     await this.paymentService.generateStaticAccount(
      //       sale.id,
      //       sale.customer.email || `${sale.customer.phone}@gmail.com`,
      //       dto.bvn,
      //       transactionRef,
      //     );
      //   await this.prisma.installmentAccountDetails.create({
      //     data: {
      //       sales: {
      //         connect: { id: sale.id },
      //       },
      //       flw_ref: tempAccountDetails.flw_ref,
      //       order_ref: tempAccountDetails.order_ref,
      //       account_number: tempAccountDetails.account_number,
      //       account_status: tempAccountDetails.account_status,
      //       frequency: tempAccountDetails.frequency,
      //       bank_name: tempAccountDetails.bank_name,
      //       expiry_date: tempAccountDetails.expiry_date,
      //       note: tempAccountDetails.note,
      //       amount: tempAccountDetails.amount,
      //     },
      //   });
      // }
    }

    // return await this.paymentService.generatePaymentLink(
    //   sale.id,
    //   totalAmountToPay,
    //   sale.customer.email,
    // transactionRef
    // );

    if (agentId) {
      return await this.prisma.$transaction(async (prisma) => {
        await this.walletService.debitWallet(
          agentId,
          totalAmountToPay,
          `sale-${sale.id}`,
          `Payment for sale ${sale.id}`,
          sale.id,
        );

        const paymentData = await prisma.payment.create({
          data: {
            sale: {
              connect: {
                id: sale.id,
              },
            },
            amount: totalAmountToPay,
            transactionRef,
            paymentMethod: PaymentMethod.WALLET,
            paymentStatus: PaymentStatus.COMPLETED,
          },
        });

        await this.prisma.installerTask.create({
          data: {
            status: TaskStatus.PENDING,
            sale: { connect: { id: sale.id } },
            customer: { connect: { id: sale.customerId } },
            requestingAgent: { connect: { id: agentId } },
          },
        });

        const job = await this.paymentQueue.add(
          'process-next-payment',
          { paymentData },
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
          success: true,
          message: 'Sale created successfully',
          sale,
          paymentData,
        };
      });
    }

    return await this.paymentService.generatePaymentPayload(
      sale.id,
      totalAmountToPay,
      sale.customer.email || `${sale.customer.phone}@gmail.com`,
      dto.paymentGateway || PaymentGateway.OGARANYA,
      dto.paymentMethod || PaymentMethod.ONLINE,
    );
  }

  private async validateAgentAccess(agentId: string, saleData: CreateSalesDto) {
    // Validate customer access
    const customerAccess = await this.prisma.agentCustomer.findFirst({
      where: { agentId, customerId: saleData.customerId },
    });

    if (!customerAccess) {
      throw new ForbiddenException('You do not have access to this customer');
    }

    // Validate product access
    for (const item of saleData.saleItems) {
      const productAccess = await this.prisma.agentProduct.findFirst({
        where: { agentId, productId: item.productId },
      });

      if (!productAccess) {
        throw new ForbiddenException(
          `You do not have access to product ${item.productId}`,
        );
      }
    }
  }

  private async validateAgentDevices(
    agentId: string,
    saleData: CreateSalesDto,
  ) {
    const deviceSerials = saleData.saleItems.flatMap(
      (item) => item.devices || [],
    );

    if (deviceSerials.length > 0) {
      const hasDeviceAccess =
        await this.deviceAssignmentService.validateDevicesForAgent(
          deviceSerials,
          agentId,
        );

      if (!hasDeviceAccess) {
        throw new ForbiddenException(
          `Some devices are not assigned to agent. Please check your device assignments.`,
        );
      }
    }
  }

  async getAllSales(query: ListSalesQueryDto, agent?: string) {
    const {
      page = 1,
      limit = 100,
      search,
      paymentMethod,
      agentId,
      creatorId,
      customerId,
      startDate,
      endDate,
      formattedSaleId,
    } = query;

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;

    const searchTerm = search?.trim().toLowerCase();

    // Build match conditions for aggregation pipeline
    const matchConditions: any = {};

    if (agentId || agent) {
      matchConditions.creatorId = { $oid: agentId || agent };
    }

    if (creatorId) {
      matchConditions.creatorId = { $oid: creatorId };
    }

    if (customerId) {
      matchConditions.customerId = { $oid: customerId };
    }

    if (paymentMethod) {
      matchConditions.paymentMethod = paymentMethod;
    }

    if (formattedSaleId) {
      matchConditions.formattedSaleId = formattedSaleId;
    }

    const dateRangeConditions = this.buildDateRangeFilter(startDate, endDate);
    if (dateRangeConditions) {
      matchConditions.createdAt = dateRangeConditions;
    }

    // If search is provided, use aggregation for better performance
    if (searchTerm) {
      const { saleItems, total } = await this.performSearchWithAggregation(
        matchConditions,
        searchTerm,
        skip,
        limitNumber,
      );

      return this.formatResponse(saleItems, total, pageNumber, limitNumber);
    }

    // For non-search queries, use optimized simple query
    const { saleItems, total, totalCount } = await this.performSimpleQuery(
      matchConditions,
      skip,
      limitNumber,
    );
    return this.formatSalesResponse(
      saleItems,
      totalCount,
      total,
      pageNumber,
      limitNumber,
    );
  }

  async updateSale(saleId: string, data: UpdateSaleDto) {
    const currentSale = await this.prisma.sales.findUnique({
      where: { id: saleId },
      include: {
        saleItems: {
          include: {
            devices: { select: { id: true, serialNumber: true } },
          },
        },
        customer: { select: { id: true } },
      },
    });

    if (!currentSale) {
      throw new NotFoundException(`Sale ${saleId} not found`);
    }

    // Optimistic locking: version check
    if (data.version !== undefined && currentSale.version !== data.version) {
      throw new ConflictException(
        `Sale was modified. Current version: ${currentSale.version}, ` +
          `provided version: ${data.version}. Please refresh and retry.`,
      );
    }

    // Detect what actually changed (no-op check)
    const changes = this.detectChanges(currentSale, data);

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(
        'No changes detected. Provide different values.',
      );
    }

    // Validate new references exist
    if (data.customerId && data.customerId !== currentSale.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: data.customerId },
      });
      if (!customer) {
        throw new BadRequestException(`Customer ${data.customerId} not found`);
      }
    }

    // Validate device updates
    let deviceChanges = null;
    if (data.deviceSerials && data.deviceSerials.length > 0) {
      deviceChanges = await this.validateAndPrepareDeviceUpdates(
        data.deviceSerials,
      );
    }

    // Atomic transaction: update sale
    const result = await this.prisma.$transaction(async (tx) => {
      // Update sale
      const updatedSale = await tx.sales.update({
        where: { id: saleId },
        data: {
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.customerId && { customerId: data.customerId }),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
        include: {
          saleItems: {
            include: {
              devices: { select: { serialNumber: true } },
            },
          },
        },
      });

      // Update devices on sale items if provided
      if (deviceChanges) {
        for (const deviceChange of deviceChanges) {
          // Disconnect old devices
          await tx.saleItem.update({
            where: { id: deviceChange.saleItemId },
            data: {
              devices: { disconnect: [] },
            },
          });

          // Connect new devices
          if (deviceChange.newDeviceIds.length > 0) {
            await tx.saleItem.update({
              where: { id: deviceChange.saleItemId },
              data: {
                devices: {
                  connect: deviceChange.newDeviceIds.map((id) => ({ id })),
                },
              },
            });
          }
        }
      }

      return { updatedSale };
    });

    return {
      id: result.updatedSale.id,
      version: result.updatedSale.version,
      updatedAt: result.updatedSale.updatedAt,
      changes,
      message: 'Sale updated successfully',
    };
  }

  private async performSearchWithAggregation(
    matchConditions: any,
    searchTerm: string,
    skip: number,
    limit: number,
  ) {
    const searchRegex = { $regex: searchTerm, $options: 'i' };

    const basePipeline = [
      {
        $match: matchConditions,
      },
      {
        $lookup: {
          from: 'sales_items',
          localField: '_id',
          foreignField: 'saleId',
          as: 'saleItems',
        },
      },
      {
        $match: {
          saleItems: { $ne: [] },
        },
      },
      {
        $unwind: {
          path: '$saleItems',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $unwind: {
          path: '$customer',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'devices',
          localField: 'saleItems.deviceIDs',
          foreignField: '_id',
          as: 'devices',
        },
      },
      {
        $lookup: {
          from: 'token',
          localField: 'devices._id',
          foreignField: 'deviceId',
          as: 'deviceTokens',
        },
      },
      {
        $match: {
          $or: [
            { 'customer.firstname': searchRegex },
            { 'customer.lastname': searchRegex },
            { 'customer.phone': searchRegex },
            { 'customer.alternatePhone': searchRegex },
            { 'customer.email': searchRegex },
            { 'saleItems.product': searchRegex },
            { 'devices.serialNumber': searchRegex },
            { formattedSaleId: searchRegex },
          ],
        },
      },
    ];

    const countPipeline = [...basePipeline, { $count: 'total' }];

    const dataPipeline = [
      ...basePipeline,
      {
        $sort: { 'saleItems.createdAt': -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      // Lookup creator user
      {
        $lookup: {
          from: 'users',
          localField: 'creatorId',
          foreignField: '_id',
          as: 'creatorDetails',
        },
      },
      {
        $unwind: {
          path: '$creatorDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup agent
      {
        $lookup: {
          from: 'agents',
          localField: '_id',
          foreignField: 'saleId',
          as: 'agent',
        },
      },
      {
        $unwind: {
          path: '$agent',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup agent's user
      {
        $lookup: {
          from: 'users',
          localField: 'agent.userId',
          foreignField: '_id',
          as: 'agentUser',
        },
      },
      {
        $unwind: {
          path: '$agentUser',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup payments
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'saleId',
          as: 'payment',
        },
      },
      // Lookup sale recipient
      {
        $lookup: {
          from: 'sale_recipients',
          localField: 'saleItems.saleRecipientId',
          foreignField: '_id',
          as: 'SaleRecipient',
        },
      },
      {
        $unwind: {
          path: '$SaleRecipient',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup product
      {
        $lookup: {
          from: 'products',
          localField: 'saleItems.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          id: '$saleItems._id',
          productId: '$saleItems.productId',
          quantity: '$saleItems.quantity',
          saleId: '$saleItems.saleId',
          discount: '$saleItems.discount',
          totalPrice: '$saleItems.totalPrice',
          monthlyPayment: '$saleItems.monthlyPayment',
          paymentMode: '$saleItems.paymentMode',
          installmentDuration: '$saleItems.installmentDuration',
          installmentStartingPrice: '$saleItems.installmentStartingPrice',
          miscellaneousPrices: '$saleItems.miscellaneousPrices',
          saleRecipientId: '$saleItems.saleRecipientId',
          deviceIDs: '$saleItems.deviceIDs',
          createdAt: '$saleItems.createdAt',
          updatedAt: '$saleItems.updatedAt',

          sale: {
            id: '$_id',
            category: '$category',
            applyMargin: '$applyMargin',
            formattedSaleId: '$formattedSaleId',
            status: '$status',
            customerId: '$customerId',
            creatorId: '$creatorId',
            installerName: '$installerName',
            agentName: '$agentName',
            agentId: '$agentId',
            paymentGateway: '$paymentGateway',
            paymentMethod: '$paymentMethod',
            totalPrice: '$totalPrice',
            totalMiscellaneousPrice: '$totalMiscellaneousPrice',
            totalPaid: '$totalPaid',
            totalMonthlyPayment: '$totalMonthlyPayment',
            installmentStartingPrice: '$installmentStartingPrice',
            totalInstallmentDuration: '$totalInstallmentDuration',
            remainingInstallments: '$remainingInstallments',
            installmentAccountDetailsId: '$installmentAccountDetailsId',
            deliveredAccountDetails: '$deliveredAccountDetails',
            contractId: '$contractId',
            transactionDate: '$transactionDate',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt',
            deletedAt: '$deletedAt',
            customer: '$customer',
            creatorDetails: '$creatorDetails',
            agent: {
              _id: '$agent._id',
              userId: '$agent.userId',
              user: '$agentUser',
            },
            payment: '$payment',
          },

          devices: {
            $map: {
              input: '$devices',
              as: 'device',
              in: {
                id: '$$device._id',
                serialNumber: '$$device.serialNumber',
                key: '$$device.key',
                startingCode: '$$device.startingCode',
                count: '$$device.count',
                timeDivider: '$$device.timeDivider',
                restrictedDigitMode: '$$device.restrictedDigitMode',
                hardwareModel: '$$device.hardwareModel',
                firmwareVersion: '$$device.firmwareVersion',
                isTokenable: '$$device.isTokenable',
                isUsed: '$$device.isUsed',
                installationStatus: '$$device.installationStatus',
                installationLocation: '$$device.installationLocation',
                installationLongitude: '$$device.installationLongitude',
                installationLatitude: '$$device.installationLatitude',
                gpsVerified: '$$device.gpsVerified',
                saleItemIDs: '$$device.saleItemIDs',
                creatorId: '$$device.creatorId',
                createdAt: '$$device.createdAt',
                updatedAt: '$$device.updatedAt',
                tokens: {
                  $filter: {
                    input: '$deviceTokens',
                    as: 'token',
                    cond: { $eq: ['$$token.deviceId', '$$device._id'] },
                  },
                },
              },
            },
          },
          SaleRecipient: '$SaleRecipient',
          product: '$product',
        },
      },
    ];

    const [countResult, saleData] = await Promise.all([
      this.prisma.sales.aggregateRaw({
        pipeline: countPipeline,
      }) as any,
      this.prisma.sales.aggregateRaw({
        pipeline: dataPipeline,
      }) as any,
    ]);

    const total = countResult[0]?.total || 0;

    return {
      saleItems: saleData,
      total,
    };
  }

  private async performSimpleQuery(
    matchConditions: any,
    skip: number,
    limit: number,
  ) {
    const where: Prisma.SaleItemWhereInput = {
      sale: {
        ...(matchConditions.creatorId && {
          creatorId: matchConditions.creatorId.$oid,
        }),
        ...(matchConditions.customerId && {
          customerId: matchConditions.customerId.$oid,
        }),
        ...(matchConditions.paymentMethod && {
          paymentMethod: matchConditions.paymentMethod,
        }),
        ...(matchConditions.formattedSaleId && {
          formattedSaleId: matchConditions.formattedSaleId,
        }),
        ...(matchConditions.status && { status: matchConditions.status }),
        ...(matchConditions.createdAt && {
          createdAt: matchConditions.createdAt,
        }),
      },
    };

    const [saleItems, totalCount] = await Promise.all([
      this.prisma.saleItem.findMany({
        where,
        include: {
          sale: {
            include: {
              customer: true,
              creatorDetails: true,
              agent: { include: { user: true } },
              payment: {
                include: {
                  recordedBy: {
                    select: { id: true, firstname: true, lastname: true },
                  },
                },
              },
            },
          },
          devices: {
            include: {
              tokens: true,
            },
          },
          product: true,
        },
        orderBy: { sale: { createdAt: 'desc' } },
        skip,
        take: limit,
      }),
      this.prisma.saleItem.count({ where }),
    ]);

    return {
      saleItems,
      total: totalCount,
      totalCount,
    };
  }

  private formatSalesResponse(
    saleItems: any[],
    totalCount: number,
    total: number,
    pageNumber: number,
    limitNumber: number,
  ) {
    return {
      saleItems: saleItems.map((item) => {
        const sale = item.sale || item;

        return {
          ...item,
          sale: {
            ...sale,
            creatorDetails: sale.creatorDetails
              ? plainToInstance(UserEntity, sale.creatorDetails)
              : undefined,
            agent: sale.agent
              ? {
                  ...sale.agent,
                  user: sale.agent?.user
                    ? plainToInstance(UserEntity, sale.agent.user)
                    : undefined,
                }
              : undefined,
          },
        };
      }),
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async getSale(id: string, agent?: string) {
    const saleItem = await this.prisma.saleItem.findUnique({
      where: {
        id,
        sale: {
          creatorId: agent,
        },
      },
      include: {
        sale: {
          include: {
            customer: true,
            payment: true,
            installmentAccountDetails: true,
            creatorDetails: true,
            agent: {
              include: {
                user: true,
              },
            },
          },
        },
        devices: {
          include: {
            tokens: true,
          },
        },
        product: {
          include: {
            inventories: {
              include: {
                inventory: true,
              },
            },
          },
        },
        SaleRecipient: true,
      },
    });

    if (!saleItem) return new BadRequestException(`saleItem ${id} not found`);

    saleItem.sale.creatorDetails = plainToInstance(
      UserEntity,
      saleItem.sale.creatorDetails,
    );

    if (saleItem.sale.agent?.user) {
      saleItem.sale.agent.user = plainToInstance(
        UserEntity,
        saleItem.sale.agent.user,
      );
    }
    return saleItem;
  }

  async createNextPayment(requestUserId: string, dto: CreateNextPaymentDto) {
    const sale = await this.prisma.sales.findUnique({
      where: { id: dto.saleId },
      include: {
        customer: true,
        saleItems: {
          include: {
            product: true,
            devices: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    // if (sale.paymentMethod !== PaymentMethod.CASH) {
    //   throw new BadRequestException(
    //     'This sale is not configured for cash payments',
    //   );
    // }

    if (sale.status === SalesStatus.COMPLETED) {
      throw new BadRequestException('This sale is already completed');
    }

    if (sale.status === SalesStatus.CANCELLED) {
      throw new BadRequestException('This sale has been cancelled');
    }

    // Check if payment amount is valid
    const remainingAmount =
      sale.totalPrice - (sale.totalPaid - sale.totalMiscellaneousPrice);

    if (dto.amount > Math.ceil(remainingAmount)) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds remaining balance (${Math.ceil(remainingAmount)})`,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: requestUserId,
      },
      select: {
        agentDetails: true,
      },
    });

    const transactionRef =
      await this.referenceGenerator.generatePaymentReference();

    if (user.agentDetails) {
      const agentId = user.agentDetails.id;
      const walletBalance = await this.walletService.getWalletBalance(agentId);

      if (walletBalance < dto.amount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Required: ₦${requestUserId}, Available: ₦${walletBalance}`,
        );
      }

      const saleRef = await this.referenceGenerator.generateSaleReference(
        sale.id,
      );

      await this.walletService.debitWallet(
        agentId,
        dto.amount,
        saleRef,
        `Payment for sale ${sale.id}`,
        sale.id,
      );
    }

    return await this.prisma.payment.create({
      data: {
        saleId: dto.saleId,
        amount: dto.amount,
        paymentMethod: user.agentDetails
          ? PaymentMethod.WALLET
          : PaymentMethod.CASH,
        transactionRef,
        paymentStatus: PaymentStatus.COMPLETED,
        recordedById: requestUserId,
        notes: dto.notes,
        paymentDate: new Date(),
      },
    });

    // const transactionRef = `cash-${sale.id}-${Date.now()}`;

    // await this.paymentService.handlePostPayment(payment);

    // return {
    //   payment,
    //   message: 'Next payment recorded successfully',
    // };
  }

  async getSalesPaymentDetails(saleId: string) {
    const sale = await this.prisma.sales.findFirst({
      where: {
        id: saleId,
      },
      include: {
        customer: true,
        saleItems: {
          include: {
            devices: true,
          },
        },
      },
    });

    return await this.paymentService.generatePaymentPayload(
      sale.id,
      sale.installmentStartingPrice || sale.totalPrice,
      sale.customer.email || `${sale.customer.phone}@gmail.com`,
      sale.paymentGateway || PaymentGateway.OGARANYA,
      sale.paymentMethod || PaymentMethod.ONLINE,
    );
  }

  async fixSalesWithOvercalculatedTotal() {
    const AMOUNT_THRESHOLD = 200000;
    const sales = await this.prisma.sales.findMany({
      where: {
        totalPrice: {
          gte: AMOUNT_THRESHOLD,
        },
      },
      include: {
        saleItems: true,
        batchAllocations: true,
      },
      // select: {
      //   batchAllocations: true
      // }
    });

    const financialSettings = await this.prisma.financialSettings.findFirst();

    for (const sale of sales) {
      let accurateSalePrice = 0;
      const applyMargin = sale.applyMargin;
      const totalBasePrice = (sale.batchAllocations || []).reduce(
        (sum: number, batchAllocation: BatchAlocation) =>
          sum + batchAllocation.price * batchAllocation.quantity,
        0,
      );

      for (const saleItem of sale.saleItems) {
        const discountAmount = saleItem.discount
          ? (totalBasePrice * Number(saleItem.discount)) / 100
          : 0;

        const priceAfterDiscount = totalBasePrice - discountAmount;

        let totalPrice = priceAfterDiscount;

        const principal = totalPrice;
        const monthlyInterestRate = applyMargin
          ? financialSettings.monthlyInterest
          : 0;
        const numberOfMonths = saleItem.installmentDuration;
        const loanMargin = applyMargin ? financialSettings.loanMargin : 0;

        const totalInterest = principal * monthlyInterestRate * numberOfMonths;
        const totalWithMargin = (principal + totalInterest) * (1 + loanMargin);

        totalPrice = totalWithMargin;
        accurateSalePrice += totalPrice;

        await this.prisma.saleItem.update({
          where: { id: saleItem.id },
          data: {
            totalPrice,
          },
        });
      }

      await this.prisma.sales.update({
        where: { id: sale.id },
        data: {
          totalPrice: accurateSalePrice,
        },
      });
    }

    // console.log({ sales: sales.length });

    return sales;
  }

  async getMargins() {
    return await this.prisma.financialSettings.findFirst();
  }

  async createFinMargin(body: CreateFinancialMarginDto) {
    await this.prisma.financialSettings.create({
      data: body,
    });
  }

  private async calculateItemPrice(
    saleItem: SaleItemDto,
    financialSettings: any,
    applyMargin: boolean,
  ): Promise<ProcessedSaleItem> {
    const product = await this.prisma.product.findUnique({
      where: { id: saleItem.productId, hideProduct: false },
      include: {
        inventories: {
          include: {
            inventory: {
              include: {
                batches: {
                  where: { remainingQuantity: { gt: 0 } },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product not found`);
    }

    const { batchAllocations, totalBasePrice } = await this.processBatches(
      product,
      saleItem.quantity,
      applyMargin,
    );

    // Add miscellaneous prices
    const miscTotal = saleItem.miscellaneousPrices
      ? Object.values(saleItem.miscellaneousPrices).reduce(
          (sum: number, value: number) => sum + Number(value),
          0,
        )
      : 0;

    // Apply discount if any
    const discountAmount = saleItem.discount
      ? (totalBasePrice * Number(saleItem.discount)) / 100
      : 0;

    const priceAfterDiscount = totalBasePrice - discountAmount;

    // const totalPrice = priceAfterDiscount + miscTotal;
    const totalPrice = priceAfterDiscount;

    const processedItem: ProcessedSaleItem = {
      ...saleItem,
      totalPrice,
      batchAllocation: batchAllocations,
      miscTotal,
    };

    if (saleItem.paymentMode === PaymentMode.ONE_OFF) {
      if (applyMargin)
        processedItem.totalPrice *= 1 + financialSettings.outrightMargin;
    } else {
      if (!saleItem.installmentDuration || !saleItem.installmentStartingPrice) {
        throw new BadRequestException(
          'Installment duration and starting price are required for installment payments',
        );
      }

      const principal = totalPrice;
      const monthlyInterestRate = applyMargin
        ? financialSettings.monthlyInterest
        : 0;
      const numberOfMonths = saleItem.installmentDuration;
      const loanMargin = applyMargin ? financialSettings.loanMargin : 0;

      const totalInterest = principal * monthlyInterestRate * numberOfMonths;
      const totalWithMargin = (principal + totalInterest) * (1 + loanMargin);

      // if (totalWithMargin < saleItem.installmentStartingPrice) {
      //   throw new BadRequestException(
      //     `Starting price (${saleItem.installmentStartingPrice}) too large for installment payments`,
      //   );
      // }

      // const installmentTotalPrice = saleItem.installmentStartingPrice
      //   ? (totalWithMargin * Number(saleItem.installmentStartingPrice)) / 100
      //   : 0;
      const installmentTotalPrice = saleItem.installmentStartingPrice;

      processedItem.totalPrice = totalWithMargin;
      processedItem.duration = numberOfMonths;
      // processedItem.installmentTotalPrice = installmentTotalPrice;
      processedItem.installmentTotalPrice = installmentTotalPrice + miscTotal;
      // processedItem.monthlyPayment =
      //   (totalWithMargin - installmentTotalPrice) / (numberOfMonths - 1);
      processedItem.monthlyPayment = saleItem.monthlyPayment;
    }

    return processedItem;
  }

  async processBatches(
    product: any,
    requiredQuantity: number,
    applyMargin: boolean,
  ): Promise<{ batchAllocations: BatchAllocation[]; totalBasePrice: number }> {
    const batchAllocations: BatchAllocation[] = [];

    let totalBasePrice = 0;

    for (const productInventory of product.inventories) {
      const quantityPerProduct = productInventory.quantity;
      let remainingQuantity = requiredQuantity * quantityPerProduct;

      for (const batch of productInventory.inventory.batches) {
        if (remainingQuantity <= 0) break;

        const quantityFromBatch = Math.min(
          batch.remainingQuantity,
          remainingQuantity,
        );

        const batchPrice = applyMargin ? batch.costOfItem || 0 : batch.price;

        if (quantityFromBatch > 0) {
          batchAllocations.push({
            batchId: batch.id,
            quantity: quantityFromBatch,
            price: batchPrice,
          });

          totalBasePrice += batchPrice * quantityFromBatch;

          remainingQuantity -= quantityFromBatch;
        }
      }

      if (remainingQuantity > 0) {
        throw new BadRequestException(
          `Insufficient inventory for product ${product.id}`,
        );
      }
    }

    return { batchAllocations, totalBasePrice };
  }

  async validateCustomerForAgentSale(
    customerId: string,
    creatingAgentId: string,
  ): Promise<{ valid: boolean; message?: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        approvalStatus: true,
        isApproved: true,
        creatorId: true,
        creatorDetails: {
          select: {
            id: true,
            agentDetails: {
              select: {
                id: true,
                user: { select: { firstname: true, lastname: true } },
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    // Check if customer was created by the current agent
    const customerCreatorIsCurrentAgent =
      customer.creatorId &&
      customer.creatorDetails?.agentDetails?.id === creatingAgentId;

    if (!customerCreatorIsCurrentAgent) {
      // Customer created by someone else (other agent, admin) - should be assigned to current agent
      const agentCustomer = await this.prisma.agentCustomer.findFirst({
        where: {
          customerId,
          agentId: creatingAgentId,
        },
      });

      if (!agentCustomer) {
        throw new BadRequestException(
          `Customer "${customer.firstname} ${customer.lastname}" not assigned to agent.`,
        );
      }
    }

    // Customer WAS created by current agent - MUST be approved
    if (!customer.isApproved) {
      throw new BadRequestException(
        `Customer "${customer.firstname} ${customer.lastname}" (ID: ${customerId}) ` +
          `was created by you but is not yet approved. ` +
          `Approval status: ${customer.approvalStatus}. ` +
          `Please wait for admin approval before creating sales.`,
      );
    }

    // Customer is approved
    return {
      valid: true,
      message: `Customer approved by creator agent`,
    };
  }

  private async validateSalesRelations(dto: CreateSalesDto) {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: dto.customerId,
      },
    });

    if (!customer) {
      throw new NotFoundException(
        `Customer wth ID: ${dto.customerId} not found`,
      );
    }

    let invalidDeviceId: string;

    for (const saleItem of dto.saleItems) {
      if (invalidDeviceId) break;

      for (const id of saleItem.devices) {
        const deviceExists = await this.prisma.device.findUnique({
          where: { id },
        });

        if (!deviceExists) invalidDeviceId = id;
      }
    }

    if (invalidDeviceId)
      throw new BadRequestException(
        `Device wth ID: ${invalidDeviceId} not found`,
      );
  }

  async validateSaleProductQuantity(
    saleProducts: ValidateSaleProductItemDto[],
  ) {
    const inventoryAllocationMap = new Map<string, number>();

    // Ensure product IDs are unique
    const productIds = saleProducts.map((p) => p.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(`Duplicate product IDs are not allowed.`);
    }

    // Fetch products with inventories and batches
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, hideProduct: false },
      include: {
        inventories: {
          include: {
            inventory: {
              include: {
                batches: {
                  where: { remainingQuantity: { gt: 0 } },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    // Validate product existence
    const validProductIds = new Set(products.map((p) => p.id));
    const invalidProductIds = productIds.filter(
      (id) => !validProductIds.has(id),
    );
    if (invalidProductIds.length) {
      throw new BadRequestException(
        `Invalid Product IDs: ${invalidProductIds.join(', ')}`,
      );
    }

    // Process product validation
    const { validationResults, insufficientProducts } = this.processProducts(
      saleProducts,
      products,
      inventoryAllocationMap,
    );

    // If any product has insufficient inventory, throw an error
    if (insufficientProducts.length) {
      throw new BadRequestException({
        message: 'Insufficient inventory for products',
        defaultingProduct: insufficientProducts,
        validationDetails: validationResults,
      });
    }

    return {
      message: 'All products have sufficient inventory',
      success: true,
      validationDetails: validationResults,
    };
  }

  private async validateDeviceAvailability(saleItems: SaleItemDto[]) {
    const allDeviceIds = saleItems.flatMap((item) => item.devices);

    if (allDeviceIds.length === 0) return;

    const usedDevices = await this.prisma.device.findMany({
      where: {
        id: { in: allDeviceIds },
        saleItems: {
          some: {
            sale: {
              NOT: {
                status: SalesStatus.CANCELLED,
              },
            },
          },
        },
      },
      select: {
        id: true,
        serialNumber: true,
      },
    });

    if (usedDevices.length > 0) {
      throw new BadRequestException(
        `The following devices have already been used in previous sales: ${usedDevices.map((d) => d.serialNumber).join(', ')}`,
      );
    }
  }

  private processProducts(
    saleProducts: ValidateSaleProductItemDto[],
    products: any[],
    inventoryAllocationMap: Map<string, number>,
  ) {
    const validationResults = [];
    const insufficientProducts = [];

    for (const { productId, quantity } of saleProducts) {
      const product = products.find((p) => p.id === productId);
      let maxPossibleUnits = Infinity;

      const inventoryBreakdown = product.inventories.map((productInventory) => {
        const { inventory, quantity: perProductInventoryQuantity } =
          productInventory;
        const requiredQuantityForInventory =
          perProductInventoryQuantity * quantity;

        let availableInventoryQuantity = inventory.batches.reduce(
          (sum, batch) => sum + batch.remainingQuantity,
          0,
        );

        availableInventoryQuantity -=
          inventoryAllocationMap.get(inventory.id) || 0;

        maxPossibleUnits = Math.min(
          maxPossibleUnits,
          Math.floor(availableInventoryQuantity / perProductInventoryQuantity),
        );

        return {
          inventoryId: inventory.id,
          availableInventoryQuantity,
          requiredQuantityForInventory,
        };
      });

      validationResults.push({
        productId,
        requiredQuantity: quantity,
        inventoryBreakdown,
      });

      if (maxPossibleUnits < quantity) {
        insufficientProducts.push({ productId });
      } else {
        this.allocateInventory(
          inventoryBreakdown,
          quantity,
          inventoryAllocationMap,
        );
      }
    }

    return { validationResults, insufficientProducts };
  }

  private allocateInventory(
    inventoryBreakdown: any[],
    quantity: number,
    inventoryAllocationMap: Map<string, number>,
  ) {
    let remainingToAllocate = quantity;

    for (const inventory of inventoryBreakdown) {
      if (remainingToAllocate <= 0) break;

      const quantityToAllocate = Math.min(
        remainingToAllocate,
        Math.floor(
          inventory.availableInventoryQuantity /
            inventory.requiredQuantityForInventory,
        ),
      );

      const currentAllocation =
        inventoryAllocationMap.get(inventory.inventoryId) || 0;
      inventoryAllocationMap.set(
        inventory.inventoryId,
        currentAllocation +
          quantityToAllocate * inventory.requiredQuantityForInventory,
      );

      remainingToAllocate -= quantityToAllocate;
    }
  }

  private cleanValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle MongoDB $oid format
    if (typeof value === 'object' && '$oid' in value) {
      return value.$oid;
    }

    // Handle MongoDB $date format
    if (typeof value === 'object' && '$date' in value) {
      return value.$date;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.cleanValue(item));
    }

    // Handle nested objects
    if (typeof value === 'object' && value !== null) {
      const cleaned: any = {};
      for (const [key, val] of Object.entries(value)) {
        // Skip _id if we have id
        if (key === '_id' && 'id' in value) {
          continue;
        }
        cleaned[key] = this.cleanValue(val);
      }
      return cleaned;
    }

    return value;
  }

  private transformSaleItem(item: any) {
    const cleaned = this.cleanValue(item);

    const sale = cleaned.sale || cleaned;

    return {
      id: cleaned.id || cleaned._id,
      productId: cleaned.productId,
      quantity: cleaned.quantity,
      saleId: cleaned.saleId,
      discount: cleaned.discount,
      totalPrice: cleaned.totalPrice,
      monthlyPayment: cleaned.monthlyPayment,
      paymentMode: cleaned.paymentMode,
      installmentDuration: cleaned.installmentDuration,
      installmentStartingPrice: cleaned.installmentStartingPrice,
      miscellaneousPrices: cleaned.miscellaneousPrices,
      saleRecipientId: cleaned.saleRecipientId,
      deviceIDs: cleaned.deviceIDs,
      createdAt: cleaned.createdAt,
      updatedAt: cleaned.updatedAt,

      sale: {
        id: sale.id || sale._id,
        category: sale.category,
        status: sale.status,
        paymentMethod: sale.paymentMethod,
        paymentGateway: sale.paymentGateway,
        formattedSaleId: sale.formattedSaleId,
        createdAt: sale.createdAt,
        updatedAt: sale.updatedAt,

        customerId: sale.customerId,
        creatorId: sale.creatorId,
        agentId: sale.agentId,
        agentName: sale.agentName,
        installerName: sale.installerName,
        contractId: sale.contractId,

        totalPrice: sale.totalPrice,
        totalMiscellaneousPrice: sale.totalMiscellaneousPrice,
        totalPaid: sale.totalPaid,
        totalMonthlyPayment: sale.totalMonthlyPayment,
        remainingInstallments: sale.remainingInstallments,
        totalInstallmentDuration: sale.totalInstallmentDuration,
        installmentStartingPrice: sale.installmentStartingPrice,
        applyMargin: sale.applyMargin,
        deliveredAccountDetails: sale.deliveredAccountDetails,

        installmentAccountDetailsId: sale.installmentAccountDetailsId,
        transactionDate: sale.transactionDate,
        deletedAt: sale.deletedAt,

        customer: sale.customer
          ? {
              id: sale.customer.id || sale.customer._id,
              firstname: sale.customer.firstname,
              lastname: sale.customer.lastname,
              phone: sale.customer.phone,
              alternatePhone: sale.customer.alternatePhone,
              email: sale.customer.email,
              gender: sale.customer.gender,
              passportPhotoUrl: sale.customer.passportPhotoUrl,
              idType: sale.customer.idType,
              idNumber: sale.customer.idNumber,
              idImageUrl: sale.customer.idImageUrl,
              contractFormImageUrl: sale.customer.contractFormImageUrl,
              addressType: sale.customer.addressType,
              installationAddress: sale.customer.installationAddress,
              lga: sale.customer.lga,
              state: sale.customer.state,
              location: sale.customer.location,
              longitude: sale.customer.longitude,
              latitude: sale.customer.latitude,
              approvalStatus: sale.customer.approvalStatus,
              isApproved: sale.customer.isApproved,
              approvedAt: sale.customer.approvedAt,
              approvedBy: sale.customer.approvedBy,
              rejectedAt: sale.customer.rejectedAt,
              rejectedBy: sale.customer.rejectedBy,
              rejectionReason: sale.customer.rejectionReason,
              resubmissionCount: sale.customer.resubmissionCount,
              lastResubmittedAt: sale.customer.lastResubmittedAt,
              requiresReview: sale.customer.requiresReview,
              status: sale.customer.status,
              type: sale.customer.type,
              creatorId: sale.customer.creatorId,
              createdAt: sale.customer.createdAt,
              updatedAt: sale.customer.updatedAt,
              deletedAt: sale.customer.deletedAt,
            }
          : null,

        creatorDetails: sale.creatorDetails
          ? plainToInstance(UserEntity, {
              id: sale.creatorDetails.id || sale.creatorDetails._id,
              firstname: sale.creatorDetails.firstname,
              lastname: sale.creatorDetails.lastname,
              email: sale.creatorDetails.email,
              username: sale.creatorDetails.username,
              phone: sale.creatorDetails.phone,
              location: sale.creatorDetails.location,
              addressType: sale.creatorDetails.addressType,
              staffId: sale.creatorDetails.staffId,
              longitude: sale.creatorDetails.longitude,
              latitude: sale.creatorDetails.latitude,
              emailVerified: sale.creatorDetails.emailVerified,
              isBlocked: sale.creatorDetails.isBlocked,
              status: sale.creatorDetails.status,
              roleId: sale.creatorDetails.roleId,
              createdAt: sale.creatorDetails.createdAt,
              updatedAt: sale.creatorDetails.updatedAt,
              deletedAt: sale.creatorDetails.deletedAt,
              lastLogin: sale.creatorDetails.lastLogin,
            })
          : null,

        agent:
          sale.agent && Object.keys(sale.agent).length > 0
            ? {
                id: sale.agent.id || sale.agent._id,
                user: sale.agent.user
                  ? plainToInstance(UserEntity, {
                      id: sale.agent.user.id || sale.agent.user._id,
                      firstname: sale.agent.user.firstname,
                      lastname: sale.agent.user.lastname,
                      email: sale.agent.user.email,
                      phone: sale.agent.user.phone,
                    })
                  : null,
              }
            : null,

        payment: Array.isArray(sale.payment)
          ? sale.payment.map((payment: any) => ({
              id: payment.id || payment._id,
              transactionRef: payment.transactionRef,
              amount: payment.amount,
              paymentStatus: payment.paymentStatus,
              paymentMethod: payment.paymentMethod,
              paymentDate: payment.paymentDate,
              ogaranyaOrderId: payment.ogaranyaOrderId,
              ogaranyaOrderRef: payment.ogaranyaOrderRef,
              ogaranyaSmsNumber: payment.ogaranyaSmsNumber,
              ogaranyaSmsMessage: payment.ogaranyaSmsMessage,
              flutterwaveTransactionId: payment.flutterwaveTransactionId,
              flutterwavePaymentId: payment.flutterwavePaymentId,
              flutterwavePaymentLink: payment.flutterwavePaymentLink,
              recordedById: payment.recordedById,
              notes: payment.notes,
              saleId: payment.saleId,
              recordedBy: payment.recordedBy,
              createdAt: payment.createdAt,
              updatedAt: payment.updatedAt,
              deletedAt: payment.deletedAt,
            }))
          : sale.payment
            ? [
                {
                  id: sale.payment.id || sale.payment._id,
                  transactionRef: sale.payment.transactionRef,
                  amount: sale.payment.amount,
                  paymentStatus: sale.payment.paymentStatus,
                  paymentMethod: sale.payment.paymentMethod,
                  paymentDate: sale.payment.paymentDate,
                  ogaranyaOrderId: sale.payment.ogaranyaOrderId,
                  ogaranyaOrderRef: sale.payment.ogaranyaOrderRef,
                  ogaranyaSmsNumber: sale.payment.ogaranyaSmsNumber,
                  ogaranyaSmsMessage: sale.payment.ogaranyaSmsMessage,
                  flutterwaveTransactionId:
                    sale.payment.flutterwaveTransactionId,
                  flutterwavePaymentId: sale.payment.flutterwavePaymentId,
                  flutterwavePaymentLink: sale.payment.flutterwavePaymentLink,
                  recordedById: sale.payment.recordedById,
                  notes: sale.payment.notes,
                  saleId: sale.payment.saleId,
                  recordedBy: sale.payment.recordedBy,
                  createdAt: sale.payment.createdAt,
                  updatedAt: sale.payment.updatedAt,
                  deletedAt: sale.payment.deletedAt,
                },
              ]
            : [],
      },

      devices: Array.isArray(cleaned.devices)
        ? cleaned.devices.map((device: any) => ({
            id: device.id || device._id,
            serialNumber: device.serialNumber,
            key: device.key,
            startingCode: device.startingCode,
            count: device.count,
            timeDivider: device.timeDivider,
            restrictedDigitMode: device.restrictedDigitMode,
            hardwareModel: device.hardwareModel,
            firmwareVersion: device.firmwareVersion,
            isTokenable: device.isTokenable,
            isUsed: device.isUsed,
            installationStatus: device.installationStatus,
            installationLocation: device.installationLocation,
            installationLongitude: device.installationLongitude,
            installationLatitude: device.installationLatitude,
            gpsVerified: device.gpsVerified,
            saleItemIDs: device.saleItemIDs,
            creatorId: device.creatorId,
            createdAt: device.createdAt,
            updatedAt: device.updatedAt,
            tokens: Array.isArray(device.tokens)
              ? device.tokens.map((token: any) => ({
                  id: token.id || token._id,
                  token: token.token,
                  duration: token.duration,
                  tokenReleased: token.tokenReleased,
                  createdAt: token.createdAt,
                  deviceId: token.deviceId,
                  creatorId: token.creatorId,
                }))
              : [],
          }))
        : [],

      SaleRecipient: cleaned.SaleRecipient
        ? {
            id: cleaned.SaleRecipient.id,
            firstname: cleaned.SaleRecipient.firstname,
            lastname: cleaned.SaleRecipient.lastname,
            address: cleaned.SaleRecipient.address,
            phone: cleaned.SaleRecipient.phone,
            email: cleaned.SaleRecipient.email,
            createdAt: cleaned.SaleRecipient.createdAt,
            updatedAt: cleaned.SaleRecipient.updatedAt,
          }
        : null,

      product: cleaned.product
        ? {
            id: cleaned.product.id,
            name: cleaned.product.name,
            description: cleaned.product.description,
            image: cleaned.product.image,
            currency: cleaned.product.currency,
            paymentModes: cleaned.product.paymentModes,
            creatorId: cleaned.product.creatorId,
            categoryId: cleaned.product.categoryId,
            createdAt: cleaned.product.createdAt,
            updatedAt: cleaned.product.updatedAt,
          }
        : null,
    };
  }

  private transformSaleItems(items: any[]) {
    return items.map((item) => this.transformSaleItem(item));
  }

  private buildDateRangeFilter(fromDate?: string, toDate?: string): any {
    if (!fromDate && !toDate) {
      return null;
    }

    const dateRange: any = {};

    if (fromDate) {
      const from = new Date(fromDate);
      if (isNaN(from.getTime())) {
        throw new BadRequestException(
          `Invalid fromDate format. Expected ISO 8601 format (YYYY-MM-DD or ISO string)`,
        );
      }
      // Start of the day
      from.setHours(0, 0, 0, 0);
      dateRange.gte = from;
    }

    if (toDate) {
      const to = new Date(toDate);
      if (isNaN(to.getTime())) {
        throw new BadRequestException(
          `Invalid toDate format. Expected ISO 8601 format (YYYY-MM-DD or ISO string)`,
        );
      }
      // End of the day
      to.setHours(23, 59, 59, 999);
      dateRange.lte = to;
    }

    // Validate that fromDate is not after toDate
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      if (from > to) {
        throw new BadRequestException(
          'fromDate must be before or equal to toDate',
        );
      }
    }

    return Object.keys(dateRange).length > 0 ? dateRange : null;
  }

  /**
   * Detect what fields actually changed
   */
  private detectChanges(
    currentSale: any,
    updateData: UpdateSaleDto,
  ): Record<string, { old: any; new: any }> {
    const changes = {};

    // if (
    //   updateData.notes !== undefined &&
    //   updateData.notes !== currentSale.notes
    // ) {
    //   changes['notes'] = {
    //     old: currentSale.notes,
    //     new: updateData.notes,
    //   };
    // }

    if (
      updateData.customerId &&
      updateData.customerId !== currentSale.customerId
    ) {
      changes['customerId'] = {
        old: currentSale.customerId,
        new: updateData.customerId,
      };
    }

    if (updateData.deviceSerials) {
      changes['devices'] = {
        old: 'Multiple devices',
        new: 'Multiple devices ',
      };
    }

    return changes;
  }

  /**
   * Validate device updates and prepare for transaction
   */
  private async validateAndPrepareDeviceUpdates(deviceSerials: string[]) {
    const changes = [];

    if (!deviceSerials.length) {
      changes.push({
        newDeviceIds: [],
        newSerials: [],
      });

      return;
    }

    const devices = await this.prisma.device.findMany({
      where: { serialNumber: { in: deviceSerials }, isUsed: false },
      select: { id: true, serialNumber: true },
    });

    if (devices.length !== deviceSerials.length) {
      const found = new Set(devices.map((d) => d.serialNumber));
      const notFound = deviceSerials.filter((s) => !found.has(s));
      throw new BadRequestException(
        `Devices not found: ${notFound.join(', ')}`,
      );
    }

    changes.push({
      newDeviceIds: devices.map((d) => d.id),
      newSerials: devices.map((d) => d.serialNumber),
    });

    return changes;
  }

  async completeSalePayment(saleId: string) {
    const PAYMENT_AMOUNT = 2000;

    // STEP 1: Validate sale exists (OUTSIDE transaction)
    const sale = await this.prisma.sales.findUnique({
      where: { id: saleId },
      include: {
        creatorDetails: {
          select: { agentDetails: { select: { id: true } } },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException(`Sale ${saleId} not found`);
    }

    // STEP 2: Validate agent exists (OUTSIDE transaction)
    if (!sale.creatorDetails?.agentDetails) {
      throw new BadRequestException(
        `Sale creator is not an agent. Cannot debit wallet.`,
      );
    }

    const agentId = sale.creatorDetails.agentDetails.id;

    // STEP 3: Validate and fetch wallet (OUTSIDE transaction)
    const wallet = await this.prisma.wallet.findFirst({
      where: { agentId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet for agent ${agentId} not found`);
    }

    if (wallet.balance < PAYMENT_AMOUNT) {
      throw new BadRequestException(
        `Insufficient wallet balance. Required: ₦${PAYMENT_AMOUNT}, Available: ₦${wallet.balance}`,
      );
    }

    // STEP 4: Generate references (OUTSIDE transaction)
    const walletTransactionRef =
      await this.referenceGenerator.generatePaymentReference();
    const paymentTransactionRef =
      await this.referenceGenerator.generatePaymentReference();

    // STEP 5: Execute atomic transaction
    // All operations succeed or fail together
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Update sale - increment totalPaid
        const updatedSale = await tx.sales.update({
          where: { id: saleId },
          data: {
            totalPaid: {
              increment: PAYMENT_AMOUNT,
            },
          },
          select: {
            id: true,
            formattedSaleId: true,
            totalPrice: true,
            totalPaid: true,
          },
        });

        // Create wallet transaction record (audit trail)
        const walletTx = await tx.walletTransaction.create({
          data: {
            agentId,
            walletId: wallet.id,
            amount: PAYMENT_AMOUNT,
            type: 'DEBIT',
            reference: walletTransactionRef,
            description: `Payment completion for sale ${updatedSale.formattedSaleId}`,
            previousBalance: wallet.balance,
            newBalance: wallet.balance - PAYMENT_AMOUNT,
            status: "COMPLETED"
          },
          select: {
            id: true,
            reference: true,
            createdAt: true,
          },
        });

        // Debit wallet balance
        const updatedWallet = await tx.wallet.update({
          where: { agentId },
          data: {
            balance: {
              decrement: PAYMENT_AMOUNT,
            },
            updatedAt: new Date(),
          },
          select: {
            balance: true,
          },
        });

        // Create payment record
        // Or modify to update existing payment record if preferred
        const payment = await tx.payment.create({
          data: {
            saleId: saleId,
            amount: PAYMENT_AMOUNT,
            paymentMethod: PaymentMethod.WALLET,
            paymentStatus: PaymentStatus.COMPLETED,
            transactionRef: paymentTransactionRef,
            notes: `Payment completion for sale ${updatedSale.formattedSaleId}`,
            paymentDate: new Date(),
          },
          select: {
            id: true,
            transactionRef: true,
            amount: true,
            paymentStatus: true,
            createdAt: true,
          },
        });

        // Check if sale is now fully paid
        const isFullyPaid = updatedSale.totalPaid >= updatedSale.totalPrice;

        // Update sale status if fully paid
        if (isFullyPaid) {
          await tx.sales.update({
            where: { id: saleId },
            data: {
              status: 'COMPLETED',
            },
          });
        }

        return {
          sale: updatedSale,
          wallet: updatedWallet,
          walletTransaction: walletTx,
          payment,
          isFullyPaid,
        };
      },
      {
        timeout: 10000, // 10 second timeout
        maxWait: 20000,
      },
    );

    // STEP 6: Return success response
    return {
      success: true,
      message: `Payment completed successfully for sale ${result.sale.formattedSaleId}`,
      payment: {
        id: result.payment.id,
        transactionRef: result.payment.transactionRef,
        amount: result.payment.amount,
        paymentStatus: result.payment.paymentStatus,
        paymentDate: result.payment.createdAt,
      },
      sale: {
        id: result.sale.id,
        formattedSaleId: result.sale.formattedSaleId,
        totalPrice: result.sale.totalPrice,
        totalPaid: result.sale.totalPaid,
        remainingAmount: result.sale.totalPrice - result.sale.totalPaid,
        isFullyPaid: result.isFullyPaid,
      },
      wallet: {
        agentId,
        previousBalance: wallet.balance,
        newBalance: result.wallet.balance,
        debitedAmount: PAYMENT_AMOUNT,
      },
      audit: {
        walletTransactionRef: result.walletTransaction.reference,
        paymentTransactionRef: result.payment.transactionRef,
      },
    };
  }

  async restoreSaleOverpayment(saleId: string, amount: number) {
    // STEP 1: Validate sale exists (OUTSIDE transaction)
    const sale = await this.prisma.sales.findUnique({
      where: { id: saleId },
      include: {
        creatorDetails: {
          select: { agentDetails: { select: { id: true } } },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException(`Sale ${saleId} not found`);
    }

    // STEP 2: Validate agent exists (OUTSIDE transaction)
    if (!sale.creatorDetails?.agentDetails) {
      throw new BadRequestException(
        `Sale creator is not an agent. Cannot debit wallet.`,
      );
    }

    const agentId = sale.creatorDetails.agentDetails.id;

    // STEP 3: Validate and fetch wallet (OUTSIDE transaction)
    const wallet = await this.prisma.wallet.findFirst({
      where: { agentId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet for agent ${agentId} not found`);
    }

    // STEP 4: Generate references (OUTSIDE transaction)
    const walletTransactionRef =
      await this.referenceGenerator.generatePaymentReference();

    // STEP 5: Execute atomic transaction
    // All operations succeed or fail together
    const result = await this.prisma.$transaction(
      async (tx) => {
        const updatedSale = await tx.sales.update({
          where: { id: saleId },
          data: {
            totalPaid: {
              decrement: amount,
            },
            installmentStartingPrice: {
              decrement: amount,
            },
          },
          select: {
            id: true,
            formattedSaleId: true,
            totalPrice: true,
            totalPaid: true,
            payment: true,
          },
        });

        const walletTx = await tx.walletTransaction.create({
          data: {
            agentId,
            walletId: wallet.id,
            amount: amount,
            type: 'CREDIT',
            reference: walletTransactionRef,
            description: `Overpayment restoration for sale ${updatedSale.formattedSaleId}`,
            previousBalance: wallet.balance,
            newBalance: wallet.balance + amount,
            status: 'COMPLETED',
          },
          select: {
            id: true,
            reference: true,
            createdAt: true,
          },
        });

        // Debit wallet balance
        const updatedWallet = await tx.wallet.update({
          where: { agentId },
          data: {
            balance: {
              increment: amount,
            },
            updatedAt: new Date(),
          },
          select: {
            balance: true,
          },
        });

        const salePayment = updatedSale.payment[0];

        await tx.payment.update({
          where: {
            id: salePayment.id
          },
          data: {
            amount: salePayment.amount - amount,
          },
        
        });
       
        return {
          sale: updatedSale,
          wallet: updatedWallet,
          walletTransaction: walletTx,
          // payment,
        };
      },
      {
        timeout: 10000, // 10 second timeout
        maxWait: 20000,
      },
    );

    // STEP 6: Return success response
    return {
      success: true,
      message: `Payment completed successfully for sale ${result.sale.formattedSaleId}`,
     
    };
  }

  formatResponse(saleItems: any[], total: number, page: number, limit: number) {
    const cleanedItems = this.transformSaleItems(saleItems);

    return {
      saleItems: cleanedItems,
      total,
      page,
      limit,
      totalPages: limit === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}
