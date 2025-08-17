import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { SalesStatus } from '@prisma/client';

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
}
