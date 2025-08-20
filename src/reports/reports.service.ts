import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { InstallationStatus, Prisma, SalesStatus } from '@prisma/client';

export interface DeviceTokenReportFilters {
  startDate?: string;
  endDate?: string;
  installationStatus?: InstallationStatus;
  isTokenable?: boolean;
  hasTokens?: boolean;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async generateCustomerPaymentReport(): Promise<string> {
    // Get all sales with customer and payment details
    const salesData = await this.prisma.sales.findMany({
      where: {
        status: {
          in: [SalesStatus.IN_INSTALLMENT, SalesStatus.COMPLETED],
        },
      },
      include: {
        customer: true,
        payment: {
          orderBy: {
            paymentDate: 'asc',
          },
        },
        saleItems: {
          include: {
            product: true,
            devices: true,
          },
        },
        creatorDetails: {
          select: {
            firstname: true,
            lastname: true,
            email: true,
          },
        },
        agent: {
          include: {
            user: {
              select: {
                firstname: true,
                lastname: true,
              },
            },
          },
        },
        contract: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const csvData = [];

    // CSV Headers
    const headers = [
      'Sale ID',
      'Customer First Name',
      'Customer Last Name',
      'Customer Phone',
      'Customer Email',
      'Customer Address',
      'Customer State',
      'Customer LGA',
      'Customer Type',
      'Sale Date',
      'Sale Status',
      'Total Amount',
      'Total Paid',
      'Outstanding Balance',
      'Payment Status',
      'Payment Method',
      'Installment Duration (Months)',
      'Monthly Payment',
      'Product Names',
      'Device Serial Numbers',
      'Agent Name',
      'Sales Person Email',
      'Contract ID',
      'Last Payment Date',
      'Payment Count',
      'Payment History',
      'Days Since Last Payment',
      'Payment Completion Percentage',
    ];

    csvData.push(headers.join(','));

    // Process each sale
    for (const sale of salesData) {
      const customer = sale.customer;
      const payments = sale.payment;
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const outstandingBalance = sale.totalPrice - totalPaid;
      const lastPayment =
        payments.length > 0 ? payments[payments.length - 1] : null;
      const daysSinceLastPayment = lastPayment
        ? Math.floor(
            (new Date().getTime() -
              new Date(lastPayment.paymentDate).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : null;
      const paymentCompletionPercentage = (
        (totalPaid / sale.totalPrice) *
        100
      ).toFixed(2);

      // Get product names and device serial numbers
      const productNames = sale.saleItems
        .map((item) => item.product.name)
        .join(';');
      const deviceSerials = sale.saleItems
        .flatMap((item) => item.devices.map((device) => device.serialNumber))
        .join(';');

      // Payment history string
      const paymentHistory = payments
        .map(
          (p) =>
            `${p.paymentDate.toISOString().split('T')[0]}:₦${p.amount}:${p.paymentMethod}`,
        )
        .join(';');

      const agentName = sale.agent?.user
        ? `${sale.agent.user.firstname} ${sale.agent.user.lastname}`
        : sale.agentName || 'N/A';

      const row = [
        sale.id,
        customer.firstname,
        customer.lastname,
        customer.phone,
        customer.email || '',
        customer.installationAddress || '',
        customer.state || '',
        customer.lga || '',
        customer.type,
        sale.createdAt.toISOString().split('T')[0],
        sale.status,
        sale.totalPrice,
        totalPaid,
        outstandingBalance,
        outstandingBalance <= 0
          ? 'FULLY_PAID'
          : outstandingBalance < sale.totalPrice
            ? 'PARTIALLY_PAID'
            : 'UNPAID',
        sale.paymentMethod,
        sale.totalInstallmentDuration || 0,
        sale.totalMonthlyPayment || 0,
        `"${productNames}"`,
        `"${deviceSerials}"`,
        agentName,
        sale.creatorDetails?.email || '',
        sale.contractId || '',
        lastPayment?.paymentDate.toISOString().split('T')[0] || '',
        payments.length,
        `"${paymentHistory}"`,
        daysSinceLastPayment || '',
        paymentCompletionPercentage,
      ];

      csvData.push(row.join(','));
    }

    // Write to file
    const fileName = `customer_payment_report_${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(process.cwd(), 'exports', fileName);

    // Ensure exports directory exists
    const exportDir = path.dirname(filePath);
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    fs.writeFileSync(filePath, csvData.join('\n'), 'utf8');

    return filePath;
  }

  async generateDeviceTokenReport(filters?: DeviceTokenReportFilters) {
    // Build where clause based on filters
    const whereClause: Prisma.DeviceWhereInput = {};

    if (filters?.installationStatus) {
      whereClause.installationStatus = filters.installationStatus;
    }

    if (filters?.isTokenable !== undefined) {
      whereClause.isTokenable = filters.isTokenable;
    }

    // if (filters?.hasTokens) {
    //   whereClause.tokens = {
    //     some: {},
    //   };
    // }

    if (filters?.startDate || filters?.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = new Date(filters.endDate);
      }
    }

    const tokenCounts = await this.prisma.device.findMany({
      where: {
        ...whereClause,
        tokens: {
          some: {},
        },
      },
      select: {
        id: true,
        _count: {
          select: {
            tokens: true,
          },
        },
      },
    });

    console.log(`Found ${tokenCounts.length} devices with tokens`);

    // Separate device IDs by token count
    const singleTokenDeviceIds = tokenCounts
      .filter((device) => device._count.tokens === 1)
      .map((device) => device.id);

    const multipleTokenDeviceIds = tokenCounts
      .filter((device) => device._count.tokens > 1)
      .map((device) => device.id);

    console.log(
      `Single token devices: ${singleTokenDeviceIds.length}, Multiple token devices: ${multipleTokenDeviceIds.length}`,
    );

    // Fetch full device data in parallel
    const [multipleTokenDevices] = await Promise.all([
      // singleTokenDeviceIds.length > 0
      //   ? this.prisma.device.findMany({
      //       where: {
      //         id: { in: singleTokenDeviceIds },
      //       },
      //       include: {
      //         tokens: {
      //           orderBy: {
      //             createdAt: 'desc',
      //           },
      //         },
      //         saleItems: {
      //           take: 1, // Only get first sale item per device
      //           include: {
      //             sale: {
      //               select: {
      //                 id: true,
      //                 status: true,
      //                 totalPrice: true,
      //                 createdAt: true,
      //                 customer: {
      //                   select: {
      //                     firstname: true,
      //                     lastname: true,
      //                     phone: true,
      //                     email: true,
      //                     installationAddress: true,
      //                     state: true,
      //                     lga: true,
      //                     type: true,
      //                   },
      //                 },
      //               },
      //             },
      //             product: {
      //               select: {
      //                 name: true,
      //                 category: true,
      //               },
      //             },
      //           },
      //         },
      //       },
      //       orderBy: {
      //         createdAt: 'desc',
      //       },
      //     })
      //   : [],

      multipleTokenDeviceIds.length > 0
        ? this.prisma.device.findMany({
            where: {
              id: { in: multipleTokenDeviceIds },
            },
            include: {
              tokens: {
                orderBy: {
                  createdAt: 'desc',
                },
              },
              saleItems: {
                take: 1, // Only get first sale item per device
                include: {
                  sale: {
                    select: {
                      id: true,
                      status: true,
                      totalPrice: true,
                      createdAt: true,
                      customer: {
                        select: {
                          firstname: true,
                          lastname: true,
                          phone: true,
                          email: true,
                          installationAddress: true,
                          state: true,
                          lga: true,
                          type: true,
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
            },
            orderBy: {
              createdAt: 'desc',
            },
          })
        : [],
    ]);
  

    const csvData = [];

    // CSV Headers
    const headers = [
      'Device ID',
      'Serial Number',
      'Device Key',
      'Hardware Model',
      'Firmware Version',
      'Installation Status',
      'Installation Address',
      'Installation Coordinates',
      'Is Tokenable',
      'Is Used',
      'Starting Code',
      'Current Count',
      'Time Divider',
      'Restricted Digit Mode',
      'Total Tokens Generated',
      'Latest Token',
      'Latest Token Duration',
      'Latest Token Date',
      'All Tokens (Token:Duration:Date)',
      'Device Created Date',
      'Device Last Updated',
    ];

    csvData.push(headers.join(','));

    // Process each device
    for (const device of multipleTokenDevices) {
      const tokens = device.tokens;
      const latestToken = tokens.length > 0 ? tokens[0] : null;

      // Format all tokens as a concatenated string
      const allTokensString = tokens
        .map(
          (token) =>
            `${token.token}:${token.duration}:${token.createdAt.toISOString().split('T')[0]}`,
        )
        .join(';');

      const row = [
        device.id,
        device.serialNumber,
        device.key,
        device.hardwareModel || '',
        device.firmwareVersion || '',
        device.installationStatus,
        `"${device.installationLocation || ''}"`,
        `Lon ${device.installationLongitude || '-'} Lat ${device.installationLatitude || '-'}`,
        device.isTokenable,
        device.isUsed,
        device.startingCode || '',
        device.count || '',
        device.timeDivider || '',
        device.restrictedDigitMode,
        tokens.length,
        latestToken?.token || '',
        latestToken?.duration || '',
        latestToken?.createdAt.toISOString().split('T')[0] || '',
        `"${allTokensString}"`,
        device.createdAt.toISOString().split('T')[0],
        device.updatedAt.toISOString().split('T')[0],
      ];

      csvData.push(row.join(','));
    }

    // Write to file
    const fileName = `device_token_report_${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(process.cwd(), 'exports', fileName);

    // Ensure exports directory exists
    const exportDir = path.dirname(filePath);
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    fs.writeFileSync(filePath, csvData.join('\n'), 'utf8');

    return filePath;
  }

  async generateTokenHistoryReport(deviceId?: string): Promise<string> {
    const whereClause: any = {};

    if (deviceId) {
      whereClause.deviceId = deviceId;
    }

    // Fetch all tokens with device details
    const tokens = await this.prisma.tokens.findMany({
      where: whereClause,
      include: {
        device: {
          select: {
            id: true,
            serialNumber: true,
            hardwareModel: true,
            installationStatus: true,
            isTokenable: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const csvData = [];

    // CSV Headers
    const headers = [
      'Token ID',
      'Token Value',
      'Duration (Days)',
      'Duration Type',
      'Token Created Date',
      'Device ID',
      'Device Serial Number',
      'Device Hardware Model',
      'Device Installation Status',
      'Device Is Tokenable',
    ];

    csvData.push(headers.join(','));

    // Process each token
    for (const token of tokens) {
      const durationType =
        token.duration === -1
          ? 'Forever'
          : token.duration === 0
            ? 'Expired/Zero'
            : 'Limited Days';

      const row = [
        token.id,
        token.token,
        token.duration,
        durationType,
        token.createdAt.toISOString(),
        token.device?.id || '',
        token.device?.serialNumber || '',
        token.device?.hardwareModel || '',
        token.device?.installationStatus || '',
        token.device?.isTokenable || false,
      ];

      csvData.push(row.join(','));
    }

    // Write to file
    const fileName = deviceId
      ? `device_${deviceId}_token_history_${new Date().toISOString().split('T')[0]}.csv`
      : `all_tokens_history_${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(process.cwd(), 'exports', fileName);

    // Ensure exports directory exists
    const exportDir = path.dirname(filePath);
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    fs.writeFileSync(filePath, csvData.join('\n'), 'utf8');

    return filePath;
  }
}
