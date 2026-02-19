import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/mailer/email.service';

export interface TokenReconciliationRow {
  saleId: string;
  customerName: string;
  customerPhone: string;
  agentName: string;
  agentPhone: string;
  paymentCount: number;
  paymentDetails: string;
  deviceSerial: string;
  deviceTokenCount: number;
  deviceTokenDetails: string;
  monthlyTokenCount: number;
  tokenPaymentDiscrepancy: number;
  discrepancyStatus: 'MATCH' | 'SURPLUS_TOKENS' | 'SURPLUS_PAYMENTS';
}

interface TokenData {
  token: string;
  generatedDate: Date;
}

interface PaymentData {
  reference: string;
  paymentDate: Date;
  amount: number;
}

@Injectable()
export class TokenReconciliationService {
  private readonly logger = new Logger(TokenReconciliationService.name);

  constructor(
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue('device-processing') private readonly deviceQueue: Queue,
  ) {}

  /**
   * Initiate token reconciliation export (returns immediately, processes in background)
   */
  async initiateTokenReconciliationExport(
    targetEmail: string = 'francisalexander000@gmail.com',
  ): Promise<{ jobId: string; message: string }> {
    try {
      const job = await this.deviceQueue.add(
        'export-token-reconciliation',
        {
          email: targetEmail,
          timestamp: new Date(),
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Token reconciliation export job queued: ${job.id} for ${targetEmail}`,
      );

      return {
        jobId: job.id.toString(),
        message: `Token reconciliation report generation started. Email will be sent to ${targetEmail} shortly.`,
      };
    } catch (error) {
      this.logger.error('Error queuing token reconciliation export', error);
      throw new BadRequestException(
        'Failed to queue token reconciliation export',
      );
    }
  }

  /**
   * Process token reconciliation export (runs in background via bull queue)
   */
  async processTokenReconciliationExport(
    targetEmail: string,
  ): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    this.logger.log(
      `Starting token reconciliation export for email: ${targetEmail}`,
    );

    try {
      // Get all installment sales with smart aggregation
      const sales = await this.getInstallmentSalesWithTokens();

      this.logger.log(
        `Found ${sales.length} installment sales with sale items`,
      );

      if (sales.length === 0) {
        this.logger.warn('No installment sales found for token reconciliation');
        return {
          success: false,
          message: 'No installment sales found',
        };
      }

      // Build reconciliation data
      const reconciliationData = await this.buildReconciliationData(sales);

      this.logger.log(
        `Built ${reconciliationData.length} reconciliation rows from ${sales.length} sales`,
      );

      if (reconciliationData.length === 0) {
        this.logger.warn('No reconciliation data generated');
        return {
          success: false,
          message: 'No device-sale records found for reconciliation',
        };
      }

      // Generate CSV
      const csvContent =
        this.generateTokenReconciliationCSV(reconciliationData);

      // Send email asynchronously (fire and forget for the user)
      this.sendEmailWithCSV(targetEmail, csvContent).catch((error) => {
        this.logger.error(
          `Failed to send token reconciliation email to ${targetEmail}`,
          error,
        );
      });

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      this.logger.log(
        `Token reconciliation export completed in ${duration}s. Records: ${reconciliationData.length}. Email queued for delivery.`,
      );

      return {
        success: true,
        message: `Token reconciliation report generated with ${reconciliationData.length} records. Email being sent to ${targetEmail}.`,
      };
    } catch (error) {
      this.logger.error('Error processing token reconciliation export', error);
      throw error;
    }
  }

  /**
   * Get all installment sales with aggregated tokens using smart queries
   */

  private async getInstallmentSalesWithTokens(): Promise<any[]> {
    const startTime = Date.now();
    this.logger.log('⏳ Starting optimized sales aggregation...');

    try {
      const step1Start = Date.now();

      const sales = await this.prisma.sales.findMany({
        where: {
          status: 'IN_INSTALLMENT',
        },
        select: {
          id: true,
          formattedSaleId: true,
          customerId: true,
          creatorId: true,
          agentName: true,
          totalMonthlyPayment: true,
        },
      });

      const step1Time = Date.now() - step1Start;
      this.logger.log(
        `✅ Step 1: Fetched ${sales.length} sales in ${step1Time}ms`,
      );

      if (sales.length === 0) {
        this.logger.warn('No installment sales found');
        return [];
      }

      const saleIds = sales.map((s) => s.id);
      const customerIds = sales
        .map((s) => s.customerId)
        .filter(Boolean) as string[];
      const creatorIds = sales.map((s) => s.creatorId).filter(Boolean) as string[];

      const step2Start = Date.now();


      // The below queries should ideally run in parallel but they made this was to properly track slow data retrievals

      const items = await this.prisma.saleItem.findMany({
        where: { saleId: { in: saleIds } },
        select: {
          id: true,
          saleId: true,
          productId: true,
          quantity: true,
          deviceIDs: true, 
        },
      })

      this.logger.log(
        `✅ Fetched ${items.length} sale items `,
      );

      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          email: true,
          type: true,
        },
      })

      this.logger.log(
        `✅ Fetched ${customers.length} customers `,
      );


      const payments = await this.prisma.payment.findMany({
        where: {
          saleId: { in: saleIds },
          paymentStatus: 'COMPLETED',
        },
        select: {
          id: true,
          saleId: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          transactionRef: true,
          createdAt: true,
        },
      })

      this.logger.log(
        `✅ Fetched ${payments.length} payments `,
      );

      const agents = await this.prisma.agent.findMany({
        where: { userId: { in: creatorIds } },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              email: true,
            },
          },
        },
      });

      this.logger.log(
        `✅ Fetched ${agents.length} agents `,
      );

      const step2Time = Date.now() - step2Start;
      this.logger.log(
        `✅ Step 2: Batch loaded data in ${step2Time}ms - ${items.length} items, ${customers.length} customers, ${agents.length} agents, ${payments.length} payments`,
      );
      const step3Start = Date.now();

      // Map: saleId → [items]
      const itemsMap = new Map<string, any[]>();
      items.forEach((item) => {
        if (!itemsMap.has(item.saleId)) {
          itemsMap.set(item.saleId, []);
        }
        itemsMap.get(item.saleId)!.push(item);
      });

      // Map: customerId → customer
      const customersMap = new Map<string, any>();
      customers.forEach((c) => customersMap.set(c.id, c));

      // Map: agentId → agent (with user)
      const agentsMap = new Map<string, any>();
      agents.forEach((a) => agentsMap.set(a.user.id, a));

      // Map: saleId → [payments]
      const paymentsMap = new Map<string, any[]>();
      payments.forEach((p) => {
        if (!paymentsMap.has(p.saleId)) {
          paymentsMap.set(p.saleId, []);
        }
        paymentsMap.get(p.saleId)!.push(p);
      });

      const step3Time = Date.now() - step3Start;
      this.logger.debug(`   Step 3: Created maps in ${step3Time}ms`);

      const step4Start = Date.now();

      const enrichedSales = sales
        .filter((sale) => itemsMap.has(sale.id)) // Only sales with items
        .map((sale) => {
          const agent = agentsMap.get(sale.creatorId);

          return {
            id: sale.id,
            formattedSaleId: sale.formattedSaleId,
            customerId: sale.customerId,
            agentId: agent.id,
            agentName: sale.agentName,
            totalMonthlyPayment: sale.totalMonthlyPayment,
            // Enriched data:
            saleItems: itemsMap.get(sale.id) || [],
            customer: customersMap.get(sale.customerId) || {
              firstname: '',
              lastname: '',
              phone: '',
            },
            agent: agent || null,
            agentUser: agent?.user || null,
            payments: paymentsMap.get(sale.id) || [],
          };
        });

      const step4Time = Date.now() - step4Start;
      const totalTime = Date.now() - startTime;

      this.logger.log(
        `✅ Step 4: Enriched ${enrichedSales.length} sales in ${step4Time}ms`,
      );
      this.logger.log(
        `🎯 Total aggregation time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`,
      );

      // Log breakdown for debugging
      this.logger.debug(
        `   Breakdown: Step1=${step1Time}ms, Step2=${step2Time}ms, Step3=${step3Time}ms, Step4=${step4Time}ms`,
      );

      return enrichedSales;
    } catch (error) {
      this.logger.error('Error in optimized sales aggregation:', error);
      throw error;
    }
  }

  /**
   * Build reconciliation data with device tokens and payments
   */
  private async buildReconciliationData(
    sales: any[],
  ): Promise<TokenReconciliationRow[]> {
    const reconciliationRows: TokenReconciliationRow[] = [];

    // Extract all device IDs in one pass
    const allDeviceIds: string[] = [];
    const saleToDeviceMap = new Map<string, string[]>();

    sales.forEach((sale) => {
      // const saleId = this.extractObjectId(sale._id);
      const saleId = sale.id
      const deviceIds: string[] = [];

      sale.saleItems.forEach((item) => {
        if (item.deviceIDs && Array.isArray(item.deviceIDs)) {
          // IMPORTANT: Convert each deviceID to string (may be ObjectId)
          const convertedIds = item.deviceIDs.map((id) =>
            this.extractObjectId(id),
          );
          deviceIds.push(...convertedIds);
          allDeviceIds.push(...convertedIds);
        }
      });

      if (deviceIds.length > 0) {
        saleToDeviceMap.set(saleId, deviceIds);
      }
    });

    this.logger.debug(
      `Extracted ${allDeviceIds.length} device IDs from ${sales.length} sales (${saleToDeviceMap.size} sales with devices)`,
    );

    if (allDeviceIds.length === 0) {
      this.logger.warn(
        'No device IDs found in any sale items - this is why reconciliation data is empty',
      );
      return [];
    }

    // Fetch all device tokens at once with smart batching
    const deviceTokenMap = await this.getDeviceTokensAggregated([
      ...new Set(allDeviceIds),
    ]);

    this.logger.debug(
      `Retrieved token data for ${deviceTokenMap.size} devices out of ${new Set(allDeviceIds).size} unique devices`,
    );

    // Process each sale
    for (const sale of sales) {
      // const saleId = this.extractObjectId(sale._id);
      const saleId = sale.id;
      const deviceIds = saleToDeviceMap.get(saleId) || [];

      if (deviceIds.length === 0) continue;

      // Get customer info
      const customer = sale.customer;
      const customerName = customer
        ? `${customer.firstname || ''} ${customer.lastname || ''}`.trim()
        : '';
      const customerPhone = customer?.phone || '';

      // Get agent info
      const agentName = sale.agentName?.trim()
        ? sale.agentName
        : sale.agentUser
          ? `${sale.agentUser.firstname || ''} ${sale.agentUser.lastname || ''}`.trim()
          : '';
      const agentPhone = sale.agentUser?.phone || '';

      // Get payment info
      const payments: PaymentData[] = (sale.payments || []).map((p) => ({
        reference: p.transactionRef || p._id?.toString() || 'N/A',
        paymentDate: p.paymentDate
          ? new Date(p.paymentDate)
          : new Date(p.createdAt),
        amount: p.amount || 0,
      }));

      const paymentDetails = this.formatPaymentDetails(payments);
      const paymentCount = payments.length;

      // Process each device for this sale
      for (const deviceId of deviceIds) {
        const deviceTokenData = deviceTokenMap.get(deviceId);
        if (!deviceTokenData) {
          // this.logger.debug(
          //   `No token data found for device ${deviceId} in sale ${saleId}`,
          // );
          continue;
        }

        const deviceTokens = deviceTokenData.tokens || [];
        const deviceSerial = deviceTokenData.serialNumber || '';

        const deviceTokenCount = deviceTokens.length;
        const monthlyTokenCount = this.calculateMonthlyTokenCount(deviceTokens);
        const tokenPaymentDiscrepancy = deviceTokenCount - paymentCount;

        const discrepancyStatus =
          tokenPaymentDiscrepancy > 0
            ? 'SURPLUS_TOKENS'
            : tokenPaymentDiscrepancy < 0
              ? 'SURPLUS_PAYMENTS'
              : 'MATCH';

        const row: TokenReconciliationRow = {
          saleId: sale.formattedSaleId || saleId,
          customerName,
          customerPhone,
          agentName,
          agentPhone,
          paymentCount,
          paymentDetails,
          deviceSerial,
          deviceTokenCount,
          deviceTokenDetails: this.formatDeviceTokenDetails(deviceTokens),
          monthlyTokenCount,
          tokenPaymentDiscrepancy,
          discrepancyStatus,
        };

        reconciliationRows.push(row);
      }
    }

    return reconciliationRows;
  }

  private async getDeviceTokensAggregated(
    deviceIds: string[],
  ): Promise<Map<string, { serialNumber: string; tokens: TokenData[] }>> {
    const map = new Map<
      string,
      { serialNumber: string; tokens: TokenData[] }
    >();

    if (deviceIds.length === 0) return map;

    try {
      this.logger.debug(
        `Fetching tokens for ${deviceIds.length} unique devices`,
      );

      // STEP 1: First query - Find which devices actually have tokens
      // This filters the list to only devices that exist AND have tokens
      const devicesWithTokens = await this.prisma.device.findMany({
        where: {
          id: {
            in: deviceIds,
          },
          tokens: {
            some: {}, // Only devices that have at least one token
          },
        },
        select: {
          id: true,
          serialNumber: true,
        },
      });

      this.logger.log(
        `🔍 Found ${devicesWithTokens.length} devices with tokens (out of ${deviceIds.length} requested)`,
      );

      if (devicesWithTokens.length === 0) {
        this.logger.warn(
          `⚠️ No devices found with tokens. Checking if devices exist at all...`,
        );

        // Debug: Check if devices exist (but just don't have tokens)
        const allDevices = await this.prisma.device.findMany({
          where: { id: { in: deviceIds } },
          select: { id: true, serialNumber: true },
        });

        this.logger.warn(
          `⚠️ ${allDevices.length} devices exist in database but have NO tokens`,
        );

        return map;
      }

      // STEP 2: Second query - Fetch full device data with tokens
      // Only fetch the devices we know have tokens
      const deviceIdsWithTokens = devicesWithTokens.map((d) => d.id);

      const devicesFullData = await this.prisma.device.findMany({
        where: {
          id: {
            in: deviceIdsWithTokens,
          },
        },
        include: {
          tokens: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

      console.log({ devicesFullData: devicesFullData[0] });

      this.logger.log(
        `✅ Retrieved full data for ${devicesFullData.length} devices with tokens`,
      );

      // Map the data
      devicesFullData.forEach((device) => {
        const tokens: TokenData[] = (device.tokens || []).map((t) => ({
          token: t.token,
          generatedDate: new Date(t.createdAt),
        }));

        map.set(device.id, {
          serialNumber: device.serialNumber,
          tokens,
        });

        this.logger.debug(
          `   Device ${device.serialNumber} (${device.id}) has ${tokens.length} tokens`,
        );
      });

      // Report devices that don't have tokens
      const devicesWithoutTokens = deviceIds.filter(
        (id) => !deviceIdsWithTokens.includes(id),
      );
      if (devicesWithoutTokens.length > 0) {
        this.logger.warn(
          `⚠️ ${devicesWithoutTokens.length} devices without tokens: ${devicesWithoutTokens.slice(0, 3).join(', ')}${devicesWithoutTokens.length > 3 ? '...' : ''}`,
        );
      }

      return map;
    } catch (error) {
      this.logger.error(
        `Error fetching device tokens for ${deviceIds.length} devices:`,
        error,
      );
      return map;
    }
  }

  /**
   * Calculate unique month count for tokens
   */
  private calculateMonthlyTokenCount(tokens: TokenData[]): number {
    const uniqueMonths = new Set<string>();

    tokens.forEach((token) => {
      const year = token.generatedDate.getFullYear();
      const month = (token.generatedDate.getMonth() + 1)
        .toString()
        .padStart(2, '0');
      uniqueMonths.add(`${year}-${month}`);
    });

    return uniqueMonths.size;
  }

  /**
   * Format payment details
   */
  private formatPaymentDetails(payments: PaymentData[]): string {
    if (payments.length === 0) return '(0) No payments';

    const details = payments.map((p) => {
      const dateStr = this.formatDate(p.paymentDate);
      return `${p.reference} (${dateStr})`;
    });

    return `(${payments.length}) ${details.join(', ')}`;
  }

  /**
   * Format device token details
   */
  private formatDeviceTokenDetails(tokens: TokenData[]): string {
    if (tokens.length === 0) return '(0) No tokens';

    const details = tokens.map((t) => {
      const dateStr = this.formatDate(t.generatedDate);
      return `${t.token} (${dateStr})`;
    });

    return `(${tokens.length}) ${details.join(', ')}`;
  }

  /**
   * Generate CSV with comprehensive headers
   */
  private generateTokenReconciliationCSV(
    data: TokenReconciliationRow[],
  ): string {
    const headers = [
      'Sale ID',
      'Customer Name',
      'Customer Phone',
      'Agent Name',
      'Agent Phone',
      'Payments (Count)',
      'Payment Details (Reference & Date)',
      'Device Serial',
      'Device Tokens (Count)',
      'Device Token Details (Token & Date)',
      'Monthly Token Count',
      'Token-Payment Discrepancy',
      'Discrepancy Status',
    ];

    const csvRows = [headers.join(',')];

    // Add summary section
    const summary = this.calculateSummary(data);
    const summaryRows = [
      '',
      'SUMMARY',
      `Total Sales Reviewed,${summary.totalSales}`,
      `Total Devices Analyzed,${summary.totalDevices}`,
      `Perfect Match (No Discrepancy),${summary.perfectMatches}`,
      `Surplus Tokens (More tokens than payments),${summary.surplusTokens}`,
      `Surplus Payments (More payments than tokens),${summary.surplusPayments}`,
      `Total Discrepancies,${summary.totalDiscrepancies}`,
      `Total Tokens Generated,${summary.totalTokens}`,
      `Total Payments Made,${summary.totalPayments}`,
      `Overall Discrepancy,${summary.overallDiscrepancy}`,
      '',
      'GENERATED AT,' + new Date().toLocaleString(),
    ];

    // Add data rows
    data.forEach((row) => {
      const csvRow = [
        this.escapeCSV(row.saleId),
        this.escapeCSV(row.customerName),
        this.escapeCSV(row.customerPhone),
        this.escapeCSV(row.agentName),
        this.escapeCSV(row.agentPhone),
        row.paymentCount,
        this.escapeCSV(row.paymentDetails),
        this.escapeCSV(row.deviceSerial),
        row.deviceTokenCount,
        this.escapeCSV(row.deviceTokenDetails),
        row.monthlyTokenCount,
        row.tokenPaymentDiscrepancy,
        row.discrepancyStatus,
      ];

      csvRows.push(csvRow.join(','));
    });

    return summaryRows.join('\n') + '\n\n' + csvRows.join('\n');
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(data: TokenReconciliationRow[]): {
    totalSales: number;
    totalDevices: number;
    perfectMatches: number;
    surplusTokens: number;
    surplusPayments: number;
    totalDiscrepancies: number;
    totalTokens: number;
    totalPayments: number;
    overallDiscrepancy: number;
  } {
    const totalSales = new Set(data.map((r) => r.saleId)).size;
    const totalDevices = data.length;
    const perfectMatches = data.filter(
      (r) => r.discrepancyStatus === 'MATCH',
    ).length;
    const surplusTokens = data.filter(
      (r) => r.discrepancyStatus === 'SURPLUS_TOKENS',
    ).length;
    const surplusPayments = data.filter(
      (r) => r.discrepancyStatus === 'SURPLUS_PAYMENTS',
    ).length;
    const totalDiscrepancies = surplusTokens + surplusPayments;
    const totalTokens = data.reduce((sum, r) => sum + r.deviceTokenCount, 0);
    const totalPayments = data.reduce((sum, r) => sum + r.paymentCount, 0);
    const overallDiscrepancy = totalTokens - totalPayments;

    return {
      totalSales,
      totalDevices,
      perfectMatches,
      surplusTokens,
      surplusPayments,
      totalDiscrepancies,
      totalTokens,
      totalPayments,
      overallDiscrepancy,
    };
  }

  /**
   * Send email with CSV attachment
   */
  private async sendEmailWithCSV(
    targetEmail: string,
    csvContent: string,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `token-reconciliation-${timestamp}.csv`;

      await this.Email.sendMail({
        from: this.config.get<string>('MAIL_FROM'),
        to: targetEmail,
        subject: `Token Reconciliation Report - ${timestamp}`,
        html: `
          <h2>Token Reconciliation Report</h2>
          <p>Please find attached the token reconciliation report for device token-payment discrepancy analysis.</p>
          <p><strong>Report Summary:</strong></p>
          <ul>
            <li>This report identifies discrepancies between generated device tokens and recorded payments</li>
            <li>Surplus Tokens: More tokens generated than payments recorded (possible manual token generation or failed payment logging)</li>
            <li>Surplus Payments: More payments recorded than tokens (possible payment duplication or missing token logs)</li>
            <li>Monthly Token Count: Number of unique months in which tokens were generated for that device</li>
          </ul>
          <p><strong>Generated At:</strong> ${new Date().toLocaleString()}</p>
          <p>Best regards,<br>System</p>
        `,
        attachments: [
          {
            filename,
            content: Buffer.from(csvContent),
            contentType: 'text/csv',
          },
        ],
      });

      this.logger.log(
        `Token reconciliation report sent successfully to ${targetEmail}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send token reconciliation email to ${targetEmail}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Format date
   */
  private formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }

  /**
   * Extract object ID - handles both strings and ObjectId objects
   */
  private extractObjectId(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (typeof id === 'object' && id.$oid) return id.$oid;
    if (typeof id === 'object' && id.toString) {
      const str = id.toString();
      // Check if it's a valid MongoDB ObjectId string
      if (/^[0-9a-f]{24}$/i.test(str)) {
        return str;
      }
    }
    return String(id);
  }

  /**
   * Escape CSV values
   */
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
}
