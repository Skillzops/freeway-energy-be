import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportDataQueryDto } from './dto/export-query.dto';

export interface ExportResult {
  data: string; // CSV content
  totalRecords: number;
  estimatedCount?: number;
  exportType: string;
  filters: ExportDataQueryDto;
  generatedAt: Date;
  fileSize: number;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly MAX_RECORDS_PER_REQUEST = 10000;

  constructor(private readonly prisma: PrismaService) {}

  async exportData(filters: ExportDataQueryDto): Promise<ExportResult> {
    this.validateFilters(filters);

    const startTime = Date.now();
    this.logger.log(`Starting ${filters.exportType} export`, { filters });

    const estimatedCount = await this.estimateRecordCount(filters);

    if (estimatedCount > this.MAX_RECORDS_PER_REQUEST) {
      throw new BadRequestException(
        `Export would return ${estimatedCount} records. Maximum allowed is ${this.MAX_RECORDS_PER_REQUEST}. Please narrow your filters or use pagination.`,
      );
    }

    let csvData: string;
    let actualCount: number;

    switch (filters.exportType) {
      case 'sales':
        ({ csvData, actualCount } = await this.exportSales(filters));
        break;
      case 'customers':
        ({ csvData, actualCount } = await this.exportCustomers(filters));
        break;
      case 'payments':
        ({ csvData, actualCount } = await this.exportPayments(filters));
        break;
      case 'devices':
        ({ csvData, actualCount } = await this.exportDevices(filters));
        break;
      case 'comprehensive':
        ({ csvData, actualCount } = await this.exportComprehensive(filters));
        break;
      default:
        throw new BadRequestException(
          `Invalid export type: ${filters.exportType}`,
        );
    }

    const endTime = Date.now();
    this.logger.log(
      `Export completed in ${endTime - startTime}ms. Records: ${actualCount}`,
    );

    return {
      data: csvData,
      totalRecords: actualCount,
      estimatedCount,
      exportType: filters.exportType,
      filters,
      generatedAt: new Date(),
      fileSize: Buffer.byteLength(csvData, 'utf8'),
    };
  }

  private async exportSales(
    filters: ExportDataQueryDto,
  ): Promise<{ csvData: string; actualCount: number }> {
    const pipeline = this.buildSalesAggregationPipeline(filters);

    const results = await this.prisma.sales.aggregateRaw({ pipeline });
    const salesData = this.extractAggregationResults(results);

    const headers = [
      'Sale ID',
      'Transaction Date',
      'Status',
      'Agent Name',
      'Agent Category',
      'Customer Name',
      'Customer Phone',
      'Customer Email',
      'Customer Type',
      'Product Name',
      'Serial Number',
      'Payment Mode',
      'Total Price',
      'Total Paid',
      'Outstanding Balance',
      'Monthly Payment',
      'Remaining Installments',
      'Payment Count', // NEW
      'Has Made Repayments', // NEW
      'Last Payment Date', // NEW
      'Last Payment Amount', // NEW
      'Average Payment Amount', // NEW
      'Days Since Last Payment', // NEW
      'Payment Status', // NEW
      'Location',
      'State',
      'LGA',
      'Created Date',
    ];

    const csvRows = [headers.join(',')];

    for (const sale of salesData) {
      const paymentCount = sale.paymentCount || 0;
      const hasMadeRepayments = paymentCount > 1;
      const outstandingBalance = (sale.totalPrice || 0) - (sale.totalPaid || 0);
      const lastPaymentDate = sale.lastPayment?.paymentDate;
      const daysSinceLastPayment = lastPaymentDate
        ? Math.floor(
            (new Date().getTime() - new Date(lastPaymentDate).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : null;

      let paymentStatus = 'No Payments';
      if (paymentCount > 0) {
        if (outstandingBalance <= 0) {
          paymentStatus = 'Fully Paid';
        } else if (sale.status === 'IN_INSTALLMENT') {
          paymentStatus =
            daysSinceLastPayment && daysSinceLastPayment > 35
              ? 'Overdue'
              : 'Active';
        } else {
          paymentStatus = 'Partial Payment';
        }
      }

      const row = [
        this.escapeCSV(this.extractObjectId(sale._id) || ''),
        this.escapeCSV(this.formatDate(sale.transactionDate || sale.createdAt)),
        this.escapeCSV(sale.status || ''),
        this.escapeCSV(sale.agentName || ''),
        this.escapeCSV(sale.agent?.category || ''),
        this.escapeCSV(
          sale.customer
            ? `${sale.customer.firstname} ${sale.customer.lastname}`
            : '',
        ),
        this.escapeCSV(sale.customer?.phone || ''),
        this.escapeCSV(sale.customer?.email || ''),
        this.escapeCSV(sale.customer?.type || ''),
        this.escapeCSV(sale.product?.name || ''),
        this.escapeCSV(sale.devices?.[0]?.serialNumber || ''),
        this.escapeCSV(sale.saleItems?.[0]?.paymentMode || ''),
        this.escapeCSV(sale.totalPrice?.toString() || '0'),
        this.escapeCSV(sale.totalPaid?.toString() || '0'),
        this.escapeCSV(outstandingBalance.toFixed(2)),
        this.escapeCSV(sale.totalMonthlyPayment?.toString() || '0'),
        this.escapeCSV(sale.remainingInstallments?.toString() || '0'),
        this.escapeCSV(paymentCount.toString()),
        this.escapeCSV(hasMadeRepayments ? 'Yes' : 'No'),
        this.escapeCSV(this.formatDate(lastPaymentDate)),
        this.escapeCSV(sale.lastPayment?.amount?.toString() || '0'),
        this.escapeCSV(sale.averagePaymentAmount?.toFixed(2) || '0'),
        this.escapeCSV(daysSinceLastPayment?.toString() || 'N/A'),
        this.escapeCSV(paymentStatus),
        this.escapeCSV(sale.customer?.installationAddress || ''),
        this.escapeCSV(sale.customer?.state || ''),
        this.escapeCSV(sale.customer?.lga || ''),
        this.escapeCSV(this.formatDate(sale.createdAt)),
      ];
      csvRows.push(row.join(','));
    }

    return {
      csvData: csvRows.join('\n'),
      actualCount: salesData.length,
    };
  }

  private async exportCustomers(
    filters: ExportDataQueryDto,
  ): Promise<{ csvData: string; actualCount: number }> {
    const pipeline = this.buildCustomersAggregationPipeline(filters);

    const results = await this.prisma.customer.aggregateRaw({ pipeline });
    const customersData = this.extractAggregationResults(results);

    const headers = [
      'Customer ID',
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Alternate Phone',
      'Gender',
      'Status',
      'Type',
      'Installation Address',
      'State',
      'LGA',
      'Location',
      'Latitude',
      'Longitude',
      'ID Type',
      'ID Number',
      'Total Sales',
      'Total Spent',
      'Assigned Agent',
      'Created Date',
      'Updated Date',
    ];

    const csvRows = [headers.join(',')];

    for (const customer of customersData) {
      const row = [
        this.escapeCSV(this.extractObjectId(customer._id) || ''),
        this.escapeCSV(customer.firstname || ''),
        this.escapeCSV(customer.lastname || ''),
        this.escapeCSV(customer.email || ''),
        this.escapeCSV(customer.phone || ''),
        this.escapeCSV(customer.alternatePhone || ''),
        this.escapeCSV(customer.gender || ''),
        this.escapeCSV(customer.status || ''),
        this.escapeCSV(customer.type || ''),
        this.escapeCSV(customer.installationAddress || ''),
        this.escapeCSV(customer.state || ''),
        this.escapeCSV(customer.lga || ''),
        this.escapeCSV(customer.location || ''),
        this.escapeCSV(customer.latitude?.toString() || ''),
        this.escapeCSV(customer.longitude?.toString() || ''),
        this.escapeCSV(customer.idType || ''),
        this.escapeCSV(customer.idNumber || ''),
        this.escapeCSV(customer.salesCount?.toString() || '0'),
        this.escapeCSV(customer.totalSpent?.toString() || '0'),
        this.escapeCSV(customer.assignedAgent || ''),
        this.escapeCSV(this.formatDate(customer.createdAt)),
        this.escapeCSV(this.formatDate(customer.updatedAt)),
      ];
      csvRows.push(row.join(','));
    }

    return {
      csvData: csvRows.join('\n'),
      actualCount: customersData.length,
    };
  }

  private async exportPayments(
    filters: ExportDataQueryDto,
  ): Promise<{ csvData: string; actualCount: number }> {
    const pipeline = this.buildPaymentsAggregationPipeline(filters);

    const results = await this.prisma.payment.aggregateRaw({ pipeline });
    const paymentsData = this.extractAggregationResults(results);

    const headers = [
      'Payment ID',
      'Transaction Reference',
      'Amount',
      'Status',
      'Method',
      'Payment Date',
      'Sale ID',
      'Customer Name',
      'Customer Phone',
      'Agent Name',
      'Gateway',
      'Notes',
      'Created Date',
    ];

    const csvRows = [headers.join(',')];

    for (const payment of paymentsData) {
      const row = [
        this.escapeCSV(this.extractObjectId(payment._id) || ''),
        this.escapeCSV(payment.transactionRef || ''),
        this.escapeCSV(payment.amount?.toString() || '0'),
        this.escapeCSV(payment.paymentStatus || ''),
        this.escapeCSV(payment.paymentMethod || ''),
        this.escapeCSV(this.formatDate(payment.paymentDate)),
        this.escapeCSV(this.extractObjectId(payment.sale?._id) || ''),
        this.escapeCSV(
          payment.customer
            ? `${payment.customer.firstname} ${payment.customer.lastname}`
            : '',
        ),
        this.escapeCSV(payment.customer?.phone || ''),
        this.escapeCSV(payment.sale?.agentName || ''),
        this.escapeCSV(payment.sale?.paymentGateway || ''),
        this.escapeCSV(payment.notes || ''),
        this.escapeCSV(this.formatDate(payment.createdAt)),
      ];
      csvRows.push(row.join(','));
    }

    return {
      csvData: csvRows.join('\n'),
      actualCount: paymentsData.length,
    };
  }

  private async exportDevices(
    filters: ExportDataQueryDto,
  ): Promise<{ csvData: string; actualCount: number }> {
    const pipeline = this.buildDevicesAggregationPipeline(filters);

    const results = await this.prisma.device.aggregateRaw({ pipeline });
    const devicesData = this.extractAggregationResults(results);

    const headers = [
      'Device ID',
      'Serial Number',
      'Hardware Model',
      'Firmware Version',
      'Installation Status',
      'Installation Location',
      'Installation Latitude',
      'Installation Longitude',
      'Is Tokenable',
      'Is Used',
      'Token Count',
      'Sale ID',
      'Customer Name',
      'Customer Phone',
      'Product Name',
      'Agent Name',
      'Created Date',
      'Updated Date',
    ];

    const csvRows = [headers.join(',')];

    for (const device of devicesData) {
      const row = [
        this.escapeCSV(this.extractObjectId(device._id) || ''),
        this.escapeCSV(device.serialNumber || ''),
        this.escapeCSV(device.hardwareModel || ''),
        this.escapeCSV(device.firmwareVersion || ''),
        this.escapeCSV(device.installationStatus || ''),
        this.escapeCSV(device.installationLocation || ''),
        this.escapeCSV(device.installationLatitude || ''),
        this.escapeCSV(device.installationLongitude || ''),
        this.escapeCSV(device.isTokenable?.toString() || 'false'),
        this.escapeCSV(device.isUsed?.toString() || 'false'),
        this.escapeCSV(device.tokenCount?.toString() || '0'),
        this.escapeCSV(this.extractObjectId(device.sale?._id) || ''),
        this.escapeCSV(
          device.customer
            ? `${device.customer.firstname} ${device.customer.lastname}`
            : '',
        ),
        this.escapeCSV(device.customer?.phone || ''),
        this.escapeCSV(device.product?.name || ''),
        this.escapeCSV(device.sale?.agentName || ''),
        this.escapeCSV(this.formatDate(device.createdAt)),
        this.escapeCSV(this.formatDate(device.updatedAt)),
      ];
      csvRows.push(row.join(','));
    }

    return {
      csvData: csvRows.join('\n'),
      actualCount: devicesData.length,
    };
  }

  private async exportComprehensive(
    filters: ExportDataQueryDto,
  ): Promise<{ csvData: string; actualCount: number }> {
    const pipeline = this.buildComprehensiveAggregationPipeline(filters);

    const results = await this.prisma.sales.aggregateRaw({ pipeline });
    const comprehensiveData = this.extractAggregationResults(results);

    const headers = [
      'Sale ID',
      'Transaction Date',
      'Sale Status',
      'Agent Name',
      'Agent Category',
      'Installer Name',
      'Customer ID',
      'Customer Name',
      'Customer Phone',
      'Customer Email',
      'Customer Type',
      'Customer Status',
      'Installation Address',
      'State',
      'LGA',
      'Latitude',
      'Longitude',
      'Product Name',
      'Serial Number',
      'Device Status',
      'Payment Mode',
      'Total Price',
      'Total Paid',
      'Monthly Payment',
      'Remaining Installments',
      'Payment Status',
      'Last Payment Date',
      'Last Payment Amount',
      'Payment Method',
      'Token Count',
      'Installation Status',
      'Created Date',
    ];

    const csvRows = [headers.join(',')];

    for (const record of comprehensiveData) {
      const row = [
        this.escapeCSV(this.extractObjectId(record?._id) || ''),
        this.escapeCSV(
          this.formatDate(record.transactionDate || record.createdAt),
        ),
        this.escapeCSV(record.status || ''),
        this.escapeCSV(record.agentName || ''),
        this.escapeCSV(record.agent?.category || ''),
        this.escapeCSV(record.installerName || ''),
        this.escapeCSV(this.extractObjectId(record.customer?._id) || ''),
        this.escapeCSV(
          record.customer
            ? `${record.customer.firstname} ${record.customer.lastname}`
            : '',
        ),
        this.escapeCSV(record.customer?.phone || ''),
        this.escapeCSV(record.customer?.email || ''),
        this.escapeCSV(record.customer?.type || ''),
        this.escapeCSV(record.customer?.status || ''),
        this.escapeCSV(record.customer?.installationAddress || ''),
        this.escapeCSV(record.customer?.state || ''),
        this.escapeCSV(record.customer?.lga || ''),
        this.escapeCSV(record.customer?.latitude?.toString() || ''),
        this.escapeCSV(record.customer?.longitude?.toString() || ''),
        this.escapeCSV(record.product?.name || ''),
        this.escapeCSV(record.devices?.[0]?.serialNumber || ''),
        this.escapeCSV(record.devices?.[0]?.installationStatus || ''),
        this.escapeCSV(record.saleItems?.[0]?.paymentMode || ''),
        this.escapeCSV(record.totalPrice?.toString() || '0'),
        this.escapeCSV(record.totalPaid?.toString() || '0'),
        this.escapeCSV(record.totalMonthlyPayment?.toString() || '0'),
        this.escapeCSV(record.remainingInstallments?.toString() || '0'),
        this.escapeCSV(record.lastPayment?.paymentStatus || ''),
        this.escapeCSV(this.formatDate(record.lastPayment?.paymentDate)),
        this.escapeCSV(record.lastPayment?.amount?.toString() || '0'),
        this.escapeCSV(record.lastPayment?.paymentMethod || ''),
        this.escapeCSV(record.devices?.[0]?.tokenCount?.toString() || '0'),
        this.escapeCSV(record.devices?.[0]?.installationStatus || ''),
        this.escapeCSV(this.formatDate(record.createdAt)),
      ];
      csvRows.push(row.join(','));
    }

    return {
      csvData: csvRows.join('\n'),
      actualCount: comprehensiveData.length,
    };
  }

  // Add aggregation pipeline builders
  private buildSalesAggregationPipeline(filters: ExportDataQueryDto): any[] {
    const pipeline: any[] = [];

    // Match stage
    const matchStage = this.buildSalesMatchStage(filters);
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup stages
    pipeline.push(
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $lookup: {
          from: 'agents',
          localField: 'agentId',
          foreignField: '_id',
          as: 'agent',
        },
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
        $lookup: {
          from: 'devices',
          localField: 'saleItems.deviceIDs',
          foreignField: '_id',
          as: 'devices',
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'saleItems.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      // NEW: Lookup payments with payment analytics
      {
        $lookup: {
          from: 'payments',
          let: { saleId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$saleId', '$saleId'] },
                paymentStatus: 'COMPLETED',
              },
            },
            {
              $sort: { paymentDate: -1 },
            },
          ],
          as: 'payments',
        },
      },
      {
        $addFields: {
          customer: { $arrayElemAt: ['$customer', 0] },
          agent: { $arrayElemAt: ['$agent', 0] },
          product: { $arrayElemAt: ['$product', 0] },
          // Payment analytics
          paymentCount: { $size: '$payments' },
          lastPayment: { $arrayElemAt: ['$payments', 0] },
          averagePaymentAmount: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: {
                $divide: [{ $sum: '$payments.amount' }, { $size: '$payments' }],
              },
              else: 0,
            },
          },
        },
      },
    );

    // Pagination
    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    return pipeline;
  }

  private buildCustomersAggregationPipeline(
    filters: ExportDataQueryDto,
  ): any[] {
    const pipeline: any[] = [];

    const matchStage = this.buildCustomersMatchStage(filters);
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'sales',
          localField: '_id',
          foreignField: 'customerId',
          as: 'sales',
        },
      },
      {
        $lookup: {
          from: 'agent_customers',
          localField: '_id',
          foreignField: 'customerId',
          as: 'assignments',
        },
      },
      {
        $lookup: {
          from: 'agents',
          localField: 'assignments.agentId',
          foreignField: '_id',
          as: 'assignedAgents',
        },
      },
      {
        $addFields: {
          salesCount: { $size: '$sales' },
          totalSpent: { $sum: '$sales.totalPrice' },
          assignedAgent: {
            $let: {
              vars: { agent: { $arrayElemAt: ['$assignedAgents', 0] } },
              in: {
                $concat: [
                  { $ifNull: ['$$agent.user.firstname', ''] },
                  ' ',
                  { $ifNull: ['$$agent.user.lastname', ''] },
                ],
              },
            },
          },
        },
      },
    );

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    return pipeline;
  }

  private buildPaymentsAggregationPipeline(filters: ExportDataQueryDto): any[] {
    const pipeline: any[] = [];

    const matchStage = this.buildPaymentsMatchStage(filters);
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'sales',
          localField: 'saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      {
        $addFields: {
          sale: { $arrayElemAt: ['$sale', 0] },
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'sale.customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $addFields: {
          customer: { $arrayElemAt: ['$customer', 0] },
        },
      },
    );

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    return pipeline;
  }

  private buildDevicesAggregationPipeline(filters: ExportDataQueryDto): any[] {
    const pipeline: any[] = [];

    const matchStage = this.buildDevicesMatchStage(filters);
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'sales_items',
          localField: '_id',
          foreignField: 'deviceIDs',
          as: 'saleItems',
        },
      },
      {
        $lookup: {
          from: 'sales',
          localField: 'saleItems.saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'sale.customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'saleItems.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $lookup: {
          from: 'token',
          localField: '_id',
          foreignField: 'deviceId',
          as: 'tokens',
        },
      },
      {
        $addFields: {
          sale: { $arrayElemAt: ['$sale', 0] },
          customer: { $arrayElemAt: ['$customer', 0] },
          product: { $arrayElemAt: ['$product', 0] },
          tokenCount: { $size: '$tokens' },
        },
      },
    );

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    return pipeline;
  }

  private buildComprehensiveAggregationPipeline(
    filters: ExportDataQueryDto,
  ): any[] {
    const pipeline = this.buildSalesAggregationPipeline(filters);

    // Add additional lookups for comprehensive data
    pipeline.splice(
      -2,
      0, // Insert before sort and pagination
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'saleId',
          as: 'payments',
        },
      },
      {
        $addFields: {
          lastPayment: {
            $let: {
              vars: {
                sortedPayments: {
                  $sortArray: {
                    input: '$payments',
                    sortBy: { paymentDate: -1 },
                  },
                },
              },
              in: { $arrayElemAt: ['$$sortedPayments', 0] },
            },
          },
        },
      },
    );

    return pipeline;
  }

  // Add match stage builders for each type
  private buildSalesMatchStage(filters: ExportDataQueryDto): any {
    const match: any = {};

    if (filters.startDate || filters.endDate) {
      match.$or = [
        {
          transactionDate: {
            $ne: null,
            ...(filters.startDate && {
              $gte: { $date: filters.startDate.toISOString() },
            }),
            ...(filters.endDate && {
              $lte: { $date: filters.endDate.toISOString() },
            }),
          },
        },
        {
          transactionDate: null,
          createdAt: {
            ...(filters.startDate && {
              $gte: { $date: filters.startDate.toISOString() },
            }),
            ...(filters.endDate && {
              $lte: { $date: filters.endDate.toISOString() },
            }),
          },
        },
      ];
    }

    if (filters.salesStatus) match.status = filters.salesStatus;
    if (filters.customerId) match.customerId = { $oid: filters.customerId };
    if (filters.agentId) match.agentId = { $oid: filters.agentId };

    return match;
  }

  private buildCustomersMatchStage(filters: ExportDataQueryDto): any {
    const match: any = {};

    if (filters.customerId) match._id = { $oid: filters.customerId };
    if (filters.customerStatus) match.status = filters.customerStatus;
    if (filters.customerType) match.type = filters.customerType;
    if (filters.customerState)
      match.state = new RegExp(filters.customerState, 'i');
    if (filters.customerLga) match.lga = new RegExp(filters.customerLga, 'i');

    if (filters.createdStartDate || filters.createdEndDate) {
      match.createdAt = {};
      if (filters.createdStartDate)
        match.createdAt.$gte = {
          $date: filters.createdStartDate.toISOString(),
        };
      if (filters.createdEndDate)
        match.createdAt.$lte = { $date: filters.createdEndDate.toISOString() };
    }

    return match;
  }

  private buildPaymentsMatchStage(filters: ExportDataQueryDto): any {
    const match: any = {};

    if (filters.paymentStatus) match.paymentStatus = filters.paymentStatus;
    if (filters.paymentMethod) match.paymentMethod = filters.paymentMethod;
    if (filters.minAmount || filters.maxAmount) {
      match.amount = {};
      if (filters.minAmount) match.amount.$gte = filters.minAmount;
      if (filters.maxAmount) match.amount.$lte = filters.maxAmount;
    }

    if (filters.startDate || filters.endDate) {
      match.paymentDate = {};
      if (filters.startDate)
        match.paymentDate.$gte = { $date: filters.startDate.toISOString() };
      if (filters.endDate)
        match.paymentDate.$lte = { $date: filters.endDate.toISOString() };
    }

    return match;
  }

  private buildDevicesMatchStage(filters: ExportDataQueryDto): any {
    const match: any = {};

    if (filters.serialNumber)
      match.serialNumber = new RegExp(filters.serialNumber, 'i');

    if (filters.createdStartDate || filters.createdEndDate) {
      match.createdAt = {};
      if (filters.createdStartDate)
        match.createdAt.$gte = {
          $date: filters.createdStartDate.toISOString(),
        };
      if (filters.createdEndDate)
        match.createdAt.$lte = { $date: filters.createdEndDate.toISOString() };
    }

    return match;
  }

  private async estimateRecordCount(
    filters: ExportDataQueryDto,
  ): Promise<number> {
    try {
      let pipeline: any[];

      switch (filters.exportType) {
        case 'sales':
          pipeline = [
            { $match: this.buildSalesMatchStage(filters) },
            { $count: 'total' },
          ];
          break;
        case 'customers':
          pipeline = [
            { $match: this.buildCustomersMatchStage(filters) },
            { $count: 'total' },
          ];
          break;
        case 'payments':
          pipeline = [
            { $match: this.buildPaymentsMatchStage(filters) },
            { $count: 'total' },
          ];
          break;
        case 'devices':
          pipeline = [
            { $match: this.buildDevicesMatchStage(filters) },
            { $count: 'total' },
          ];
          break;
        default:
          pipeline = [
            { $match: this.buildSalesMatchStage(filters) },
            { $count: 'total' },
          ];
      }

      const collection = this.getCollectionForExportType(filters.exportType);
      const result = await collection.aggregateRaw({ pipeline });
      const resultArray = this.extractAggregationResults(result);

      return resultArray[0]?.total || 0;
    } catch (error) {
      this.logger.warn('Failed to estimate count', error);
      return 0;
    }
  }

  private getCollectionForExportType(exportType: string) {
    switch (exportType) {
      case 'sales':
      case 'comprehensive':
        return this.prisma.sales;
      case 'customers':
        return this.prisma.customer;
      case 'payments':
        return this.prisma.payment;
      case 'devices':
        return this.prisma.device;
      default:
        return this.prisma.sales;
    }
  }

  private extractAggregationResults(results: any): any[] {
    return Array.isArray(results)
      ? results
      : (results as any)?.result || Object.values(results)[0] || [];
  }

  private validateFilters(filters: ExportDataQueryDto): void {
    if (!filters.exportType) {
      throw new BadRequestException('Export type is required');
    }

    if (filters.page && filters.page < 1) {
      throw new BadRequestException('Page must be greater than 0');
    }

    if (filters.limit && (filters.limit < 1 || filters.limit > 5000)) {
      throw new BadRequestException('Limit must be between 1 and 5000');
    }

    if (
      filters.startDate &&
      filters.endDate &&
      filters.startDate > filters.endDate
    ) {
      throw new BadRequestException('Start date must be before end date');
    }
  }

  private escapeCSV(value: any): string {
    if (value === null || value === undefined) return '';

    const stringValue = String(value);

    if (
      stringValue.includes(',') ||
      stringValue.includes('"') ||
      stringValue.includes('\n')
    ) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  private formatDate(date: any): string {
    if (!date) return '';

    try {
      const dateObj = date.$date ? new Date(date.$date) : new Date(date);
      const day = dateObj.getDate().toString().padStart(2, '0');
      const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
      const year = dateObj.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return '';
    }
  }

  private extractObjectId(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (typeof id === 'object' && id.$oid) return id.$oid;
    if (typeof id === 'object' && id._bsontype === 'ObjectID')
      return id.toString();
    return String(id);
  }
}
