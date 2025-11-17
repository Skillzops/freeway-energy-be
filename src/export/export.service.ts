import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportDataQueryDto, ExportType } from './dto/export-query.dto';

export interface ExportResult {
  data: string;
  jsonData?: any[];
  totalRecords: number;
  allRecordsCount?: number;
  currentPage?: number;
  totalPages?: number;
  exportType: string;
  filters: ExportDataQueryDto;
  generatedAt: Date;
  fileSize: number;
  summary?: any;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportData(filters: ExportDataQueryDto): Promise<ExportResult> {
    this.validateFilters(filters);

    const startTime = Date.now();
    this.logger.log(`Starting ${filters.exportType} export`);

    let result: Omit<ExportResult, 'filters' | 'generatedAt' | 'fileSize'>;

    switch (filters.exportType) {
      case ExportType.DEBT_REPORT:
        result = await this.exportDebtReport(filters);
        break;
      case ExportType.RENEWAL_REPORT:
        result = await this.exportRenewalReport(filters);
        break;
      case ExportType.WEEKLY_SUMMARY:
        result = await this.exportWeeklySummary(filters);
        break;
      case ExportType.MONTHLY_SUMMARY:
        result = await this.exportMonthlySummary(filters);
        break;
      case ExportType.SALES:
        result = await this.exportSales(filters);
        break;
      case ExportType.CUSTOMERS:
        result = await this.exportCustomers(filters);
        break;
      case ExportType.PAYMENTS:
        result = await this.exportPayments(filters);
        break;
      case ExportType.DEVICES:
        result = await this.exportDevices(filters);
        break;
      case ExportType.TOTAL_OUTSTANDING_RECEIVABLES:
        result = await this.exportTotalOutstandingReceivables(filters);
        break;
      default:
        throw new BadRequestException(
          `Invalid export type: ${filters.exportType}`,
        );
    }

    const endTime = Date.now();
    this.logger.log(
      `Export completed in ${endTime - startTime}ms. Records: ${result.totalRecords}`,
    );

    return {
      ...result,
      filters,
      generatedAt: new Date(),
      fileSize: Buffer.byteLength(result.data, 'utf8'),
    };
  }

  private async exportDebtReport(filters: ExportDataQueryDto): Promise<any> {
    const overdueDays = filters.overdueDays || 35;
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = {
      status: { $in: ['IN_INSTALLMENT', 'COMPLETED'] },
      deletedAt: null,
      $expr: { $gt: [{ $subtract: ['$totalPrice', '$totalPaid'] }, 0] },
    };

    const dateFilter = this.buildDateFilter(filters.startDate, filters.endDate);
    if (dateFilter) {
      matchConditions.createdAt = dateFilter;
    }

    if (filters.customerId)
      matchConditions.customerId = { $oid: filters.customerId };
    if (filters.agentId) matchConditions.agentId = { $oid: filters.agentId };

    const countPipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'sales_items',
          localField: '_id',
          foreignField: 'saleId',
          as: 'saleItems',
        },
      },
      {
        $match: { saleItems: { $ne: [] } }, // Only sales with items
      },
      { $count: 'total' },
    ];

    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: countPipeline,
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const salesPipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'sales_items',
          localField: '_id',
          foreignField: 'saleId',
          as: 'saleItems',
        },
      },
      {
        $match: { saleItems: { $ne: [] } }, // Only sales with items
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $match: { customer: { $ne: [] } } },
      { $unwind: '$customer' },
      { $sort: { totalPrice: -1, _id: 1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          customerId: 1,
          agentId: 1,
          agentName: 1,
          totalPrice: 1,
          totalPaid: 1,
          totalMonthlyPayment: 1,
          transactionDate: 1,
          createdAt: 1,
          status: 1,
          'customer.firstname': 1,
          'customer.lastname': 1,
          'customer.phone': 1,
          'customer.email': 1,
          'customer.createdAt': 1,
        },
      },
    ];

    const salesResults = await this.prisma.sales.aggregateRaw({
      pipeline: salesPipeline,
      options: { allowDiskUse: true },
    });
    const sales = this.extractResults(salesResults);

    if (sales.length === 0) {
      return this.emptyDebtReport(page, totalPages, allRecordsCount);
    }

    const saleIds = sales.map((s) => this.extractObjectId(s._id));
    const customerIds = [
      ...new Set(sales.map((s) => this.extractObjectId(s.customerId))),
    ];

    const [customersData, paymentsData] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          email: true,
          state: true,
          lga: true,
          assignedAgents: {
            select: {
              agent: {
                select: {
                  user: {
                    select: { firstname: true, lastname: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          saleId: { in: saleIds },
          paymentStatus: 'COMPLETED',
        },
        select: {
          saleId: true,
          amount: true,
          paymentDate: true,
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const customerMap = new Map(customersData.map((c) => [c.id, c]));

    const paymentsBySale = new Map<string, any[]>();
    paymentsData.forEach((p) => {
      if (!paymentsBySale.has(p.saleId)) {
        paymentsBySale.set(p.saleId, []);
      }
      paymentsBySale.get(p.saleId).push(p);
    });

    const now = new Date().getTime();
    const jsonData = sales
      .map((sale) => {
        const saleId = this.extractObjectId(sale._id);
        const customerId = this.extractObjectId(sale.customerId);
        const customer = customerMap.get(customerId);
        const payments = paymentsBySale.get(saleId) || [];

        const outstandingBalance =
          (sale.totalPrice || 0) - (sale.totalPaid || 0);
        const monthlyPayment = sale.totalMonthlyPayment || 0;
        const remainingMonths =
          monthlyPayment > 0
            ? Math.ceil(outstandingBalance / monthlyPayment)
            : 0;

        const lastPayment = payments[payments.length - 1];
        const lastPaymentDate = lastPayment?.paymentDate || sale.createdAt;
        const daysSinceLastPayment = Math.floor(
          (now - new Date(lastPaymentDate).getTime()) / 86400000,
        );
        const isOverdue = daysSinceLastPayment > overdueDays;

        if (
          filters.isOverdue !== undefined &&
          filters.isOverdue !== isOverdue
        ) {
          return null;
        }

        if (
          filters.state &&
          customer?.state?.toLowerCase() !== filters.state.toLowerCase()
        ) {
          return null;
        }
        if (
          filters.lga &&
          customer?.lga?.toLowerCase() !== filters.lga.toLowerCase()
        ) {
          return null;
        }

        return {
          customerId,
          customerName: customer
            ? `${customer.firstname} ${customer.lastname}`
            : '',
          customerPhone: customer?.phone || '',
          customerEmail: customer?.email || '',
          saleId,
          transactionDate: this.formatDate(
            sale.transactionDate || sale.createdAt,
          ),
          totalPrice: sale.totalPrice || 0,
          totalPaid: sale.totalPaid || 0,
          outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
          monthlyPayment,
          remainingMonths,
          totalPaymentsMade: payments.length,
          lastPaymentDate: this.formatDate(lastPaymentDate),
          lastPaymentAmount: lastPayment?.amount || 0,
          daysSinceLastPayment,
          isOverdue,
          status: sale.status || '',
          agentName:
            sale?.agentName && sale?.agentName?.trim()
              ? sale?.agentName?.trim()
              : `${customer?.assignedAgents?.[0]?.agent?.user?.firstname ?? ''} ${customer?.assignedAgents?.[0]?.agent?.user?.lastname ?? ''}`.trim() ||
                '',
          state: customer?.state || '',
          lga: customer?.lga || '',
        };
      })
      .filter((item) => item !== null);

    const totalOutstandingDebt = jsonData.reduce(
      (sum, item) => sum + item.outstandingBalance,
      0,
    );
    const uniqueCustomers = new Set(jsonData.map((item) => item.customerId))
      .size;
    const overdueCount = jsonData.filter((item) => item.isOverdue).length;

    const summary = {
      totalOutstandingDebt: parseFloat(totalOutstandingDebt.toFixed(2)),
      totalCustomersInDebt: uniqueCustomers,
      totalSalesWithDebt: jsonData.length,
      overduePaymentsCount: overdueCount,
      generatedAt: new Date().toISOString(),
      ...(filters.startDate && {
        periodStart: new Date(filters.startDate).toISOString(),
      }),
      ...(filters.endDate && {
        periodEnd: new Date(filters.endDate).toISOString(),
      }),
    };

    // Build CSV
    const csvData = this.buildCSV(
      [
        'Customer ID',
        'Customer Name',
        'Customer Phone',
        'Customer Email',
        'Sale ID',
        'Transaction Date',
        'Total Price',
        'Total Paid',
        'Outstanding Balance',
        'Monthly Payment',
        'Remaining Months',
        'Total Payments Made',
        'Last Payment Date',
        'Last Payment Amount',
        'Days Since Last Payment',
        'Is Overdue',
        'Status',
        'Agent Name',
        'State',
        'LGA',
      ],
      jsonData,
      [
        'DEBT REPORT SUMMARY',
        `Generated At: ${new Date().toLocaleString()}`,
        ...(filters.startDate && filters.endDate
          ? [
              `Period: ${this.formatDate(filters.startDate)} to ${this.formatDate(
                filters.endDate,
              )}`,
            ]
          : []),
        `Total Outstanding Debt: NGN ${summary.totalOutstandingDebt.toLocaleString()}`,
        `Total Customers in Debt: ${summary.totalCustomersInDebt}`,
        `Total Sales with Outstanding Balance: ${summary.totalSalesWithDebt}`,
        `Overdue Payments: ${summary.overduePaymentsCount}`,
        `Total Records: ${allRecordsCount}`,
        `Page ${page} of ${totalPages}`,
        '',
        '',
      ],
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.DEBT_REPORT,
      summary,
    };
  }

  private async exportRenewalReport(filters: ExportDataQueryDto): Promise<any> {
    const overdueDays = filters.overdueDays || 35;
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = {
      status: 'IN_INSTALLMENT',
      deletedAt: null,
      $expr: { $gt: [{ $subtract: ['$totalPrice', '$totalPaid'] }, 0] },
    };

    const dateFilter = this.buildDateFilter(filters.startDate, filters.endDate);
    if (dateFilter) {
      matchConditions.createdAt = dateFilter;
    }

    if (filters.customerId)
      matchConditions.customerId = { $oid: filters.customerId };
    if (filters.agentId) matchConditions.agentId = { $oid: filters.agentId };

    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'sales_items',
            localField: '_id',
            foreignField: 'saleId',
            as: 'saleItems',
          },
        },
        {
          $match: { saleItems: { $ne: [] } }, // Only sales with items
        },
        { $count: 'total' },
      ],
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const salesResults = await this.prisma.sales.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'sales_items',
            localField: '_id',
            foreignField: 'saleId',
            as: 'saleItems',
          },
        },
        {
          $match: { saleItems: { $ne: [] } }, // Only sales with items
        },
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $match: { customer: { $ne: [] } } },
        { $unwind: '$customer' },
        { $sort: { createdAt: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            customerId: 1,
            agentName: 1,
            totalPrice: 1,
            totalPaid: 1,
            totalMonthlyPayment: 1,
            totalInstallmentDuration: 1,
            transactionDate: 1,
            createdAt: 1,
            'customer.firstname': 1,
            'customer.lastname': 1,
            'customer.phone': 1,
            'customer.email': 1,
            'customer.createdAt': 1,
          },
        },
      ],
      options: { allowDiskUse: true },
    });

    const sales = this.extractResults(salesResults);

    if (sales.length === 0) {
      return this.emptyRenewalReport(
        page,
        totalPages,
        allRecordsCount,
        overdueDays,
      );
    }

    const saleIds = sales.map((s) => this.extractObjectId(s._id));
    const customerIds = [
      ...new Set(sales.map((s) => this.extractObjectId(s.customerId))),
    ];

    const [customersData, paymentsData] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          state: true,
          lga: true,
          createdAt: true,
          assignedAgents: {
            select: {
              agent: {
                select: {
                  user: {
                    select: { firstname: true, lastname: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          saleId: { in: saleIds },
          sale: {},
          paymentStatus: 'COMPLETED',
        },
        select: { saleId: true, paymentDate: true },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const customerMap = new Map(customersData.map((c) => [c.id, c]));
    const paymentsBySale = new Map<string, any[]>();
    paymentsData.forEach((p) => {
      if (!paymentsBySale.has(p.saleId)) paymentsBySale.set(p.saleId, []);
      paymentsBySale.get(p.saleId).push(p);
    });

    const now = new Date().getTime();
    const jsonData = sales
      .map((sale) => {
        const saleId = this.extractObjectId(sale._id);
        const customerId = this.extractObjectId(sale.customerId);
        const customer = customerMap.get(customerId);
        const payments = paymentsBySale.get(saleId) || [];

        const lastPayment = payments[payments.length - 1];
        const lastPaymentDate =
          lastPayment?.paymentDate || sale.transactionDate;

        const daysSinceLastPayment = Math.floor(
          (now - new Date(lastPaymentDate).getTime()) / 86400000,
        );

        if (daysSinceLastPayment <= overdueDays) return null;

        if (
          filters.state &&
          customer?.state?.toLowerCase() !== filters.state.toLowerCase()
        )
          return null;
        if (
          filters.lga &&
          customer?.lga?.toLowerCase() !== filters.lga.toLowerCase()
        )
          return null;

        const saleDate = sale.transactionDate?.$date
          ? new Date(sale.transactionDate.$date)
          : sale.createdAt?.$date
            ? new Date(sale.createdAt.$date)
            : new Date(sale.createdAt);

        const monthsSinceSale = Math.floor(
          (now - saleDate.getTime()) / 2592000000, // 30 days in ms
        );

        const totalDuration = sale.totalInstallmentDuration || 12; // Default to 12 if missing
        const expectedPayments = Math.max(
          0,
          Math.min(monthsSinceSale, totalDuration - 1),
        );

        const actualMonthlyPayments = Math.max(0, payments.length - 1);

        const missedPayments = Math.max(
          0,
          expectedPayments - actualMonthlyPayments,
        );

        const safeExpectedPaymentAmount =
          isNaN(missedPayments) || !sale.totalMonthlyPayment
            ? 0
            : (sale.totalMonthlyPayment || 0) * missedPayments;

        return {
          customerId,
          customerName: customer
            ? `${customer.firstname} ${customer.lastname}`
            : '',
          customerPhone: customer?.phone || '',
          saleId,
          monthlyPayment: sale.totalMonthlyPayment || 0,
          lastPaymentDate: this.formatDate(lastPaymentDate),
          daysSinceLastPayment,
          monthsDefaulted: Math.floor(daysSinceLastPayment / 30),
          missedPayments: missedPayments || 0,
          expectedPaymentAmount: safeExpectedPaymentAmount,
          outstandingBalance: parseFloat(
            ((sale.totalPrice || 0) - (sale.totalPaid || 0)).toFixed(2),
          ),
          agentName:
            sale?.agentName && sale?.agentName?.trim()
              ? sale?.agentName?.trim()
              : `${customer?.assignedAgents?.[0]?.agent?.user?.firstname ?? ''} ${customer?.assignedAgents?.[0]?.agent?.user?.lastname ?? ''}`.trim() ||
                '',
          state: customer?.state || '',
          lga: customer?.lga || '',
        };
      })
      .filter((item) => item !== null);

    const summary = {
      totalDefaulters: jsonData.length,
      totalMissedPayments: jsonData.reduce(
        (sum, item) => sum + item.missedPayments,
        0,
      ),
      overdueDaysThreshold: overdueDays,
      generatedAt: new Date().toISOString(),
      ...(filters.startDate && {
        periodStart: new Date(filters.startDate).toISOString(),
      }),
      ...(filters.endDate && {
        periodEnd: new Date(filters.endDate).toISOString(),
      }),
    };

    const csvData = this.buildCSV(
      [
        'Customer ID',
        'Customer Name',
        'Customer Phone',
        'Sale ID',
        'Monthly Payment',
        'Last Payment Date',
        'Days Since Last Payment',
        'Months Defaulted',
        'Missed Payments',
        'Expected Payment Amount',
        'Outstanding Balance',
        'Agent Name',
        'State',
        'LGA',
      ],
      jsonData,
      [
        'RENEWAL PAYMENT DEFAULTERS REPORT',
        `Generated At: ${new Date().toLocaleString()}`,
        ...(filters.startDate && filters.endDate
          ? [
              `Period: ${this.formatDate(filters.startDate)} to ${this.formatDate(
                filters.endDate,
              )}`,
            ]
          : []),
        `Overdue Threshold: ${overdueDays} days`,
        `Total Defaulters: ${summary.totalDefaulters}`,
        `Total Missed Payments: ${summary.totalMissedPayments}`,
        `Total Records: ${allRecordsCount}`,
        `Page ${page} of ${totalPages}`,
        '',
        '',
      ],
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.RENEWAL_REPORT,
      summary,
    };
  }

  private async exportWeeklySummary(filters: ExportDataQueryDto): Promise<any> {
    const { startDate: rawStartDate, endDate: rawEndDate } = filters;

    // Validate and calculate dates
    const { startDate, endDate } = this.validateAndCalculateDateRange(
      rawStartDate,
      rawEndDate,
      'WEEKLY',
    );

    return this.generateSummaryReport(startDate, endDate, filters, 'WEEKLY');
  }

  private async exportMonthlySummary(
    filters: ExportDataQueryDto,
  ): Promise<any> {
    const { startDate: rawStartDate, endDate: rawEndDate } = filters;

    // Validate and calculate dates
    const { startDate, endDate } = this.validateAndCalculateDateRange(
      rawStartDate,
      rawEndDate,
      'MONTHLY',
    );

    return this.generateSummaryReport(startDate, endDate, filters, 'MONTHLY');
  }

  private async generateSummaryReport(
    startDate: Date,
    endDate: Date,
    filters: ExportDataQueryDto,
    period: 'WEEKLY' | 'MONTHLY',
  ): Promise<any> {
    const matchConditions: any = {
      createdAt: {
        $gte: { $date: startDate.toISOString() },
        $lte: { $date: endDate.toISOString() },
      },
      deletedAt: null,
    };

    if (filters.agentId) matchConditions.agentId = { $oid: filters.agentId };

    const [newSalesResults, renewalsResults] = await Promise.all([
      // New sales
      this.prisma.sales.aggregateRaw({
        pipeline: [
          { $match: matchConditions },
          {
            $lookup: {
              from: 'sales_items',
              localField: '_id',
              foreignField: 'saleId',
              as: 'items',
            },
          },
          {
            $match: { items: { $ne: [] } }, // Only sales with items
          },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: null,
              totalSales: { $sum: 1 },
              totalQuantity: { $sum: '$items.quantity' },
              cashCount: {
                $sum: {
                  $cond: [{ $eq: ['$items.paymentMode', 'ONE_OFF'] }, 1, 0],
                },
              },
              cashQty: {
                $sum: {
                  $cond: [
                    { $eq: ['$items.paymentMode', 'ONE_OFF'] },
                    '$items.quantity',
                    0,
                  ],
                },
              },
              installCount: {
                $sum: {
                  $cond: [{ $eq: ['$items.paymentMode', 'INSTALLMENT'] }, 1, 0],
                },
              },
              installQty: {
                $sum: {
                  $cond: [
                    { $eq: ['$items.paymentMode', 'INSTALLMENT'] },
                    '$items.quantity',
                    0,
                  ],
                },
              },
              totalRev: { $sum: '$totalPrice' },
              cashRev: {
                $sum: {
                  $cond: [
                    { $eq: ['$items.paymentMode', 'ONE_OFF'] },
                    '$totalPrice',
                    0,
                  ],
                },
              },
              installRev: {
                $sum: {
                  $cond: [
                    { $eq: ['$items.paymentMode', 'INSTALLMENT'] },
                    '$totalPrice',
                    0,
                  ],
                },
              },
            },
          },
        ],
        options: { allowDiskUse: true },
      }),
      this.prisma.payment.aggregateRaw({
        pipeline: [
          {
            $match: {
              paymentDate: {
                $gte: { $date: startDate.toISOString() },
                $lte: { $date: endDate.toISOString() },
              },
              paymentStatus: 'COMPLETED',
            },
          },
          {
            $lookup: {
              from: 'sales',
              localField: 'saleId',
              foreignField: '_id',
              as: 'sale',
            },
          },
          { $unwind: '$sale' },
          ...(filters.agentId
            ? [{ $match: { 'sale.agentId': { $oid: filters.agentId } } }]
            : []),
          {
            $lookup: {
              from: 'payments',
              let: { saleId: '$saleId' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$saleId', '$$saleId'] },
                    paymentStatus: 'COMPLETED',
                  },
                },
                { $sort: { paymentDate: 1 } },
              ],
              as: 'allPayments',
            },
          },
          {
            $addFields: {
              paymentIndex: { $indexOfArray: ['$allPayments._id', '$_id'] },
            },
          },
          { $match: { paymentIndex: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              totalRenewals: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
            },
          },
        ],
        options: { allowDiskUse: true },
      }),
    ]);

    const newSales = this.extractResults(newSalesResults)[0] || {};
    const renewals = this.extractResults(renewalsResults)[0] || {};

    const summary = {
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      newSales: {
        totalCount: newSales.totalSales || 0,
        totalQuantity: newSales.totalQuantity || 0,
        cashSalesCount: newSales.cashCount || 0,
        cashQuantity: newSales.cashQty || 0,
        installmentSalesCount: newSales.installCount || 0,
        installmentQuantity: newSales.installQty || 0,
        totalRevenue: parseFloat((newSales.totalRev || 0).toFixed(2)),
        cashRevenue: parseFloat((newSales.cashRev || 0).toFixed(2)),
        installmentRevenue: parseFloat((newSales.installRev || 0).toFixed(2)),
      },
      renewals: {
        totalCount: renewals.totalRenewals || 0,
        totalAmount: parseFloat((renewals.totalAmount || 0).toFixed(2)),
      },
      grandTotal: {
        totalRevenue: parseFloat(
          ((newSales.totalRev || 0) + (renewals.totalAmount || 0)).toFixed(2),
        ),
      },
    };

    const csvRows = [
      `${period} SUMMARY REPORT`,
      `Period: ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`,
      `Generated At: ${new Date().toLocaleString()}`,
      '',
      'NEW SALES',
      `Total New Sales (Count),${summary.newSales.totalCount}`,
      `Total Stock Quantity,${summary.newSales.totalQuantity}`,
      `Cash Sales (Count),${summary.newSales.cashSalesCount}`,
      `Cash Sales (Quantity),${summary.newSales.cashQuantity}`,
      `Installment Sales (Count),${summary.newSales.installmentSalesCount}`,
      `Installment Sales (Quantity),${summary.newSales.installmentQuantity}`,
      `Total Revenue,NGN ${summary.newSales.totalRevenue.toLocaleString()}`,
      `Cash Sales Revenue,NGN ${summary.newSales.cashRevenue.toLocaleString()}`,
      `Installment Sales Revenue,NGN ${summary.newSales.installmentRevenue.toLocaleString()}`,
      '',
      'RENEWALS/REACTIVATIONS',
      `Total Renewals (Count),${summary.renewals.totalCount}`,
      `Total Amount Paid,NGN ${summary.renewals.totalAmount.toLocaleString()}`,
      '',
      'GRAND TOTAL',
      `Combined Revenue,NGN ${summary.grandTotal.totalRevenue.toLocaleString()}`,
    ];

    return {
      data: csvRows.join('\n'),
      jsonData: [summary],
      totalRecords: 1,
      exportType:
        period === 'WEEKLY'
          ? ExportType.WEEKLY_SUMMARY
          : ExportType.MONTHLY_SUMMARY,
      summary,
    };
  }

  private async exportSales(filters: ExportDataQueryDto): Promise<any> {
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = { deletedAt: null };
    if (filters.startDate || filters.endDate) {
      matchConditions.createdAt = {};
      if (filters.startDate)
        matchConditions.createdAt.$gte = {
          $date: new Date(filters.startDate).toISOString(),
        };
      if (filters.endDate)
        matchConditions.createdAt.$lte = {
          $date: new Date(filters.endDate).toISOString(),
        };
    }
    if (filters.salesStatus) matchConditions.status = filters.salesStatus;
    if (filters.customerId)
      matchConditions.customerId = { $oid: filters.customerId };
    if (filters.agentId) matchConditions.agentId = { $oid: filters.agentId };

    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'sales_items',
            localField: '_id',
            foreignField: 'saleId',
            as: 'saleItems',
          },
        },
        {
          $match: { saleItems: { $ne: [] } }, // Only sales with items
        },
        { $count: 'total' },
      ],
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const salesResults = await this.prisma.sales.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'sales_items',
            localField: '_id',
            foreignField: 'saleId',
            as: 'saleItems',
          },
        },
        {
          $match: { saleItems: { $ne: [] } }, // Only sales with items
        },
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            customerId: 1,
            agentName: 1,
            totalPrice: 1,
            totalPaid: 1,
            remainingInstallments: 1,
            totalMonthlyPayment: 1,
            totalInstallmentDuration: 1,
            transactionDate: 1,
            createdAt: 1,
            'customer.firstname': 1,
            'customer.lastname': 1,
            'customer.phone': 1,
            'customer.email': 1,
            'customer.createdAt': 1,
          },
        },
      ],
      options: { allowDiskUse: true },
    });
    const sales = this.extractResults(salesResults);

    if (sales.length === 0) {
      return {
        data: '',
        jsonData: [],
        totalRecords: 0,
        allRecordsCount,
        currentPage: page,
        totalPages,
        exportType: ExportType.SALES,
      };
    }

    const saleIds = sales.map((s) => this.extractObjectId(s._id));
    const customerIds = [
      ...new Set(sales.map((s) => this.extractObjectId(s.customerId))),
    ];

    const [customersData, saleItemsData, paymentsData] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          state: true,
          lga: true,
          assignedAgents: {
            select: {
              agent: {
                select: {
                  user: {
                    select: { firstname: true, lastname: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.saleItem.findMany({
        where: { saleId: { in: saleIds } },
        select: { saleId: true, paymentMode: true },
        take: saleIds.length, // One per sale
      }),
      this.prisma.payment.findMany({
        where: { saleId: { in: saleIds }, paymentStatus: 'COMPLETED' },
        select: { saleId: true, paymentDate: true },
        orderBy: { paymentDate: 'desc' },
      }),
    ]);

    const customerMap = new Map(customersData.map((c) => [c.id, c]));
    const saleItemMap = new Map(saleItemsData.map((si) => [si.saleId, si]));
    const paymentsBySale = new Map<string, any[]>();
    paymentsData.forEach((p) => {
      if (!paymentsBySale.has(p.saleId)) paymentsBySale.set(p.saleId, []);
      paymentsBySale.get(p.saleId).push(p);
    });

    const jsonData = sales.map((sale) => {
      const saleId = this.extractObjectId(sale._id);
      const customer = customerMap.get(this.extractObjectId(sale.customerId));
      const saleItem = saleItemMap.get(saleId);
      const payments = paymentsBySale.get(saleId) || [];

      return {
        saleId,
        transactionDate: this.formatDate(
          sale.transactionDate || sale.createdAt,
        ),
        status: sale.status || '',
        agentName:
          sale?.agentName ||
          `${customer.assignedAgents?.[0].agent.user.firstname} ${customer.assignedAgents?.[0].agent.user.lastname}` ||
          '',
        customerName: customer
          ? `${customer.firstname} ${customer.lastname}`
          : '',
        customerPhone: customer?.phone || '',
        paymentMode: saleItem?.paymentMode || '',
        totalPrice: sale.totalPrice || 0,
        totalPaid: sale.totalPaid || 0,
        outstandingBalance: (sale.totalPrice || 0) - (sale.totalPaid || 0),
        monthlyPayment: sale.totalMonthlyPayment || 0,
        remainingInstallments: sale.remainingInstallments || 0,
        paymentCount: payments.length,
        lastPaymentDate: this.formatDate(payments[0]?.paymentDate),
        state: customer?.state || '',
        lga: customer?.lga || '',
      };
    });

    const csvData = this.buildCSV(
      [
        'Sale ID',
        'Transaction Date',
        'Status',
        'Agent Name',
        'Customer Name',
        'Customer Phone',
        'Payment Mode',
        'Total Price',
        'Total Paid',
        'Outstanding Balance',
        'Monthly Payment',
        'Remaining Installments',
        'Payment Count',
        'Last Payment Date',
        'State',
        'LGA',
      ],
      jsonData,
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.SALES,
    };
  }

  private async exportCustomers(filters: ExportDataQueryDto): Promise<any> {
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = { deletedAt: null };
    if (filters.customerId) matchConditions._id = { $oid: filters.customerId };
    if (filters.state) matchConditions.state = new RegExp(filters.state, 'i');
    if (filters.lga) matchConditions.lga = new RegExp(filters.lga, 'i');

    const countResult = await this.prisma.customer.aggregateRaw({
      pipeline: [{ $match: matchConditions }, { $count: 'total' }],
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const customersResults = await this.prisma.customer.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      options: { allowDiskUse: true },
    });
    const customers = this.extractResults(customersResults);

    if (customers.length === 0) {
      return {
        data: '',
        jsonData: [],
        totalRecords: 0,
        allRecordsCount,
        currentPage: page,
        totalPages,
        exportType: ExportType.CUSTOMERS,
      };
    }

    const customerIds = customers.map((c) => this.extractObjectId(c._id));

    const sales = await this.prisma.sales.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, totalPrice: true, totalPaid: true },
    });

    // Group by customer
    const salesByCustomer = new Map<
      string,
      { totalSpent: number; outstandingDebt: number; count: number }
    >();
    sales.forEach((s) => {
      if (!salesByCustomer.has(s.customerId)) {
        salesByCustomer.set(s.customerId, {
          totalSpent: 0,
          outstandingDebt: 0,
          count: 0,
        });
      }
      const stats = salesByCustomer.get(s.customerId);
      stats.totalSpent += s.totalPaid || 0;
      stats.outstandingDebt += (s.totalPrice || 0) - (s.totalPaid || 0);
      stats.count++;
    });

    const jsonData = customers
      .map((customer) => {
        const customerId = this.extractObjectId(customer._id);
        const stats = salesByCustomer.get(customerId) || {
          totalSpent: 0,
          outstandingDebt: 0,
          count: 0,
        };

        // Apply hasOutstandingDebt filter
        if (filters.hasOutstandingDebt && stats.outstandingDebt <= 0)
          return null;

        return {
          customerId,
          firstName: customer.firstname || '',
          lastName: customer.lastname || '',
          email: customer.email || '',
          phone: customer.phone || '',
          state: customer.state || '',
          lga: customer.lga || '',
          totalSales: stats.count,
          totalSpent: parseFloat(stats.totalSpent.toFixed(2)),
          outstandingDebt: parseFloat(stats.outstandingDebt.toFixed(2)),
          createdDate: this.formatDate(customer.createdAt),
        };
      })
      .filter((item) => item !== null);

    const csvData = this.buildCSV(
      [
        'Customer ID',
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        'State',
        'LGA',
        'Total Sales',
        'Total Spent',
        'Outstanding Debt',
        'Created Date',
      ],
      jsonData,
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.CUSTOMERS,
    };
  }

  private async exportPayments(filters: ExportDataQueryDto): Promise<any> {
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = { deletedAt: null };
    if (filters.paymentMethod)
      matchConditions.paymentMethod = filters.paymentMethod;
    if (filters.startDate || filters.endDate) {
      matchConditions.paymentDate = {};
      if (filters.startDate)
        matchConditions.paymentDate.$gte = {
          $date: new Date(filters.startDate).toISOString(),
        };
      if (filters.endDate)
        matchConditions.paymentDate.$lte = {
          $date: new Date(filters.endDate).toISOString(),
        };
    }

    const countResult = await this.prisma.payment.aggregateRaw({
      pipeline: [{ $match: matchConditions }, { $count: 'total' }],
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const paymentsResults = await this.prisma.payment.aggregateRaw({
      pipeline: [
        { $match: matchConditions },

        {
          $lookup: {
            from: 'sales',
            localField: 'saleId',
            foreignField: '_id',
            as: 'sale',
          },
        },
        { $unwind: '$sale' },

        {
          $lookup: {
            from: 'customers',
            localField: 'sale.customerId',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $unwind: '$customer' },

        { $match: { customer: { $ne: null } } },

        { $sort: { paymentDate: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },

        {
          $project: {
            _id: 1,
            saleId: 1,
            transactionRef: 1,
            amount: 1,
            paymentStatus: 1,
            paymentMethod: 1,
            paymentDate: 1,
            'customer.firstname': 1,
            'customer.lastname': 1,
            'customer.phone': 1,
            'sale.agentName': 1,
          },
        },
      ],
      options: { allowDiskUse: true },
    });

    const payments = this.extractResults(paymentsResults);

    if (payments.length === 0) {
      return {
        data: '',
        jsonData: [],
        totalRecords: 0,
        allRecordsCount,
        currentPage: page,
        totalPages,
        exportType: ExportType.PAYMENTS,
      };
    }

    const saleIds = [
      ...new Set(payments.map((p) => this.extractObjectId(p.saleId))),
    ];

    const sales = await this.prisma.sales.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, customerId: true, agentName: true },
    });

    const customerIds = [...new Set(sales.map((s) => s.customerId))];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        assignedAgents: {
          select: {
            agent: {
              select: {
                user: {
                  select: { firstname: true, lastname: true },
                },
              },
            },
          },
        },
      },
    });

    const saleMap = new Map(sales.map((s) => [s.id, s]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const jsonData = payments.map((payment) => {
      const sale = saleMap.get(this.extractObjectId(payment.saleId));
      const customer = customerMap.get(sale?.customerId);

      return {
        paymentId: this.extractObjectId(payment._id) || '',
        transactionReference: payment.transactionRef || '',
        amount: payment.amount || 0,
        status: payment.paymentStatus || '',
        method: payment.paymentMethod || '',
        paymentDate: this.formatDate(payment.paymentDate),
        customerName: customer
          ? `${customer.firstname} ${customer.lastname}`
          : '',
        customerPhone: customer?.phone || '',
        agentName:
          sale?.agentName && sale?.agentName?.trim()
            ? sale?.agentName?.trim()
            : `${customer?.assignedAgents?.[0]?.agent?.user?.firstname ?? ''} ${customer?.assignedAgents?.[0]?.agent?.user?.lastname ?? ''}`.trim() ||
              '',
      };
    });

    const csvData = this.buildCSV(
      [
        'Payment ID',
        'Transaction Reference',
        'Amount',
        'Status',
        'Method',
        'Payment Date',
        'Customer Name',
        'Customer Phone',
        'Agent Name',
      ],
      jsonData,
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.PAYMENTS,
    };
  }

  private async exportDevices(filters: ExportDataQueryDto): Promise<any> {
    const page = filters.page || 1;
    const limit = filters.limit || 100;

    const matchConditions: any = {};
    if (filters.startDate || filters.endDate) {
      matchConditions.createdAt = {};
      if (filters.startDate)
        matchConditions.createdAt.$gte = {
          $date: new Date(filters.startDate).toISOString(),
        };
      if (filters.endDate)
        matchConditions.createdAt.$lte = {
          $date: new Date(filters.endDate).toISOString(),
        };
    }

    if (filters.serialNumber)
      matchConditions.serialNumber = {
        $regex: filters.serialNumber,
        $options: 'i',
      };
    if (filters.installationStatus)
      matchConditions.installationStatus = filters.installationStatus;

    const countResult = await this.prisma.device.aggregateRaw({
      pipeline: [{ $match: matchConditions }, { $count: 'total' }],
      options: { allowDiskUse: true },
    });
    const allRecordsCount = this.extractResults(countResult)[0]?.total || 0;
    const totalPages = Math.ceil(allRecordsCount / limit);

    const devicesResults = await this.prisma.device.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      options: { allowDiskUse: true },
    });
    const devices = this.extractResults(devicesResults);

    if (devices.length === 0) {
      return {
        data: '',
        jsonData: [],
        totalRecordsCount: 0,
        allRecordsCount,
        currentPage: page,
        totalPages,
        exportType: ExportType.DEVICES,
      };
    }

    const deviceIds = devices.map((d) => this.extractObjectId(d._id));

    const saleItems = await this.prisma.saleItem.findMany({
      where: { deviceIDs: { hasSome: deviceIds } },
      select: { deviceIDs: true, saleId: true },
    });

    const saleIds = [...new Set(saleItems.map((si) => si.saleId))];
    const sales = await this.prisma.sales.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, customerId: true, agentId: true, agentName: true },
    });

    let customerIds = [
      ...new Set(sales.map((s) => s.customerId).filter(Boolean)),
    ];
    const agentIds = [...new Set(sales.map((s) => s.agentId).filter(Boolean))];

    if (filters.customerId) {
      customerIds = customerIds.filter((id) => id === filters.customerId);
    }

    const customers =
      customerIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              assignedAgents: {
                select: {
                  agent: {
                    select: {
                      user: {
                        select: { firstname: true, lastname: true },
                      },
                    },
                  },
                },
              },
            },
          })
        : [];

    const agents =
      agentIds.length > 0
        ? await this.prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: {
              id: true,
              user: {
                select: {
                  firstname: true,
                  lastname: true,
                },
              },
            },
          })
        : [];

    const deviceToSale = new Map<string, string>();
    saleItems.forEach((si) => {
      si.deviceIDs.forEach((deviceId) => {
        deviceToSale.set(deviceId, si.saleId);
      });
    });
    const saleMap = new Map(sales.map((s) => [s.id, s]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const agentMap = new Map(
      agents.map((a) => [
        a.id,
        {
          firstname: a.user?.firstname || '',
          lastname: a.user?.lastname || '',
        },
      ]),
    );

    const jsonData = devices
      .map((device) => {
        const deviceId = this.extractObjectId(device._id);
        const saleId = deviceToSale.get(deviceId);
        const sale = saleMap.get(saleId);
        const customer = customerMap.get(sale?.customerId);
        const agent = agentMap.get(sale?.agentId);

        if (filters.customerId && sale?.customerId !== filters.customerId)
          return null;

        return {
          serialNumber: device.serialNumber || '',
          installationStatus: device.installationStatus || '',
          customerName: customer
            ? `${customer.firstname} ${customer.lastname}`
            : '',
          customerPhone: customer?.phone || '',
          agentName:
            sale?.agentName && sale?.agentName?.trim()
              ? sale?.agentName?.trim()
              : agent
                ? `${agent.firstname} ${agent.lastname}`.trim()
                : `${customer?.assignedAgents?.[0]?.agent?.user?.firstname ?? ''} ${customer?.assignedAgents?.[0]?.agent?.user?.lastname ?? ''}`.trim() ||
                  '',
          createdDate: this.formatDate(device.createdAt),
        };
      })
      .filter((item) => item !== null);

    const csvData = this.buildCSV(
      [
        'Serial Number',
        'Installation Status',
        'Customer Name',
        'Customer Phone',
        'Agent Name',
        'Created Date',
      ],
      jsonData,
    );

    return {
      data: csvData,
      jsonData,
      totalRecords: jsonData.length,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.DEVICES,
    };
  }

  private async exportTotalOutstandingReceivables(
    filters: ExportDataQueryDto,
  ): Promise<any> {
    const startDate = filters.startDate ? new Date(filters.startDate) : null;
    const endDate = filters.endDate ? new Date(filters.endDate) : null;

    const matchConditions: any = {
      deletedAt: null,
      $expr: { $gt: [{ $subtract: ['$totalPrice', '$totalPaid'] }, 0] },
    };

    if (startDate || endDate) {
      matchConditions.createdAt = {};
      if (startDate) {
        matchConditions.createdAt.$gte = { $date: startDate.toISOString() };
      }
      if (endDate) {
        matchConditions.createdAt.$lte = { $date: endDate.toISOString() };
      }
    }

    const salesResults = await this.prisma.sales.aggregateRaw({
      pipeline: [
        { $match: matchConditions },
        {
          $lookup: {
            from: 'sales_items',
            localField: '_id',
            foreignField: 'saleId',
            as: 'saleItems',
          },
        },
        {
          $match: { saleItems: { $ne: [] } }, // Only sales with items
        },
        {
          $group: {
            _id: null,
            totalOutstandingAmount: {
              $sum: { $subtract: ['$totalPrice', '$totalPaid'] },
            },
            totalSalesCount: { $sum: 1 },
            totalPriceSum: { $sum: '$totalPrice' },
            totalPaidSum: { $sum: '$totalPaid' },
          },
        },
      ],
      options: { allowDiskUse: true },
    });

    const results = this.extractResults(salesResults)[0] || {
      totalOutstandingAmount: 0,
      totalSalesCount: 0,
      totalPriceSum: 0,
      totalPaidSum: 0,
    };

    const summary = {
      periodStart: startDate?.toISOString() || null,
      periodEnd: endDate?.toISOString() || null,
      totalOutstandingReceivables: parseFloat(
        (results.totalOutstandingAmount || 0).toFixed(2),
      ),
      totalSalesCount: results.totalSalesCount || 0,
      totalSalesValue: parseFloat((results.totalPriceSum || 0).toFixed(2)),
      totalPaidToDate: parseFloat((results.totalPaidSum || 0).toFixed(2)),
      generatedAt: new Date().toISOString(),
    };

    const csvRows = [
      'TOTAL OUTSTANDING RECEIVABLES REPORT',
      ...(startDate && endDate
        ? [
            `Period: ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`,
          ]
        : []),
      `Generated At: ${new Date().toLocaleString()}`,
      '',
      'SUMMARY',
      `Total Outstanding Receivables,NGN ${summary.totalOutstandingReceivables.toLocaleString()}`,
      `Total Sales (in period),${summary.totalSalesCount}`,
      `Total Sales Value,NGN ${summary.totalSalesValue.toLocaleString()}`,
      `Total Paid to Date,NGN ${summary.totalPaidToDate.toLocaleString()}`,
    ];

    return {
      data: csvRows.join('\n'),
      jsonData: [summary],
      totalRecords: 1,
      exportType: ExportType.TOTAL_OUTSTANDING_RECEIVABLES,
      summary,
    };
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

  private extractResults(results: any): any[] {
    if (Array.isArray(results)) return results;
    if (results?.result) return results.result;
    const values = Object.values(results);
    return Array.isArray(values[0]) ? values[0] : [];
  }

  private extractObjectId(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (typeof id === 'object' && id.$oid) return id.$oid;
    if (typeof id === 'object' && id._bsontype === 'ObjectID')
      return id.toString();
    return String(id);
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

  private buildDateFilter(startDate?: string, endDate?: string): any {
    if (!startDate && !endDate) return null;

    const dateFilter: any = {};

    if (startDate) {
      dateFilter.$gte = { $date: new Date(startDate).toISOString() };
    }
    if (endDate) {
      dateFilter.$lte = { $date: new Date(endDate).toISOString() };
    }

    return dateFilter;
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

  private buildCSV(
    headers: string[],
    data: any[],
    summaryRows: string[] = [],
  ): string {
    const csvRows = [headers.join(',')];
    for (const item of data) {
      const row = Object.values(item).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    if (summaryRows.length) {
      return summaryRows.join('\n') + '\n' + csvRows.join('\n');
    }

    return csvRows.join('\n');
  }

  private emptyDebtReport(
    page: number,
    totalPages: number,
    allRecordsCount: number,
  ): any {
    return {
      data: 'No records found',
      jsonData: [],
      totalRecords: 0,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.DEBT_REPORT,
      summary: {
        totalOutstandingDebt: 0,
        totalCustomersInDebt: 0,
        totalSalesWithDebt: 0,
        overduePaymentsCount: 0,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private emptyRenewalReport(
    page: number,
    totalPages: number,
    allRecordsCount: number,
    overdueDays: number,
  ): any {
    return {
      data: 'No records found',
      jsonData: [],
      totalRecords: 0,
      allRecordsCount,
      currentPage: page,
      totalPages,
      exportType: ExportType.RENEWAL_REPORT,
      summary: {
        totalDefaulters: 0,
        totalMissedPayments: 0,
        overdueDaysThreshold: overdueDays,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private validateAndCalculateDateRange(
    startDate?: string,
    endDate?: string,
    period: 'WEEKLY' | 'MONTHLY' = 'WEEKLY',
  ): { startDate: Date; endDate: Date } {
    // If both dates are provided, validate the range
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (period === 'WEEKLY') {
        // For weekly: must be exactly 7 days or less (same week)
        if (diffDays < 0 || diffDays > 6) {
          throw new BadRequestException(
            `Weekly report date range must be within a 7-day period. You provided ${diffDays + 1} days. Example: 2025-01-01 to 2025-01-07`,
          );
        }
        return { startDate: start, endDate: end };
      } else if (period === 'MONTHLY') {
        // For monthly: must be within same month or up to 31 days
        const isNotSameMonthYear =
          start.getMonth() !== end.getMonth() ||
          start.getFullYear() !== end.getFullYear();

        if (isNotSameMonthYear) {
          throw new BadRequestException(
            `Monthly report date range must be within the same month. Start: ${start.toLocaleDateString()}, End: ${end.toLocaleDateString()}. Example: 2025-01-01 to 2025-01-31`,
          );
        }
        return { startDate: start, endDate: end };
      }
    }

    // If only one date is provided, calculate the other
    if (startDate && !endDate) {
      const start = new Date(startDate);
      let end: Date;

      if (period === 'WEEKLY') {
        // Add 6 days to start date to make a full week
        end = new Date(start);
        end.setDate(end.getDate() + 6);
      } else if (period === 'MONTHLY') {
        // Get the last day of the month
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      }

      return { startDate: start, endDate: endDate as any };
    }

    if (endDate && !startDate) {
      const end = new Date(endDate);
      let start: Date;

      if (period === 'WEEKLY') {
        // Subtract 6 days from end date
        start = new Date(end);
        start.setDate(start.getDate() - 6);
      } else if (period === 'MONTHLY') {
        // Get the first day of the month
        start = new Date(end.getFullYear(), end.getMonth(), 1);
      }

      return { startDate: start, endDate: end };
    }

    // If neither date provided, use defaults (original behavior)
    const end = new Date();
    let start: Date;

    if (period === 'WEEKLY') {
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'MONTHLY') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    }

    return { startDate: start, endDate: end };
  }
}
