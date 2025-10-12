// import { Injectable, Logger, BadRequestException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { ExportDataQueryDto, ExportType } from './dto/export-query.dto';

// export interface ExportResult {
//   data: string;
//   jsonData?: any[];
//   totalRecords: number;
//   allRecordsCount?: number;
//   currentPage?: number;
//   totalPages?: number;
//   exportType: string;
//   filters: ExportDataQueryDto;
//   generatedAt: Date;
//   fileSize: number;
//   summary?: any;
// }

// @Injectable()
// export class ExportService {
//   private readonly logger = new Logger(ExportService.name);
//   private readonly MAX_RECORDS_PER_REQUEST = 10000;

//   constructor(private readonly prisma: PrismaService) {}

//   async exportData(filters: ExportDataQueryDto): Promise<ExportResult> {
//     this.validateFilters(filters);

//     const startTime = Date.now();
//     this.logger.log(`Starting ${filters.exportType} export`, { filters });

//     let csvData: string;
//     let actualCount: number;
//     let jsonData: any[];
//     let summary: any;
//     let allRecordsCount: number;
//     let currentPage: number;
//     let totalPages: number;

//     switch (filters.exportType) {
//       case ExportType.DEBT_REPORT:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           summary,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportDebtReport(filters));
//         break;
//       case ExportType.RENEWAL_REPORT:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           summary,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportRenewalReport(filters));
//         break;
//       case ExportType.WEEKLY_SUMMARY:
//         ({ csvData, actualCount, jsonData, summary } =
//           await this.exportWeeklySummary(filters));
//         break;
//       case ExportType.MONTHLY_SUMMARY:
//         ({ csvData, actualCount, jsonData, summary } =
//           await this.exportMonthlySummary(filters));
//         break;
//       case ExportType.SALES:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportSales(filters));
//         break;
//       case ExportType.CUSTOMERS:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportCustomers(filters));
//         break;
//       case ExportType.PAYMENTS:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportPayments(filters));
//         break;
//       case ExportType.DEVICES:
//         ({
//           csvData,
//           actualCount,
//           jsonData,
//           allRecordsCount,
//           currentPage,
//           totalPages,
//         } = await this.exportDevices(filters));
//         break;
//       default:
//         throw new BadRequestException(
//           `Invalid export type: ${filters.exportType}`,
//         );
//     }

//     const endTime = Date.now();
//     this.logger.log(
//       `Export completed in ${endTime - startTime}ms. Records: ${actualCount}`,
//     );

//     return {
//       data: csvData,
//       jsonData,
//       totalRecords: actualCount,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//       exportType: filters.exportType,
//       filters,
//       generatedAt: new Date(),
//       fileSize: Buffer.byteLength(csvData, 'utf8'),
//       summary,
//     };
//   }

//   // ==================== DEBT REPORT ====================
//   private async exportDebtReport(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     summary: any;
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const pipeline: any[] = [
//       {
//         $match: {
//           status: { $in: ['IN_INSTALLMENT', 'COMPLETED'] },
//           deletedAt: null,
//           ...(filters.customerId && {
//             customerId: { $oid: filters.customerId },
//           }),
//           ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
//           ...(filters.salesStatus && { status: filters.salesStatus }),
//         },
//       },
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'customerId',
//           foreignField: '_id',
//           as: 'customer',
//         },
//       },
//       { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: 'agents',
//           localField: 'agentId',
//           foreignField: '_id',
//           as: 'agent',
//         },
//       },
//       { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: 'sales_items',
//           localField: '_id',
//           foreignField: 'saleId',
//           as: 'saleItems',
//         },
//       },
//       {
//         $lookup: {
//           from: 'payments',
//           let: { saleId: '$_id' },
//           pipeline: [
//             {
//               $match: {
//                 $expr: { $eq: ['$saleId', '$$saleId'] },
//                 paymentStatus: 'COMPLETED',
//               },
//             },
//             { $sort: { paymentDate: 1 } },
//           ],
//           as: 'payments',
//         },
//       },
//       {
//         $addFields: {
//           outstandingBalance: { $subtract: ['$totalPrice', '$totalPaid'] },
//           paymentCount: { $size: '$payments' },
//           firstPayment: { $arrayElemAt: ['$payments', 0] },
//           lastPayment: { $arrayElemAt: ['$payments', -1] },
//           saleItem: { $arrayElemAt: ['$saleItems', 0] },
//           monthsSinceSale: {
//             $floor: {
//               $divide: [
//                 {
//                   $subtract: [
//                     new Date(),
//                     { $ifNull: ['$transactionDate', '$createdAt'] },
//                   ],
//                 },
//                 1000 * 60 * 60 * 24 * 30,
//               ],
//             },
//           },
//         },
//       },
//       {
//         $addFields: {
//           isInstallment: { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
//           expectedMonthlyPayments: {
//             $cond: {
//               if: { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
//               then: {
//                 $max: [
//                   0,
//                   {
//                     $min: [
//                       '$monthsSinceSale',
//                       {
//                         $subtract: [
//                           { $ifNull: ['$totalInstallmentDuration', 0] },
//                           1,
//                         ],
//                       },
//                     ],
//                   },
//                 ],
//               },
//               else: 0,
//             },
//           },
//           actualMonthlyPayments: {
//             $cond: {
//               if: { $gt: [{ $size: '$payments' }, 0] },
//               then: { $subtract: [{ $size: '$payments' }, 1] },
//               else: 0,
//             },
//           },
//           daysSinceLastPayment: {
//             $cond: {
//               if: { $gt: [{ $size: '$payments' }, 0] },
//               then: {
//                 $floor: {
//                   $divide: [
//                     { $subtract: [new Date(), '$lastPayment.paymentDate'] },
//                     1000 * 60 * 60 * 24,
//                   ],
//                 },
//               },
//               else: {
//                 $floor: {
//                   $divide: [
//                     { $subtract: [new Date(), '$createdAt'] },
//                     1000 * 60 * 60 * 24,
//                   ],
//                 },
//               },
//             },
//           },
//         },
//       },
//       {
//         $addFields: {
//           missedPayments: {
//             $max: [
//               0,
//               { $subtract: ['$expectedMonthlyPayments', '$actualMonthlyPayments'] },
//             ],
//           },
//           expectedAmountPaid: {
//             $add: [
//               { $ifNull: ['$installmentStartingPrice', 0] },
//               {
//                 $multiply: [
//                   { $ifNull: ['$totalMonthlyPayment', 0] },
//                   '$expectedMonthlyPayments',
//                 ],
//               },
//             ],
//           },
//           isOverdue: {
//             $and: [
//               { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
//               { $gt: ['$outstandingBalance', 0] },
//               {
//                 $or: [
//                   {
//                     $gt: [
//                       {
//                         $subtract: [
//                           '$expectedMonthlyPayments',
//                           '$actualMonthlyPayments',
//                         ],
//                       },
//                       0,
//                     ],
//                   },
//                   { $gt: ['$daysSinceLastPayment', 35] },
//                 ],
//               },
//             ],
//           },
//           paymentDeficit: {
//             $max: [
//               0,
//               {
//                 $subtract: [
//                   {
//                     $add: [
//                       { $ifNull: ['$installmentStartingPrice', 0] },
//                       {
//                         $multiply: [
//                           { $ifNull: ['$totalMonthlyPayment', 0] },
//                           '$expectedMonthlyPayments',
//                         ],
//                       },
//                     ],
//                   },
//                   '$totalPaid',
//                 ],
//               },
//             ],
//           },
//           accurateRemainingMonths: {
//             $cond: {
//               if: { $gt: ['$totalMonthlyPayment', 0] },
//               then: {
//                 $ceil: {
//                   $divide: ['$outstandingBalance', '$totalMonthlyPayment'],
//                 },
//               },
//               else: 0,
//             },
//           },
//         },
//       },
//       {
//         $match: {
//           outstandingBalance: { $gt: 0 },
//           ...(filters.state && {
//             'customer.state': new RegExp(filters.state, 'i'),
//           }),
//           ...(filters.lga && {
//             'customer.lga': new RegExp(filters.lga, 'i'),
//           }),
//           ...(filters.overdueDays && {
//             daysSinceLastPayment: { $gte: filters.overdueDays },
//           }),
//         },
//       },
//     ];

//     // Get total count before pagination
//     const countPipeline = [...pipeline, { $count: 'total' }];
//     const countResult = await this.prisma.sales.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     // Sort before pagination
//     pipeline.push({
//       $sort: { missedPayments: -1, daysSinceLastPayment: -1 },
//     });

//     // Apply pagination
//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     if (filters.page && filters.limit) {
//       pipeline.push({ $skip: (currentPage - 1) * limit }, { $limit: limit });
//     }

//     const results = await this.prisma.sales.aggregateRaw({ pipeline });
//     const debtData = this.extractAggregationResults(results);

//     // Calculate summary
//     const totalOutstandingDebt = debtData.reduce(
//       (sum, sale) => sum + (sale.outstandingBalance || 0),
//       0,
//     );
//     const totalCustomersInDebt = new Set(
//       debtData.map((sale) => this.extractObjectId(sale.customer?._id)),
//     ).size;
//     const overdueCount = debtData.filter((sale) => sale.isOverdue).length;

//     const summary = {
//       totalOutstandingDebt: parseFloat(totalOutstandingDebt.toFixed(2)),
//       totalCustomersInDebt,
//       totalSalesWithDebt: debtData.length,
//       overdueCount,
//       generatedAt: new Date().toISOString(),
//     };

//     // Process JSON data
//     const jsonData = debtData.map((sale) => {
//       const nextPaymentDueDate = this.calculateNextPaymentDueDate(sale);
//       const daysPastDue = nextPaymentDueDate
//         ? Math.max(
//             0,
//             Math.floor(
//               (new Date().getTime() - nextPaymentDueDate.getTime()) /
//                 (1000 * 60 * 60 * 24),
//             ),
//           )
//         : 0;

//       return {
//         customerId: this.extractObjectId(sale.customer?._id) || '',
//         customerName: sale.customer
//           ? `${sale.customer.firstname} ${sale.customer.lastname}`
//           : '',
//         customerPhone: sale.customer?.phone || '',
//         customerEmail: sale.customer?.email || '',
//         saleId: this.extractObjectId(sale._id) || '',
//         transactionDate: this.formatDate(
//           sale.transactionDate || sale.createdAt,
//         ),
//         totalPrice: sale.totalPrice || 0,
//         totalPaid: sale.totalPaid || 0,
//         outstandingBalance: parseFloat(
//           (sale.outstandingBalance || 0).toFixed(2),
//         ),
//         monthlyPayment: sale.totalMonthlyPayment || 0,
//         initialPayment: sale.installmentStartingPrice || 0,
//         totalInstallmentMonths: sale.totalInstallmentDuration || 0,
//         remainingInstallments: sale.remainingInstallments || 0,
//         accurateRemainingMonths: sale.accurateRemainingMonths || 0,
//         totalPaymentsMade: sale.paymentCount || 0,
//         expectedPaymentsByNow: sale.expectedMonthlyPayments || 0,
//         actualMonthlyPaymentsMade: sale.actualMonthlyPayments || 0,
//         missedPayments: sale.missedPayments || 0,
//         expectedAmountPaidByNow: parseFloat(
//           (sale.expectedAmountPaid || 0).toFixed(2),
//         ),
//         actualAmountPaid: sale.totalPaid || 0,
//         paymentDeficit: parseFloat((sale.paymentDeficit || 0).toFixed(2)),
//         isOverdue: sale.isOverdue || false,
//         daysSinceLastPayment: sale.daysSinceLastPayment || 0,
//         nextPaymentDueDate: nextPaymentDueDate
//           ? this.formatDate(nextPaymentDueDate)
//           : '',
//         daysPastDue,
//         lastPaymentDate: this.formatDate(sale.lastPayment?.paymentDate),
//         lastPaymentAmount: sale.lastPayment?.amount || 0,
//         status: sale.status || '',
//         agentName: sale.agentName || '',
//         state: sale.customer?.state || '',
//         lga: sale.customer?.lga || '',
//       };
//     });

//     // Build CSV
//     const headers = [
//       'Customer ID',
//       'Customer Name',
//       'Customer Phone',
//       'Customer Email',
//       'Sale ID',
//       'Transaction Date',
//       'Total Price',
//       'Total Paid',
//       'Outstanding Balance',
//       'Monthly Payment',
//       'Initial Payment',
//       'Total Installment Months',
//       'Remaining Installments',
//       'Accurate Remaining Months',
//       'Total Payments Made',
//       'Expected Payments By Now',
//       'Actual Monthly Payments',
//       'Missed Payments',
//       'Expected Amount Paid By Now',
//       'Actual Amount Paid',
//       'Payment Deficit',
//       'Is Overdue',
//       'Days Since Last Payment',
//       'Next Payment Due Date',
//       'Days Past Due',
//       'Last Payment Date',
//       'Last Payment Amount',
//       'Status',
//       'Agent Name',
//       'State',
//       'LGA',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const item of jsonData) {
//       const row = Object.values(item).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const summaryRows = [
//       'DEBT REPORT SUMMARY',
//       `Generated At: ${new Date().toLocaleString()}`,
//       `Total Outstanding Debt: NGN ${summary.totalOutstandingDebt.toLocaleString()}`,
//       `Total Customers in Debt: ${summary.totalCustomersInDebt}`,
//       `Total Sales with Outstanding Balance: ${summary.totalSalesWithDebt}`,
//       `Overdue Payments: ${summary.overdueCount}`,
//       `Total Records: ${allRecordsCount}`,
//       `Page ${currentPage} of ${totalPages}`,
//       '',
//       '',
//     ];

//     const finalCsv = summaryRows.join('\n') + '\n' + csvRows.join('\n');

//     return {
//       csvData: finalCsv,
//       actualCount: debtData.length,
//       jsonData,
//       summary,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== RENEWAL REPORT ====================
//   private async exportRenewalReport(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     summary: any;
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const overdueDays = filters.overdueDays || 35;

//     const pipeline: any[] = [
//       {
//         $match: {
//           status: 'IN_INSTALLMENT',
//           deletedAt: null,
//           ...(filters.customerId && {
//             customerId: { $oid: filters.customerId },
//           }),
//           ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
//         },
//       },
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'customerId',
//           foreignField: '_id',
//           as: 'customer',
//         },
//       },
//       { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: 'agents',
//           localField: 'agentId',
//           foreignField: '_id',
//           as: 'agent',
//         },
//       },
//       { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: 'sales_items',
//           localField: '_id',
//           foreignField: 'saleId',
//           as: 'saleItems',
//         },
//       },
//       {
//         $lookup: {
//           from: 'payments',
//           let: { saleId: '$_id' },
//           pipeline: [
//             {
//               $match: {
//                 $expr: { $eq: ['$saleId', '$$saleId'] },
//                 paymentStatus: 'COMPLETED',
//               },
//             },
//             { $sort: { paymentDate: 1 } },
//           ],
//           as: 'payments',
//         },
//       },
//       {
//         $addFields: {
//           paymentCount: { $size: '$payments' },
//           lastPayment: { $arrayElemAt: ['$payments', -1] },
//           outstandingBalance: { $subtract: ['$totalPrice', '$totalPaid'] },
//           saleItem: { $arrayElemAt: ['$saleItems', 0] },
//           monthsSinceSale: {
//             $floor: {
//               $divide: [
//                 {
//                   $subtract: [
//                     new Date(),
//                     { $ifNull: ['$transactionDate', '$createdAt'] },
//                   ],
//                 },
//                 1000 * 60 * 60 * 24 * 30,
//               ],
//             },
//           },
//         },
//       },
//       {
//         $addFields: {
//           expectedMonthlyPayments: {
//             $max: [
//               0,
//               {
//                 $min: [
//                   '$monthsSinceSale',
//                   {
//                     $subtract: [
//                       { $ifNull: ['$totalInstallmentDuration', 0] },
//                       1,
//                     ],
//                   },
//                 ],
//               },
//             ],
//           },
//           actualMonthlyPayments: {
//             $cond: {
//               if: { $gt: [{ $size: '$payments' }, 0] },
//               then: { $subtract: [{ $size: '$payments' }, 1] },
//               else: 0,
//             },
//           },
//           daysSinceLastPayment: {
//             $cond: {
//               if: { $gt: [{ $size: '$payments' }, 0] },
//               then: {
//                 $floor: {
//                   $divide: [
//                     { $subtract: [new Date(), '$lastPayment.paymentDate'] },
//                     1000 * 60 * 60 * 24,
//                   ],
//                 },
//               },
//               else: {
//                 $floor: {
//                   $divide: [
//                     { $subtract: [new Date(), '$createdAt'] },
//                     1000 * 60 * 60 * 24,
//                   ],
//                 },
//               },
//             },
//           },
//         },
//       },
//       {
//         $addFields: {
//           missedPayments: {
//             $max: [
//               0,
//               {
//                 $subtract: [
//                   '$expectedMonthlyPayments',
//                   '$actualMonthlyPayments',
//                 ],
//               },
//             ],
//           },
//         },
//       },
//       {
//         $match: {
//           daysSinceLastPayment: { $gt: overdueDays },
//           outstandingBalance: { $gt: 0 },
//           ...(filters.state && {
//             'customer.state': new RegExp(filters.state, 'i'),
//           }),
//           ...(filters.lga && {
//             'customer.lga': new RegExp(filters.lga, 'i'),
//           }),
//         },
//       },
//     ];

//     // Get total count
//     const countPipeline = [...pipeline, { $count: 'total' }];
//     const countResult = await this.prisma.sales.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     // Sort before pagination
//     pipeline.push({ $sort: { missedPayments: -1, daysSinceLastPayment: -1 } });

//     // Apply pagination
//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     if (filters.page && filters.limit) {
//       pipeline.push({ $skip: (currentPage - 1) * limit }, { $limit: limit });
//     }

//     const results = await this.prisma.sales.aggregateRaw({ pipeline });
//     const renewalData = this.extractAggregationResults(results);

//     // Summary
//     const totalDefaulters = renewalData.length;
//     const totalMissedPayments = renewalData.reduce(
//       (sum, sale) => sum + (sale.missedPayments || 0),
//       0,
//     );

//     const summary = {
//       totalDefaulters,
//       totalMissedPayments,
//       overdueDaysThreshold: overdueDays,
//       generatedAt: new Date().toISOString(),
//     };

//     // Process JSON data
//     const jsonData = renewalData.map((sale) => {
//       const missedPayments = sale.missedPayments || 0;
//       const monthlyPayment = sale.totalMonthlyPayment || 0;

//       return {
//         customerId: this.extractObjectId(sale.customer?._id) || '',
//         customerName: sale.customer
//           ? `${sale.customer.firstname} ${sale.customer.lastname}`
//           : '',
//         customerPhone: sale.customer?.phone || '',
//         saleId: this.extractObjectId(sale._id) || '',
//         monthlyPayment,
//         lastPaymentDate: this.formatDate(sale.lastPayment?.paymentDate),
//         daysSinceLastPayment: sale.daysSinceLastPayment || 0,
//         monthsDefaulted: Math.floor((sale.daysSinceLastPayment || 0) / 30),
//         missedPayments,
//         expectedPaymentAmount: monthlyPayment * missedPayments,
//         outstandingBalance: parseFloat(
//           (sale.outstandingBalance || 0).toFixed(2),
//         ),
//         agentName: sale.agentName || '',
//         state: sale.customer?.state || '',
//         lga: sale.customer?.lga || '',
//       };
//     });

//     // Build CSV
//     const headers = [
//       'Customer ID',
//       'Customer Name',
//       'Customer Phone',
//       'Sale ID',
//       'Monthly Payment',
//       'Last Payment Date',
//       'Days Since Last Payment',
//       'Months Defaulted',
//       'Missed Payments',
//       'Expected Payment Amount',
//       'Outstanding Balance',
//       'Agent Name',
//       'State',
//       'LGA',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const item of jsonData) {
//       const row = Object.values(item).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const summaryRows = [
//       'RENEWAL PAYMENT DEFAULTERS REPORT',
//       `Generated At: ${new Date().toLocaleString()}`,
//       `Overdue Threshold: ${overdueDays} days`,
//       `Total Defaulters: ${summary.totalDefaulters}`,
//       `Total Missed Payments: ${summary.totalMissedPayments}`,
//       `Total Records: ${allRecordsCount}`,
//       `Page ${currentPage} of ${totalPages}`,
//       '',
//       '',
//     ];

//     const finalCsv = summaryRows.join('\n') + '\n' + csvRows.join('\n');

//     return {
//       csvData: finalCsv,
//       actualCount: renewalData.length,
//       jsonData,
//       summary,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== WEEKLY SUMMARY ====================
//   private async exportWeeklySummary(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     summary: any;
//   }> {
//     const endDate = filters.endDate || new Date();
//     const startDate =
//       filters.startDate ||
//       new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

//     // New sales pipeline
//     const newSalesPipeline = [
//       {
//         $match: {
//           createdAt: {
//             $gte: { $date: startDate.toISOString() },
//             $lte: { $date: endDate.toISOString() },
//           },
//           deletedAt: null,
//           ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
//         },
//       },
//       {
//         $lookup: {
//           from: 'sales_items',
//           localField: '_id',
//           foreignField: 'saleId',
//           as: 'saleItems',
//         },
//       },
//       { $unwind: { path: '$saleItems', preserveNullAndEmptyArrays: true } },
//       {
//         $group: {
//           _id: null,
//           totalSales: { $sum: 1 },
//           totalCashSales: {
//             $sum: {
//               $cond: [{ $eq: ['$saleItems.paymentMode', 'ONE_OFF'] }, 1, 0],
//             },
//           },
//           totalInstallmentSales: {
//             $sum: {
//               $cond: [
//                 { $eq: ['$saleItems.paymentMode', 'INSTALLMENT'] },
//                 1,
//                 0,
//               ],
//             },
//           },
//           totalRevenue: { $sum: '$totalPrice' },
//           totalCashRevenue: {
//             $sum: {
//               $cond: [
//                 { $eq: ['$saleItems.paymentMode', 'ONE_OFF'] },
//                 '$totalPrice',
//                 0,
//               ],
//             },
//           },
//           totalInstallmentRevenue: {
//             $sum: {
//               $cond: [
//                 { $eq: ['$saleItems.paymentMode', 'INSTALLMENT'] },
//                 '$totalPrice',
//                 0,
//               ],
//             },
//           },
//         },
//       },
//     ];

//     // Renewals pipeline
//     const renewalsPipeline = [
//       {
//         $match: {
//           paymentDate: {
//             $gte: { $date: startDate.toISOString() },
//             $lte: { $date: endDate.toISOString() },
//           },
//           paymentStatus: 'COMPLETED',
//         },
//       },
//       {
//         $lookup: {
//           from: 'sales',
//           localField: 'saleId',
//           foreignField: '_id',
//           as: 'sale',
//         },
//       },
//       { $unwind: '$sale' },
//       ...(filters.agentId
//         ? [{ $match: { 'sale.agentId': { $oid: filters.agentId } } }]
//         : []),
//       {
//         $lookup: {
//           from: 'payments',
//           let: { saleId: '$sale._id' },
//           pipeline: [
//             {
//               $match: {
//                 $expr: { $eq: ['$saleId', '$$saleId'] },
//                 paymentStatus: 'COMPLETED',
//               },
//             },
//             { $sort: { paymentDate: 1 } },
//           ],
//           as: 'allPayments',
//         },
//       },
//       {
//         $addFields: {
//           paymentIndex: { $indexOfArray: ['$allPayments._id', '$_id'] },
//         },
//       },
//       {
//         $match: {
//           'sale.status': { $in: ['IN_INSTALLMENT', 'COMPLETED'] },
//           paymentIndex: { $gt: 0 },
//         },
//       },
//       {
//         $group: {
//           _id: null,
//           totalRenewals: { $sum: 1 },
//           totalRenewalAmount: { $sum: '$amount' },
//         },
//       },
//     ];

//     const newSalesResults = await this.prisma.sales.aggregateRaw({
//       pipeline: newSalesPipeline,
//     });
//     const renewalsResults = await this.prisma.payment.aggregateRaw({
//       pipeline: renewalsPipeline,
//     });

//     const newSalesData = this.extractAggregationResults(newSalesResults)[0] || {
//       totalSales: 0,
//       totalCashSales: 0,
//       totalInstallmentSales: 0,
//       totalRevenue: 0,
//       totalCashRevenue: 0,
//       totalInstallmentRevenue: 0,
//     };

//     const renewalsData = this.extractAggregationResults(renewalsResults)[0] || {
//       totalRenewals: 0,
//       totalRenewalAmount: 0,
//     };

//     const summary = {
//       periodStart: startDate.toISOString(),
//       periodEnd: endDate.toISOString(),
//       newSales: {
//         totalCount: newSalesData.totalSales || 0,
//         cashSalesCount: newSalesData.totalCashSales || 0,
//         installmentSalesCount: newSalesData.totalInstallmentSales || 0,
//         totalRevenue: parseFloat((newSalesData.totalRevenue || 0).toFixed(2)),
//         cashRevenue: parseFloat(
//           (newSalesData.totalCashRevenue || 0).toFixed(2),
//         ),
//         installmentRevenue: parseFloat(
//           (newSalesData.totalInstallmentRevenue || 0).toFixed(2),
//         ),
//       },
//       renewals: {
//         totalCount: renewalsData.totalRenewals || 0,
//         totalAmount: parseFloat(
//           (renewalsData.totalRenewalAmount || 0).toFixed(2),
//         ),
//       },
//       grandTotal: {
//         totalRevenue: parseFloat(
//           (
//             (newSalesData.totalRevenue || 0) +
//             (renewalsData.totalRenewalAmount || 0)
//           ).toFixed(2),
//         ),
//       },
//     };

//     const jsonData = [summary];

//     const csvRows = [
//       'WEEKLY SUMMARY REPORT',
//       `Period: ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`,
//       `Generated At: ${new Date().toLocaleString()}`,
//       '',
//       'NEW SALES',
//       `Total New Sales,${summary.newSales.totalCount}`,
//       `Cash Sales (Quantity),${summary.newSales.cashSalesCount}`,
//       `Installment Sales (Quantity),${summary.newSales.installmentSalesCount}`,
//       `Total Revenue,NGN ${summary.newSales.totalRevenue.toLocaleString()}`,
//       `Cash Sales Revenue,NGN ${summary.newSales.cashRevenue.toLocaleString()}`,
//       `Installment Sales Revenue,NGN ${summary.newSales.installmentRevenue.toLocaleString()}`,
//       '',
//       'RENEWALS/REACTIVATIONS',
//       `Total Renewals,${summary.renewals.totalCount}`,
//       `Total Amount Paid,NGN ${summary.renewals.totalAmount.toLocaleString()}`,
//       '',
//       'GRAND TOTAL',
//       `Combined Revenue,NGN ${summary.grandTotal.totalRevenue.toLocaleString()}`,
//     ];

//     return {
//       csvData: csvRows.join('\n'),
//       actualCount: 1,
//       jsonData,
//       summary,
//     };
//   }

//   // ==================== MONTHLY SUMMARY ====================
//   private async exportMonthlySummary(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     summary: any;
//   }> {
//     const endDate = filters.endDate || new Date();
//     const startDate =
//       filters.startDate ||
//       new Date(endDate.getFullYear(), endDate.getMonth(), 1);

//     const result = await this.exportWeeklySummary({
//       ...filters,
//       startDate,
//       endDate,
//       exportType: ExportType.MONTHLY_SUMMARY,
//     });

//     result.csvData = result.csvData.replace(
//       'WEEKLY SUMMARY REPORT',
//       'MONTHLY SUMMARY REPORT',
//     );

//     return result;
//   }

//   // ==================== SALES EXPORT ====================
//   private async exportSales(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const pipeline = this.buildSalesAggregationPipeline(filters);

//     // Get count
//     const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
//     const countResult = await this.prisma.sales.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     const results = await this.prisma.sales.aggregateRaw({ pipeline });
//     const salesData = this.extractAggregationResults(results);

//     const jsonData = salesData.map((sale) => {
//       const paymentCount = sale.paymentCount || 0;
//       const outstandingBalance = (sale.totalPrice || 0) - (sale.totalPaid || 0);
//       const lastPaymentDate = sale.lastPayment?.paymentDate;
//       const daysSinceLastPayment = lastPaymentDate
//         ? Math.floor(
//             (new Date().getTime() -
//               new Date(lastPaymentDate.$date || lastPaymentDate).getTime()) /
//               (1000 * 60 * 60 * 24),
//           )
//         : null;

//       return {
//         saleId: this.extractObjectId(sale._id) || '',
//         transactionDate: this.formatDate(
//           sale.transactionDate || sale.createdAt,
//         ),
//         status: sale.status || '',
//         agentName: sale.agentName || '',
//         customerName: sale.customer
//           ? `${sale.customer.firstname} ${sale.customer.lastname}`
//           : '',
//         customerPhone: sale.customer?.phone || '',
//         productName: sale.product?.name || '',
//         serialNumber: sale.devices?.[0]?.serialNumber || '',
//         paymentMode: sale.saleItems?.[0]?.paymentMode || '',
//         totalPrice: sale.totalPrice || 0,
//         totalPaid: sale.totalPaid || 0,
//         outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
//         monthlyPayment: sale.totalMonthlyPayment || 0,
//         remainingInstallments: sale.remainingInstallments || 0,
//         paymentCount,
//         lastPaymentDate: this.formatDate(lastPaymentDate),
//         daysSinceLastPayment: daysSinceLastPayment?.toString() || 'N/A',
//         state: sale.customer?.state || '',
//         lga: sale.customer?.lga || '',
//       };
//     });

//     const headers = [
//       'Sale ID',
//       'Transaction Date',
//       'Status',
//       'Agent Name',
//       'Customer Name',
//       'Customer Phone',
//       'Product Name',
//       'Serial Number',
//       'Payment Mode',
//       'Total Price',
//       'Total Paid',
//       'Outstanding Balance',
//       'Monthly Payment',
//       'Remaining Installments',
//       'Payment Count',
//       'Last Payment Date',
//       'Days Since Last Payment',
//       'State',
//       'LGA',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const sale of jsonData) {
//       const row = Object.values(sale).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     return {
//       csvData: csvRows.join('\n'),
//       actualCount: salesData.length,
//       jsonData,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== CUSTOMERS EXPORT ====================
//   private async exportCustomers(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const pipeline = this.buildCustomersAggregationPipeline(filters);

//     // Get count
//     const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
//     const countResult = await this.prisma.customer.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     const results = await this.prisma.customer.aggregateRaw({ pipeline });
//     const customersData = this.extractAggregationResults(results);

//     const jsonData = customersData.map((customer) => ({
//       customerId: this.extractObjectId(customer._id) || '',
//       firstName: customer.firstname || '',
//       lastName: customer.lastname || '',
//       email: customer.email || '',
//       phone: customer.phone || '',
//       state: customer.state || '',
//       lga: customer.lga || '',
//       totalSales: customer.salesCount || 0,
//       totalSpent: customer.totalSpent || 0,
//       outstandingDebt: customer.outstandingDebt || 0,
//       createdDate: this.formatDate(customer.createdAt),
//     }));

//     const headers = [
//       'Customer ID',
//       'First Name',
//       'Last Name',
//       'Email',
//       'Phone',
//       'State',
//       'LGA',
//       'Total Sales',
//       'Total Spent',
//       'Outstanding Debt',
//       'Created Date',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const customer of jsonData) {
//       const row = Object.values(customer).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     return {
//       csvData: csvRows.join('\n'),
//       actualCount: customersData.length,
//       jsonData,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== PAYMENTS EXPORT ====================
//   private async exportPayments(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const pipeline = this.buildPaymentsAggregationPipeline(filters);

//     // Get count
//     const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
//     const countResult = await this.prisma.payment.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     const results = await this.prisma.payment.aggregateRaw({ pipeline });
//     const paymentsData = this.extractAggregationResults(results);

//     const jsonData = paymentsData.map((payment) => ({
//       paymentId: this.extractObjectId(payment._id) || '',
//       transactionReference: payment.transactionRef || '',
//       amount: payment.amount || 0,
//       status: payment.paymentStatus || '',
//       method: payment.paymentMethod || '',
//       paymentDate: this.formatDate(payment.paymentDate),
//       customerName: payment.customer
//         ? `${payment.customer.firstname} ${payment.customer.lastname}`
//         : '',
//       customerPhone: payment.customer?.phone || '',
//       agentName: payment.sale?.agentName || '',
//     }));

//     const headers = [
//       'Payment ID',
//       'Transaction Reference',
//       'Amount',
//       'Status',
//       'Method',
//       'Payment Date',
//       'Customer Name',
//       'Customer Phone',
//       'Agent Name',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const payment of jsonData) {
//       const row = Object.values(payment).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     return {
//       csvData: csvRows.join('\n'),
//       actualCount: paymentsData.length,
//       jsonData,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== DEVICES EXPORT ====================
//   private async exportDevices(
//     filters: ExportDataQueryDto,
//   ): Promise<{
//     csvData: string;
//     actualCount: number;
//     jsonData: any[];
//     allRecordsCount: number;
//     currentPage: number;
//     totalPages: number;
//   }> {
//     const pipeline = this.buildDevicesAggregationPipeline(filters);

//     // Get count
//     const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
//     const countResult = await this.prisma.device.aggregateRaw({
//       pipeline: countPipeline,
//     });
//     const allRecordsCount =
//       this.extractAggregationResults(countResult)[0]?.total || 0;

//     const results = await this.prisma.device.aggregateRaw({ pipeline });
//     const devicesData = this.extractAggregationResults(results);

//     const jsonData = devicesData.map((device) => ({
//       serialNumber: device.serialNumber || '',
//       installationStatus: device.installationStatus || '',
//       customerName: device.customer
//         ? `${device.customer.firstname} ${device.customer.lastname}`
//         : '',
//       customerPhone: device.customer?.phone || '',
//       productName: device.product?.name || '',
//       agentName: device.sale?.agentName || '',
//       createdDate: this.formatDate(device.createdAt),
//     }));

//     const headers = [
//       'Serial Number',
//       'Installation Status',
//       'Customer Name',
//       'Customer Phone',
//       'Product Name',
//       'Agent Name',
//       'Created Date',
//     ];

//     const csvRows = [headers.join(',')];
//     for (const device of jsonData) {
//       const row = Object.values(device).map((val) => this.escapeCSV(val));
//       csvRows.push(row.join(','));
//     }

//     const currentPage = filters.page || 1;
//     const limit = filters.limit || allRecordsCount;
//     const totalPages = Math.ceil(allRecordsCount / limit);

//     return {
//       csvData: csvRows.join('\n'),
//       actualCount: devicesData.length,
//       jsonData,
//       allRecordsCount,
//       currentPage,
//       totalPages,
//     };
//   }

//   // ==================== PIPELINE BUILDERS ====================
//   private buildSalesAggregationPipeline(filters: ExportDataQueryDto): any[] {
//     const pipeline: any[] = [];

//     const matchStage = this.buildSalesMatchStage(filters);
//     if (Object.keys(matchStage).length > 0) {
//       pipeline.push({ $match: matchStage });
//     }

//     pipeline.push(
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'customerId',
//           foreignField: '_id',
//           as: 'customer',
//         },
//       },
//       {
//         $lookup: {
//           from: 'agents',
//           localField: 'agentId',
//           foreignField: '_id',
//           as: 'agent',
//         },
//       },
//       {
//         $lookup: {
//           from: 'sales_items',
//           localField: '_id',
//           foreignField: 'saleId',
//           as: 'saleItems',
//         },
//       },
//       {
//         $lookup: {
//           from: 'devices',
//           localField: 'saleItems.deviceIDs',
//           foreignField: '_id',
//           as: 'devices',
//         },
//       },
//       {
//         $lookup: {
//           from: 'products',
//           localField: 'saleItems.productId',
//           foreignField: '_id',
//           as: 'product',
//         },
//       },
//       {
//         $lookup: {
//           from: 'payments',
//           let: { saleId: '$_id' },
//           pipeline: [
//             {
//               $match: {
//                 $expr: { $eq: ['$saleId', '$saleId'] },
//                 paymentStatus: 'COMPLETED',
//               },
//             },
//             { $sort: { paymentDate: -1 } },
//           ],
//           as: 'payments',
//         },
//       },
//       {
//         $addFields: {
//           customer: { $arrayElemAt: ['$customer', 0] },
//           agent: { $arrayElemAt: ['$agent', 0] },
//           product: { $arrayElemAt: ['$product', 0] },
//           paymentCount: { $size: '$payments' },
//           lastPayment: { $arrayElemAt: ['$payments', 0] },
//         },
//       },
//     );

//     // Sort before pagination
//     pipeline.push({ $sort: { createdAt: -1 } });

//     // Apply pagination
//     if (filters.page && filters.limit) {
//       const skip = (filters.page - 1) * filters.limit;
//       pipeline.push({ $skip: skip }, { $limit: filters.limit });
//     }

//     return pipeline;
//   }

//   private buildCustomersAggregationPipeline(
//     filters: ExportDataQueryDto,
//   ): any[] {
//     const pipeline: any[] = [];

//     const matchStage = this.buildCustomersMatchStage(filters);
//     if (Object.keys(matchStage).length > 0) {
//       pipeline.push({ $match: matchStage });
//     }

//     pipeline.push(
//       {
//         $lookup: {
//           from: 'sales',
//           localField: '_id',
//           foreignField: 'customerId',
//           as: 'sales',
//         },
//       },
//       {
//         $addFields: {
//           salesCount: { $size: '$sales' },
//           totalSpent: { $sum: '$sales.totalPaid' },
//           outstandingDebt: {
//             $sum: {
//               $map: {
//                 input: '$sales',
//                 as: 'sale',
//                 in: { $subtract: ['$sale.totalPrice', '$sale.totalPaid'] },
//               },
//             },
//           },
//         },
//       },
//     );

//     if (filters.hasOutstandingDebt) {
//       pipeline.push({ $match: { outstandingDebt: { $gt: 0 } } });
//     }

//     // Sort before pagination
//     pipeline.push({ $sort: { createdAt: -1 } });

//     // Apply pagination
//     if (filters.page && filters.limit) {
//       const skip = (filters.page - 1) * filters.limit;
//       pipeline.push({ $skip: skip }, { $limit: filters.limit });
//     }

//     return pipeline;
//   }

//   private buildPaymentsAggregationPipeline(filters: ExportDataQueryDto): any[] {
//     const pipeline: any[] = [];

//     const matchStage = this.buildPaymentsMatchStage(filters);
//     if (Object.keys(matchStage).length > 0) {
//       pipeline.push({ $match: matchStage });
//     }

//     pipeline.push(
//       {
//         $lookup: {
//           from: 'sales',
//           localField: 'saleId',
//           foreignField: '_id',
//           as: 'sale',
//         },
//       },
//       {
//         $addFields: {
//           sale: { $arrayElemAt: ['$sale', 0] },
//         },
//       },
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'sale.customerId',
//           foreignField: '_id',
//           as: 'customer',
//         },
//       },
//       {
//         $addFields: {
//           customer: { $arrayElemAt: ['$customer', 0] },
//         },
//       },
//     );

//     // Sort before pagination
//     pipeline.push({ $sort: { paymentDate: -1 } });

//     // Apply pagination
//     if (filters.page && filters.limit) {
//       const skip = (filters.page - 1) * filters.limit;
//       pipeline.push({ $skip: skip }, { $limit: filters.limit });
//     }

//     return pipeline;
//   }

//   private buildDevicesAggregationPipeline(filters: ExportDataQueryDto): any[] {
//     const pipeline: any[] = [];

//     const matchStage = this.buildDevicesMatchStage(filters);
//     if (Object.keys(matchStage).length > 0) {
//       pipeline.push({ $match: matchStage });
//     }

//     pipeline.push(
//       {
//         $lookup: {
//           from: 'sales_items',
//           localField: '_id',
//           foreignField: 'deviceIDs',
//           as: 'saleItems',
//         },
//       },
//       {
//         $lookup: {
//           from: 'sales',
//           localField: 'saleItems.saleId',
//           foreignField: '_id',
//           as: 'sale',
//         },
//       },
//       {
//         $lookup: {
//           from: 'customers',
//           localField: 'sale.customerId',
//           foreignField: '_id',
//           as: 'customer',
//         },
//       },
//       {
//         $lookup: {
//           from: 'products',
//           localField: 'saleItems.productId',
//           foreignField: '_id',
//           as: 'product',
//         },
//       },
//       {
//         $addFields: {
//           sale: { $arrayElemAt: ['$sale', 0] },
//           customer: { $arrayElemAt: ['$customer', 0] },
//           product: { $arrayElemAt: ['$product', 0] },
//         },
//       },
//     );

//     // Sort before pagination
//     pipeline.push({ $sort: { createdAt: -1 } });

//     // Apply pagination
//     if (filters.page && filters.limit) {
//       const skip = (filters.page - 1) * filters.limit;
//       pipeline.push({ $skip: skip }, { $limit: filters.limit });
//     }

//     return pipeline;
//   }

//   // ==================== MATCH STAGE BUILDERS ====================
//   private buildSalesMatchStage(filters: ExportDataQueryDto): any {
//     const match: any = { deletedAt: null };

//     if (filters.startDate || filters.endDate) {
//       match.createdAt = {};
//       if (filters.startDate)
//         match.createdAt.$gte = { $date: filters.startDate.toISOString() };
//       if (filters.endDate)
//         match.createdAt.$lte = { $date: filters.endDate.toISOString() };
//     }

//     if (filters.salesStatus) match.status = filters.salesStatus;
//     if (filters.customerId) match.customerId = { $oid: filters.customerId };
//     if (filters.agentId) match.agentId = { $oid: filters.agentId };

//     return match;
//   }

//   private buildCustomersMatchStage(filters: ExportDataQueryDto): any {
//     const match: any = { deletedAt: null };

//     if (filters.customerId) match._id = { $oid: filters.customerId };
//     if (filters.state) match.state = new RegExp(filters.state, 'i');
//     if (filters.lga) match.lga = new RegExp(filters.lga, 'i');

//     return match;
//   }

//   private buildPaymentsMatchStage(filters: ExportDataQueryDto): any {
//     const match: any = { deletedAt: null };

//     if (filters.paymentMethod) match.paymentMethod = filters.paymentMethod;

//     if (filters.startDate || filters.endDate) {
//       match.paymentDate = {};
//       if (filters.startDate)
//         match.paymentDate.$gte = { $date: filters.startDate.toISOString() };
//       if (filters.endDate)
//         match.paymentDate.$lte = { $date: filters.endDate.toISOString() };
//     }

//     return match;
//   }

//   private buildDevicesMatchStage(filters: ExportDataQueryDto): any {
//     const match: any = {};

//     if (filters.startDate || filters.endDate) {
//       match.createdAt = {};
//       if (filters.startDate)
//         match.createdAt.$gte = { $date: filters.startDate.toISOString() };
//       if (filters.endDate)
//         match.createdAt.$lte = { $date: filters.endDate.toISOString() };
//     }

//     return match;
//   }

//   // ==================== UTILITY METHODS ====================
//   private validateFilters(filters: ExportDataQueryDto): void {
//     if (!filters.exportType) {
//       throw new BadRequestException('Export type is required');
//     }

//     if (filters.page && filters.page < 1) {
//       throw new BadRequestException('Page must be greater than 0');
//     }

//     if (filters.limit && (filters.limit < 1 || filters.limit > 5000)) {
//       throw new BadRequestException('Limit must be between 1 and 5000');
//     }

//     if (
//       filters.startDate &&
//       filters.endDate &&
//       filters.startDate > filters.endDate
//     ) {
//       throw new BadRequestException('Start date must be before end date');
//     }
//   }

//   private extractAggregationResults(results: any): any[] {
//     return Array.isArray(results)
//       ? results
//       : (results as any)?.result || Object.values(results)[0] || [];
//   }

//   private escapeCSV(value: any): string {
//     if (value === null || value === undefined) return '';

//     const stringValue = String(value);

//     if (
//       stringValue.includes(',') ||
//       stringValue.includes('"') ||
//       stringValue.includes('\n')
//     ) {
//       return `"${stringValue.replace(/"/g, '""')}"`;
//     }

//     return stringValue;
//   }

//   private formatDate(date: any): string {
//     if (!date) return '';

//     try {
//       const dateObj = date.$date ? new Date(date.$date) : new Date(date);
//       const day = dateObj.getDate().toString().padStart(2, '0');
//       const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
//       const year = dateObj.getFullYear();
//       return `${day}/${month}/${year}`;
//     } catch {
//       return '';
//     }
//   }

//   private extractObjectId(id: any): string {
//     if (!id) return '';
//     if (typeof id === 'string') return id;
//     if (typeof id === 'object' && id.$oid) return id.$oid;
//     if (typeof id === 'object' && id._bsontype === 'ObjectID')
//       return id.toString();
//     return String(id);
//   }

//   private calculateNextPaymentDueDate(sale: any): Date | null {
//     if (sale.lastPayment?.paymentDate) {
//       const lastPayDate = new Date(
//         sale.lastPayment.paymentDate.$date || sale.lastPayment.paymentDate,
//       );
//       const nextDue = new Date(lastPayDate);
//       nextDue.setMonth(nextDue.getMonth() + 1);
//       return nextDue;
//     } else if (sale.transactionDate) {
//       const transDate = new Date(
//         sale.transactionDate.$date || sale.transactionDate,
//       );
//       const nextDue = new Date(transDate);
//       nextDue.setMonth(nextDue.getMonth() + 1);
//       return nextDue;
//     }
//     return null;
//   }
// }

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
  private readonly MAX_RECORDS_PER_REQUEST = 10000;

  constructor(private readonly prisma: PrismaService) {}

  async exportData(filters: ExportDataQueryDto): Promise<ExportResult> {
    this.validateFilters(filters);

    const startTime = Date.now();
    this.logger.log(`Starting ${filters.exportType} export`, { filters });

    let csvData: string;
    let actualCount: number;
    let jsonData: any[];
    let summary: any;
    let allRecordsCount: number;
    let currentPage: number;
    let totalPages: number;

    switch (filters.exportType) {
      case ExportType.DEBT_REPORT:
        ({
          csvData,
          actualCount,
          jsonData,
          summary,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportDebtReport(filters));
        break;
      case ExportType.RENEWAL_REPORT:
        ({
          csvData,
          actualCount,
          jsonData,
          summary,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportRenewalReport(filters));
        break;
      case ExportType.WEEKLY_SUMMARY:
        ({ csvData, actualCount, jsonData, summary } =
          await this.exportWeeklySummary(filters));
        break;
      case ExportType.MONTHLY_SUMMARY:
        ({ csvData, actualCount, jsonData, summary } =
          await this.exportMonthlySummary(filters));
        break;
      case ExportType.SALES:
        ({
          csvData,
          actualCount,
          jsonData,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportSales(filters));
        break;
      case ExportType.CUSTOMERS:
        ({
          csvData,
          actualCount,
          jsonData,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportCustomers(filters));
        break;
      case ExportType.PAYMENTS:
        ({
          csvData,
          actualCount,
          jsonData,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportPayments(filters));
        break;
      case ExportType.DEVICES:
        ({
          csvData,
          actualCount,
          jsonData,
          allRecordsCount,
          currentPage,
          totalPages,
        } = await this.exportDevices(filters));
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
      jsonData,
      totalRecords: actualCount,
      allRecordsCount,
      currentPage,
      totalPages,
      exportType: filters.exportType,
      filters,
      generatedAt: new Date(),
      fileSize: Buffer.byteLength(csvData, 'utf8'),
      summary,
    };
  }

  // ==================== DEBT REPORT ====================
  // ANSWERS: Yes, this calculates debt INDIVIDUALLY for each sale record
  // If customer has 2 sales, both appear as separate rows in the report
  private async exportDebtReport(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    summary: any;
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const pipeline: any[] = [
      {
        $match: {
          status: { $in: ['IN_INSTALLMENT', 'COMPLETED'] },
          deletedAt: null,
          ...(filters.customerId && {
            customerId: { $oid: filters.customerId },
          }),
          ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
          ...(filters.salesStatus && { status: filters.salesStatus }),
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
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'agents',
          localField: 'agentId',
          foreignField: '_id',
          as: 'agent',
        },
      },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
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
          from: 'payments',
          let: { saleId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$saleId', '$$saleId'] },
                paymentStatus: 'COMPLETED',
              },
            },
            { $sort: { paymentDate: 1 } },
          ],
          as: 'payments',
        },
      },
      {
        $addFields: {
          outstandingBalance: { $subtract: ['$totalPrice', '$totalPaid'] },
          paymentCount: { $size: '$payments' },
          firstPayment: { $arrayElemAt: ['$payments', 0] },
          lastPayment: { $arrayElemAt: ['$payments', -1] },
          saleItem: { $arrayElemAt: ['$saleItems', 0] },
        },
      },
      {
        $addFields: {
          monthsSinceSale: {
            $floor: {
              $divide: [
                {
                  $subtract: [
                    new Date(),
                    {
                      $toDate: {
                        $ifNull: ['$transactionDate', '$createdAt'],
                      },
                    },
                  ],
                },
                2592000000,
              ],
            },
          },
        },
      },
      {
        $addFields: {
          isInstallment: { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
          // Expected monthly payments based on time elapsed
          expectedMonthlyPayments: {
            $cond: {
              if: { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
              then: {
                $max: [
                  0,
                  {
                    $min: [
                      '$monthsSinceSale',
                      {
                        $subtract: [
                          { $ifNull: ['$totalInstallmentDuration', 0] },
                          1, // Subtract 1 for initial payment
                        ],
                      },
                    ],
                  },
                ],
              },
              else: 0,
            },
          },
          // Actual monthly payments (excluding initial)
          actualMonthlyPayments: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: { $subtract: [{ $size: '$payments' }, 1] },
              else: 0,
            },
          },
          // Days since last payment - SAFE VERSION
          daysSinceLastPayment: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: {
                $floor: {
                  $divide: [
                    {
                      $subtract: [
                        new Date(),
                        { $toDate: '$lastPayment.paymentDate' },
                      ],
                    },
                    86400000,
                  ],
                },
              },
              else: {
                $floor: {
                  $divide: [
                    {
                      $subtract: [new Date(), { $toDate: '$createdAt' }],
                    },
                    86400000,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          // Missed payments
          missedPayments: {
            $max: [
              0,
              {
                $subtract: [
                  '$expectedMonthlyPayments',
                  '$actualMonthlyPayments',
                ],
              },
            ],
          },
          // Expected amount paid by now
          expectedAmountPaid: {
            $add: [
              { $ifNull: ['$installmentStartingPrice', 0] },
              {
                $multiply: [
                  { $ifNull: ['$totalMonthlyPayment', 0] },
                  '$expectedMonthlyPayments',
                ],
              },
            ],
          },
          // Is overdue determination
          isOverdue: {
            $and: [
              { $eq: ['$saleItem.paymentMode', 'INSTALLMENT'] },
              { $gt: ['$outstandingBalance', 0] },
              {
                $or: [
                  {
                    $gt: [
                      {
                        $subtract: [
                          '$expectedMonthlyPayments',
                          '$actualMonthlyPayments',
                        ],
                      },
                      0,
                    ],
                  },
                  { $gt: ['$daysSinceLastPayment', 35] },
                ],
              },
            ],
          },
          // Payment deficit
          paymentDeficit: {
            $max: [
              0,
              {
                $subtract: [
                  {
                    $add: [
                      { $ifNull: ['$installmentStartingPrice', 0] },
                      {
                        $multiply: [
                          { $ifNull: ['$totalMonthlyPayment', 0] },
                          '$expectedMonthlyPayments',
                        ],
                      },
                    ],
                  },
                  '$totalPaid',
                ],
              },
            ],
          },
          // Accurate remaining months
          accurateRemainingMonths: {
            $cond: {
              if: { $gt: ['$totalMonthlyPayment', 0] },
              then: {
                $ceil: {
                  $divide: ['$outstandingBalance', '$totalMonthlyPayment'],
                },
              },
              else: 0,
            },
          },
        },
      },
      {
        $match: {
          outstandingBalance: { $gt: 0 },
          ...(filters.state && {
            'customer.state': new RegExp(filters.state, 'i'),
          }),
          ...(filters.lga && {
            'customer.lga': new RegExp(filters.lga, 'i'),
          }),
          ...(filters.overdueDays && {
            daysSinceLastPayment: { $gte: filters.overdueDays },
          }),
        },
      },
    ];

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    // Sort before pagination
    pipeline.push({
      $sort: { missedPayments: -1, daysSinceLastPayment: -1 },
    });

    // Apply pagination
    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;
    const totalPages = Math.ceil(allRecordsCount / limit);

    if (filters.page && filters.limit) {
      pipeline.push({ $skip: (currentPage - 1) * limit }, { $limit: limit });
    }

    const results = await this.prisma.sales.aggregateRaw({
      pipeline,
      options: { allowDiskUse: true },
    });
    const debtData = this.extractAggregationResults(results);

    // Calculate summary - NOTE: This aggregates across ALL sales (even multiple per customer)
    const totalOutstandingDebt = debtData.reduce(
      (sum, sale) => sum + (sale.outstandingBalance || 0),
      0,
    );
    const totalCustomersInDebt = new Set(
      debtData.map((sale) => this.extractObjectId(sale.customer?._id)),
    ).size;
    const overdueCount = debtData.filter((sale) => sale.isOverdue).length;

    const summary = {
      totalOutstandingDebt: parseFloat(totalOutstandingDebt.toFixed(2)),
      totalCustomersInDebt, // Unique customers
      totalSalesWithDebt: debtData.length, // Total sale records
      overdueCount,
      generatedAt: new Date().toISOString(),
    };

    // Process JSON data
    const jsonData = debtData.map((sale) => {
      const nextPaymentDueDate = this.calculateNextPaymentDueDate(sale);
      const daysPastDue = nextPaymentDueDate
        ? Math.max(
            0,
            Math.floor(
              (new Date().getTime() - nextPaymentDueDate.getTime()) / 86400000,
            ),
          )
        : 0;

      return {
        customerId: this.extractObjectId(sale.customer?._id) || '',
        customerName: sale.customer
          ? `${sale.customer.firstname} ${sale.customer.lastname}`
          : '',
        customerPhone: sale.customer?.phone || '',
        customerEmail: sale.customer?.email || '',
        saleId: this.extractObjectId(sale._id) || '',
        transactionDate: this.formatDate(
          sale.transactionDate || sale.createdAt,
        ),
        totalPrice: sale.totalPrice || 0,
        totalPaid: sale.totalPaid || 0,
        outstandingBalance: parseFloat(
          (sale.outstandingBalance || 0).toFixed(2),
        ),
        monthlyPayment: sale.totalMonthlyPayment || 0,
        initialPayment: sale.installmentStartingPrice || 0,
        totalInstallmentMonths: sale.totalInstallmentDuration || 0,
        remainingInstallments: sale.remainingInstallments || 0,
        accurateRemainingMonths: sale.accurateRemainingMonths || 0,
        totalPaymentsMade: sale.paymentCount || 0,
        expectedPaymentsByNow: sale.expectedMonthlyPayments || 0,
        actualMonthlyPaymentsMade: sale.actualMonthlyPayments || 0,
        missedPayments: sale.missedPayments || 0,
        expectedAmountPaidByNow: parseFloat(
          (sale.expectedAmountPaid || 0).toFixed(2),
        ),
        actualAmountPaid: sale.totalPaid || 0,
        paymentDeficit: parseFloat((sale.paymentDeficit || 0).toFixed(2)),
        isOverdue: sale.isOverdue || false,
        daysSinceLastPayment: sale.daysSinceLastPayment || 0,
        nextPaymentDueDate: nextPaymentDueDate
          ? this.formatDate(nextPaymentDueDate)
          : '',
        daysPastDue,
        lastPaymentDate: this.formatDate(sale.lastPayment?.paymentDate),
        lastPaymentAmount: sale.lastPayment?.amount || 0,
        status: sale.status || '',
        agentName: sale.agentName || '',
        state: sale.customer?.state || '',
        lga: sale.customer?.lga || '',
      };
    });

    // Build CSV
    const headers = [
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
      'Initial Payment',
      'Total Installment Months',
      'Remaining Installments',
      'Accurate Remaining Months',
      'Total Payments Made',
      'Expected Payments By Now',
      'Actual Monthly Payments',
      'Missed Payments',
      'Expected Amount Paid By Now',
      'Actual Amount Paid',
      'Payment Deficit',
      'Is Overdue',
      'Days Since Last Payment',
      'Next Payment Due Date',
      'Days Past Due',
      'Last Payment Date',
      'Last Payment Amount',
      'Status',
      'Agent Name',
      'State',
      'LGA',
    ];

    const csvRows = [headers.join(',')];
    for (const item of jsonData) {
      const row = Object.values(item).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const summaryRows = [
      'DEBT REPORT SUMMARY',
      `Generated At: ${new Date().toLocaleString()}`,
      `Total Outstanding Debt: NGN ${summary.totalOutstandingDebt.toLocaleString()}`,
      `Total Customers in Debt: ${summary.totalCustomersInDebt}`,
      `Total Sales with Outstanding Balance: ${summary.totalSalesWithDebt}`,
      `Overdue Payments: ${summary.overdueCount}`,
      `Total Records: ${allRecordsCount}`,
      `Page ${currentPage} of ${totalPages}`,
      '',
      '',
    ];

    const finalCsv = summaryRows.join('\n') + '\n' + csvRows.join('\n');

    return {
      csvData: finalCsv,
      actualCount: debtData.length,
      jsonData,
      summary,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  // ==================== RENEWAL REPORT ====================
  // ANSWERS: Yes, this properly uses totalInstallmentDuration and totalMonthlyPayment
  // to calculate expected vs actual payments
  private async exportRenewalReport(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    summary: any;
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const overdueDays = filters.overdueDays || 35;

    const pipeline: any[] = [
      {
        $match: {
          status: 'IN_INSTALLMENT',
          deletedAt: null,
          ...(filters.customerId && {
            customerId: { $oid: filters.customerId },
          }),
          ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
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
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'agents',
          localField: 'agentId',
          foreignField: '_id',
          as: 'agent',
        },
      },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
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
          from: 'payments',
          let: { saleId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$saleId', '$$saleId'] },
                paymentStatus: 'COMPLETED',
              },
            },
            { $sort: { paymentDate: 1 } },
          ],
          as: 'payments',
        },
      },
      {
        $addFields: {
          paymentCount: { $size: '$payments' },
          lastPayment: { $arrayElemAt: ['$payments', -1] },
          outstandingBalance: { $subtract: ['$totalPrice', '$totalPaid'] },
          saleItem: { $arrayElemAt: ['$saleItems', 0] },
        },
      },
      {
        $addFields: {
          monthsSinceSale: {
            $floor: {
              $divide: [
                {
                  $subtract: [
                    new Date(),
                    {
                      $toDate: {
                        $ifNull: ['$transactionDate', '$createdAt'],
                      },
                    },
                  ],
                },
                2592000000, // milliseconds in 30 days
              ],
            },
          },
        },
      },
      {
        $addFields: {
          // Expected payments based on totalInstallmentDuration
          expectedMonthlyPayments: {
            $max: [
              0,
              {
                $min: [
                  '$monthsSinceSale',
                  {
                    $subtract: [
                      { $ifNull: ['$totalInstallmentDuration', 0] },
                      1,
                    ],
                  },
                ],
              },
            ],
          },
          actualMonthlyPayments: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: { $subtract: [{ $size: '$payments' }, 1] },
              else: 0,
            },
          },
          daysSinceLastPayment: {
            $cond: {
              if: { $gt: [{ $size: '$payments' }, 0] },
              then: {
                $floor: {
                  $divide: [
                    {
                      $subtract: [
                        new Date(),
                        { $toDate: '$lastPayment.paymentDate' },
                      ],
                    },
                    86400000,
                  ],
                },
              },
              else: {
                $floor: {
                  $divide: [
                    {
                      $subtract: [new Date(), { $toDate: '$createdAt' }],
                    },
                    86400000,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          missedPayments: {
            $max: [
              0,
              {
                $subtract: [
                  '$expectedMonthlyPayments',
                  '$actualMonthlyPayments',
                ],
              },
            ],
          },
        },
      },
      {
        $match: {
          daysSinceLastPayment: { $gt: overdueDays },
          outstandingBalance: { $gt: 0 },
          ...(filters.state && {
            'customer.state': new RegExp(filters.state, 'i'),
          }),
          ...(filters.lga && {
            'customer.lga': new RegExp(filters.lga, 'i'),
          }),
        },
      },
    ];

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    // Sort before pagination
    pipeline.push({ $sort: { missedPayments: -1, daysSinceLastPayment: -1 } });

    // Apply pagination
    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;
    const totalPages = Math.ceil(allRecordsCount / limit);

    if (filters.page && filters.limit) {
      pipeline.push({ $skip: (currentPage - 1) * limit }, { $limit: limit });
    }

    const results = await this.prisma.sales.aggregateRaw({
      pipeline,
      options: { allowDiskUse: true },
    });
    const renewalData = this.extractAggregationResults(results);

    // Summary
    const totalDefaulters = renewalData.length;
    const totalMissedPayments = renewalData.reduce(
      (sum, sale) => sum + (sale.missedPayments || 0),
      0,
    );

    const summary = {
      totalDefaulters,
      totalMissedPayments,
      overdueDaysThreshold: overdueDays,
      generatedAt: new Date().toISOString(),
    };

    // Process JSON data
    const jsonData = renewalData.map((sale) => {
      const missedPayments = sale.missedPayments || 0;
      const monthlyPayment = sale.totalMonthlyPayment || 0;

      return {
        customerId: this.extractObjectId(sale.customer?._id) || '',
        customerName: sale.customer
          ? `${sale.customer.firstname} ${sale.customer.lastname}`
          : '',
        customerPhone: sale.customer?.phone || '',
        saleId: this.extractObjectId(sale._id) || '',
        monthlyPayment,
        lastPaymentDate: this.formatDate(sale.lastPayment?.paymentDate),
        daysSinceLastPayment: sale.daysSinceLastPayment || 0,
        monthsDefaulted: Math.floor((sale.daysSinceLastPayment || 0) / 30),
        missedPayments,
        expectedPaymentAmount: monthlyPayment * missedPayments,
        outstandingBalance: parseFloat(
          (sale.outstandingBalance || 0).toFixed(2),
        ),
        agentName: sale.agentName || '',
        state: sale.customer?.state || '',
        lga: sale.customer?.lga || '',
      };
    });

    // Build CSV
    const headers = [
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
    ];

    const csvRows = [headers.join(',')];
    for (const item of jsonData) {
      const row = Object.values(item).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const summaryRows = [
      'RENEWAL PAYMENT DEFAULTERS REPORT',
      `Generated At: ${new Date().toLocaleString()}`,
      `Overdue Threshold: ${overdueDays} days`,
      `Total Defaulters: ${summary.totalDefaulters}`,
      `Total Missed Payments: ${summary.totalMissedPayments}`,
      `Total Records: ${allRecordsCount}`,
      `Page ${currentPage} of ${totalPages}`,
      '',
      '',
    ];

    const finalCsv = summaryRows.join('\n') + '\n' + csvRows.join('\n');

    return {
      csvData: finalCsv,
      actualCount: renewalData.length,
      jsonData,
      summary,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  // ==================== WEEKLY SUMMARY ====================
  private async exportWeeklySummary(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    summary: any;
  }> {
    const endDate = filters.endDate || new Date();
    const startDate =
      filters.startDate ||
      new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newSalesPipeline = [
      {
        $match: {
          createdAt: {
            $gte: { $date: startDate.toISOString() },
            $lte: { $date: endDate.toISOString() },
          },
          deletedAt: null,
          ...(filters.agentId && { agentId: { $oid: filters.agentId } }),
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
      { $unwind: { path: '$saleItems', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalCashSales: {
            $sum: {
              $cond: [{ $eq: ['$saleItems.paymentMode', 'ONE_OFF'] }, 1, 0],
            },
          },
          totalInstallmentSales: {
            $sum: {
              $cond: [{ $eq: ['$saleItems.paymentMode', 'INSTALLMENT'] }, 1, 0],
            },
          },
          totalRevenue: { $sum: '$totalPrice' },
          totalCashRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$saleItems.paymentMode', 'ONE_OFF'] },
                '$totalPrice',
                0,
              ],
            },
          },
          totalInstallmentRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$saleItems.paymentMode', 'INSTALLMENT'] },
                '$totalPrice',
                0,
              ],
            },
          },
        },
      },
    ];

    const renewalsPipeline = [
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
          let: { saleId: '$sale._id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$saleId', '$saleId'] },
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
      {
        $match: {
          'sale.status': { $in: ['IN_INSTALLMENT', 'COMPLETED'] },
          paymentIndex: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalRenewals: { $sum: 1 },
          totalRenewalAmount: { $sum: '$amount' },
        },
      },
    ];

    const newSalesResults = await this.prisma.sales.aggregateRaw({
      pipeline: newSalesPipeline,
    });
    const renewalsResults = await this.prisma.payment.aggregateRaw({
      pipeline: renewalsPipeline,
    });

    const newSalesData = this.extractAggregationResults(newSalesResults)[0] || {
      totalSales: 0,
      totalCashSales: 0,
      totalInstallmentSales: 0,
      totalRevenue: 0,
      totalCashRevenue: 0,
      totalInstallmentRevenue: 0,
    };

    const renewalsData = this.extractAggregationResults(renewalsResults)[0] || {
      totalRenewals: 0,
      totalRenewalAmount: 0,
    };

    const summary = {
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      newSales: {
        totalCount: newSalesData.totalSales || 0,
        cashSalesCount: newSalesData.totalCashSales || 0,
        installmentSalesCount: newSalesData.totalInstallmentSales || 0,
        totalRevenue: parseFloat((newSalesData.totalRevenue || 0).toFixed(2)),
        cashRevenue: parseFloat(
          (newSalesData.totalCashRevenue || 0).toFixed(2),
        ),
        installmentRevenue: parseFloat(
          (newSalesData.totalInstallmentRevenue || 0).toFixed(2),
        ),
      },
      renewals: {
        totalCount: renewalsData.totalRenewals || 0,
        totalAmount: parseFloat(
          (renewalsData.totalRenewalAmount || 0).toFixed(2),
        ),
      },
      grandTotal: {
        totalRevenue: parseFloat(
          (
            (newSalesData.totalRevenue || 0) +
            (renewalsData.totalRenewalAmount || 0)
          ).toFixed(2),
        ),
      },
    };

    const jsonData = [summary];

    const csvRows = [
      'WEEKLY SUMMARY REPORT',
      `Period: ${this.formatDate(startDate)} to ${this.formatDate(endDate)}`,
      `Generated At: ${new Date().toLocaleString()}`,
      '',
      'NEW SALES',
      `Total New Sales,${summary.newSales.totalCount}`,
      `Cash Sales (Quantity),${summary.newSales.cashSalesCount}`,
      `Installment Sales (Quantity),${summary.newSales.installmentSalesCount}`,
      `Total Revenue,NGN ${summary.newSales.totalRevenue.toLocaleString()}`,
      `Cash Sales Revenue,NGN ${summary.newSales.cashRevenue.toLocaleString()}`,
      `Installment Sales Revenue,NGN ${summary.newSales.installmentRevenue.toLocaleString()}`,
      '',
      'RENEWALS/REACTIVATIONS',
      `Total Renewals,${summary.renewals.totalCount}`,
      `Total Amount Paid,NGN ${summary.renewals.totalAmount.toLocaleString()}`,
      '',
      'GRAND TOTAL',
      `Combined Revenue,NGN ${summary.grandTotal.totalRevenue.toLocaleString()}`,
    ];

    return {
      csvData: csvRows.join('\n'),
      actualCount: 1,
      jsonData,
      summary,
    };
  }

  private async exportMonthlySummary(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    summary: any;
  }> {
    const endDate = filters.endDate || new Date();
    const startDate =
      filters.startDate ||
      new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    const result = await this.exportWeeklySummary({
      ...filters,
      startDate,
      endDate,
      exportType: ExportType.MONTHLY_SUMMARY,
    });

    result.csvData = result.csvData.replace(
      'WEEKLY SUMMARY REPORT',
      'MONTHLY SUMMARY REPORT',
    );

    return result;
  }

  private async exportSales(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const pipeline = this.buildSalesAggregationPipeline(filters);

    const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const countResult = await this.prisma.sales.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    const results = await this.prisma.sales.aggregateRaw({
      pipeline,
      options: { allowDiskUse: true },
    });
    const salesData = this.extractAggregationResults(results);

    const jsonData = salesData.map((sale) => {
      const paymentCount = sale.paymentCount || 0;
      const outstandingBalance = (sale.totalPrice || 0) - (sale.totalPaid || 0);
      const lastPaymentDate = sale.lastPayment?.paymentDate;
      const daysSinceLastPayment = lastPaymentDate
        ? Math.floor(
            (new Date().getTime() -
              new Date(lastPaymentDate.$date || lastPaymentDate).getTime()) /
              86400000,
          )
        : null;

      return {
        saleId: this.extractObjectId(sale._id) || '',
        transactionDate: this.formatDate(
          sale.transactionDate || sale.createdAt,
        ),
        status: sale.status || '',
        agentName: sale.agentName || '',
        customerName: sale.customer
          ? `${sale.customer.firstname} ${sale.customer.lastname}`
          : '',
        customerPhone: sale.customer?.phone || '',
        productName: sale.product?.name || '',
        serialNumber: sale.devices?.[0]?.serialNumber || '',
        paymentMode: sale.saleItems?.[0]?.paymentMode || '',
        totalPrice: sale.totalPrice || 0,
        totalPaid: sale.totalPaid || 0,
        outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
        monthlyPayment: sale.totalMonthlyPayment || 0,
        remainingInstallments: sale.remainingInstallments || 0,
        paymentCount,
        lastPaymentDate: this.formatDate(lastPaymentDate),
        daysSinceLastPayment: daysSinceLastPayment?.toString() || 'N/A',
        state: sale.customer?.state || '',
        lga: sale.customer?.lga || '',
      };
    });

    const headers = [
      'Sale ID',
      'Transaction Date',
      'Status',
      'Agent Name',
      'Customer Name',
      'Customer Phone',
      'Product Name',
      'Serial Number',
      'Payment Mode',
      'Total Price',
      'Total Paid',
      'Outstanding Balance',
      'Monthly Payment',
      'Remaining Installments',
      'Payment Count',
      'Last Payment Date',
      'Days Since Last Payment',
      'State',
      'LGA',
    ];

    const csvRows = [headers.join(',')];
    for (const sale of jsonData) {
      const row = Object.values(sale).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;
    const totalPages = Math.ceil(allRecordsCount / limit);

    return {
      csvData: csvRows.join('\n'),
      actualCount: salesData.length,
      jsonData,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  private async exportCustomers(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const pipeline = this.buildCustomersAggregationPipeline(filters);

    const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const countResult = await this.prisma.customer.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    const results = await this.prisma.customer.aggregateRaw({ pipeline });
    const customersData = this.extractAggregationResults(results);

    const jsonData = customersData.map((customer) => ({
      customerId: this.extractObjectId(customer._id) || '',
      firstName: customer.firstname || '',
      lastName: customer.lastname || '',
      email: customer.email || '',
      phone: customer.phone || '',
      state: customer.state || '',
      lga: customer.lga || '',
      totalSales: customer.salesCount || 0,
      totalSpent: customer.totalSpent || 0,
      outstandingDebt: customer.outstandingDebt || 0,
      createdDate: this.formatDate(customer.createdAt),
    }));

    const headers = [
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
    ];

    const csvRows = [headers.join(',')];
    for (const customer of jsonData) {
      const row = Object.values(customer).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;

    console.log({ limit, ff: filters.limit, allRecordsCount });
    const totalPages = Math.ceil(allRecordsCount / limit);

    return {
      csvData: csvRows.join('\n'),
      actualCount: customersData.length,
      jsonData,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  private async exportPayments(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const pipeline = this.buildPaymentsAggregationPipeline(filters);

    const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const countResult = await this.prisma.payment.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    const results = await this.prisma.payment.aggregateRaw({ pipeline });
    const paymentsData = this.extractAggregationResults(results);

    const jsonData = paymentsData.map((payment) => ({
      paymentId: this.extractObjectId(payment._id) || '',
      transactionReference: payment.transactionRef || '',
      amount: payment.amount || 0,
      status: payment.paymentStatus || '',
      method: payment.paymentMethod || '',
      paymentDate: this.formatDate(payment.paymentDate),
      customerName: payment.customer
        ? `${payment.customer.firstname} ${payment.customer.lastname}`
        : '',
      customerPhone: payment.customer?.phone || '',
      agentName: payment.sale?.agentName || '',
    }));

    const headers = [
      'Payment ID',
      'Transaction Reference',
      'Amount',
      'Status',
      'Method',
      'Payment Date',
      'Customer Name',
      'Customer Phone',
      'Agent Name',
    ];

    const csvRows = [headers.join(',')];
    for (const payment of jsonData) {
      const row = Object.values(payment).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;
    const totalPages = Math.ceil(allRecordsCount / limit);

    return {
      csvData: csvRows.join('\n'),
      actualCount: paymentsData.length,
      jsonData,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  private async exportDevices(filters: ExportDataQueryDto): Promise<{
    csvData: string;
    actualCount: number;
    jsonData: any[];
    allRecordsCount: number;
    currentPage: number;
    totalPages: number;
  }> {
    const pipeline = this.buildDevicesAggregationPipeline(filters);

    const countPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const countResult = await this.prisma.device.aggregateRaw({
      pipeline: countPipeline,
    });
    const allRecordsCount =
      this.extractAggregationResults(countResult)[0]?.total || 0;

    const results = await this.prisma.device.aggregateRaw({ pipeline });
    const devicesData = this.extractAggregationResults(results);

    const jsonData = devicesData.map((device) => ({
      serialNumber: device.serialNumber || '',
      installationStatus: device.installationStatus || '',
      customerName: device.customer
        ? `${device.customer.firstname} ${device.customer.lastname}`
        : '',
      customerPhone: device.customer?.phone || '',
      productName: device.product?.name || '',
      agentName: device.sale?.agentName || '',
      createdDate: this.formatDate(device.createdAt),
    }));

    const headers = [
      'Serial Number',
      'Installation Status',
      'Customer Name',
      'Customer Phone',
      'Product Name',
      'Agent Name',
      'Created Date',
    ];

    const csvRows = [headers.join(',')];
    for (const device of jsonData) {
      const row = Object.values(device).map((val) => this.escapeCSV(val));
      csvRows.push(row.join(','));
    }

    const currentPage = filters.page || 1;
    const limit = filters.limit || allRecordsCount;
    const totalPages = Math.ceil(allRecordsCount / limit);

    return {
      csvData: csvRows.join('\n'),
      actualCount: devicesData.length,
      jsonData,
      allRecordsCount,
      currentPage,
      totalPages,
    };
  }

  private buildSalesAggregationPipeline(filters: ExportDataQueryDto): any[] {
    const pipeline: any[] = [];

    const matchStage = this.buildSalesMatchStage(filters);
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

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
            { $sort: { paymentDate: -1 } },
          ],
          as: 'payments',
        },
      },
      {
        $addFields: {
          customer: { $arrayElemAt: ['$customer', 0] },
          agent: { $arrayElemAt: ['$agent', 0] },
          product: { $arrayElemAt: ['$product', 0] },
          paymentCount: { $size: '$payments' },
          lastPayment: { $arrayElemAt: ['$payments', 0] },
        },
      },
    );

    pipeline.push({ $sort: { createdAt: -1 } });

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

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
        $addFields: {
          salesCount: { $size: '$sales' },
          totalSpent: {
            $sum: {
              $map: {
                input: '$sales',
                as: 'sale',
                in: { $ifNull: ['$$sale.totalPaid', 0] },
              },
            },
          },
          outstandingDebt: {
            $sum: {
              $map: {
                input: '$sales',
                as: 'sale',
                in: {
                  $subtract: [
                    { $ifNull: ['$$sale.totalPrice', 0] },
                    { $ifNull: ['$$sale.totalPaid', 0] },
                  ],
                },
              },
            },
          },
        },
      },
    );

    if (filters.hasOutstandingDebt) {
      pipeline.push({ $match: { outstandingDebt: { $gt: 0 } } });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    // ✅ FIX: Apply limit even without page
    if (filters.limit) {
      const skip = filters.page ? (filters.page - 1) * filters.limit : 0;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

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

    pipeline.push({ $sort: { paymentDate: -1 } });

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

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
        $addFields: {
          sale: { $arrayElemAt: ['$sale', 0] },
          customer: { $arrayElemAt: ['$customer', 0] },
          product: { $arrayElemAt: ['$product', 0] },
        },
      },
    );

    pipeline.push({ $sort: { createdAt: -1 } });

    if (filters.page && filters.limit) {
      const skip = (filters.page - 1) * filters.limit;
      pipeline.push({ $skip: skip }, { $limit: filters.limit });
    }

    return pipeline;
  }

  private buildSalesMatchStage(filters: ExportDataQueryDto): any {
    const match: any = { deletedAt: null };

    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate)
        match.createdAt.$gte = { $date: filters.startDate.toISOString() };
      if (filters.endDate)
        match.createdAt.$lte = { $date: filters.endDate.toISOString() };
    }

    if (filters.salesStatus) match.status = filters.salesStatus;
    if (filters.customerId) match.customerId = { $oid: filters.customerId };
    if (filters.agentId) match.agentId = { $oid: filters.agentId };

    return match;
  }

  private buildCustomersMatchStage(filters: ExportDataQueryDto): any {
    const match: any = { deletedAt: null };

    if (filters.customerId) match._id = { $oid: filters.customerId };
    if (filters.state) match.state = new RegExp(filters.state, 'i');
    if (filters.lga) match.lga = new RegExp(filters.lga, 'i');

    return match;
  }

  private buildPaymentsMatchStage(filters: ExportDataQueryDto): any {
    const match: any = { deletedAt: null };

    if (filters.paymentMethod) match.paymentMethod = filters.paymentMethod;

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

    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate)
        match.createdAt.$gte = { $date: filters.startDate.toISOString() };
      if (filters.endDate)
        match.createdAt.$lte = { $date: filters.endDate.toISOString() };
    }

    return match;
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

  private extractAggregationResults(results: any): any[] {
    return Array.isArray(results)
      ? results
      : (results as any)?.result || Object.values(results)[0] || [];
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

  private calculateNextPaymentDueDate(sale: any): Date | null {
    if (sale.lastPayment?.paymentDate) {
      const lastPayDate = new Date(
        sale.lastPayment.paymentDate.$date || sale.lastPayment.paymentDate,
      );
      const nextDue = new Date(lastPayDate);
      nextDue.setMonth(nextDue.getMonth() + 1);
      return nextDue;
    } else if (sale.transactionDate) {
      const transDate = new Date(
        sale.transactionDate.$date || sale.transactionDate,
      );
      const nextDue = new Date(transDate);
      nextDue.setMonth(nextDue.getMonth() + 1);
      return nextDue;
    }
    return null;
  }
}
