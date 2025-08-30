import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalesDto, SaleItemDto } from './dto/create-sales.dto';
import {
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

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contractService: ContractService,
    private readonly paymentService: PaymentService,
    private readonly walletService: WalletService,
    private readonly referenceGenerator: ReferenceGeneratorService,
    @InjectQueue('payment-queue') private paymentQueue: Queue,
  ) {}

  async createSale(creatorId: string, dto: CreateSalesDto, agentId?: string) {
    if (agentId) await this.validateAgentAccess(agentId, dto);

    // Validate sales relations
    await this.validateSalesRelations(dto);

    // Validate inventory availability
    await this.validateSaleProductQuantity(dto.saleItems);

    const financialSettings = await this.prisma.financialSettings.findFirst();

    if (!financialSettings) {
      throw new BadRequestException('Financial settings not configured');
    }

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
          totalInstallmentDuration,
          remainingInstallments: totalInstallmentDuration - 1,
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

  async getAllSales(query: ListSalesQueryDto, agent?: string) {
    const { page = 1, limit = 100 } = query;
    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const whereClause: Prisma.SaleItemWhereInput = {};

    if (query.paymentMethod) {
      whereClause.sale = {
        paymentMethod: query.paymentMethod,
      };
    }

    if (query.agentId) {
      whereClause.sale = {
        creatorId: query.agentId,
      };
    }

    if (agent) {
      whereClause.sale = {
        creatorId: agent,
      };
    }

    const [totalCount, saleItems] = await Promise.all([
      this.prisma.saleItem.count({
        where: whereClause,
      }),
      this.prisma.saleItem.findMany({
        where: whereClause,
        include: {
          sale: {
            include: {
              customer: true,
              creatorDetails: true,
              agent: {
                include: {
                  user: true,
                },
              },
              payment: {
                include: {
                  recordedBy: {
                    select: {
                      id: true,
                      firstname: true,
                      lastname: true,
                    },
                  },
                },
              },
            },
          },
          devices: true,
          SaleRecipient: true,
          product: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    return {
      saleItems: saleItems.map((item) => {
        return {
          ...item,
          sale: {
            ...item.sale,
            creatorDetails: plainToInstance(
              UserEntity,
              item.sale.creatorDetails,
            ),
            agent: {
              ...item.sale.agent,
              user: item.sale.agent?.user
                ? plainToInstance(UserEntity, item.sale.agent.user)
                : undefined,
            },
          },
        };
      }),
      total: totalCount,
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
      where: { id: saleItem.productId },
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
      processedItem.monthlyPayment =
        (totalWithMargin - installmentTotalPrice) / (numberOfMonths - 1);
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
      where: { id: { in: productIds } },
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
}
