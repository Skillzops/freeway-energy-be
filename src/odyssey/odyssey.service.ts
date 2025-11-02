import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OdysseyPaymentDto, OdysseyPaymentQueryDto } from './dto/odyssey.dto';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class OdysseyService {
  private readonly logger = new Logger(OdysseyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPayments(query: OdysseyPaymentQueryDto): Promise<any> {
    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          paymentDate: {
            gte: query.from,
            lte: query.to,
          },
          paymentStatus: PaymentStatus.COMPLETED,
          // sale: {},
          NOT: {
            // sale: null,
            sale: {
              customer: null,
            },
          },
          // sale: {
          //   customer: { isNot: null },
          // },
          deletedAt: { isSet: false },
        },
        // include: {
        //   sale: {
        //     include: {
        //       customer: true,
        //       saleItems: {
        //         include: {
        //           devices: true,
        //           product: true,
        //         },
        //       },
        //       creatorDetails: true,
        //     },
        //   },
        // },
        include: {
          sale: {
            select: {
              id: true,
              totalPaid: true,
              totalPrice: true,
              status: true,
              saleItems: {
                select: {
                  id: true,
                  devices: {
                    select: {
                      serialNumber: true,
                    },
                  },
                },
              },
              customer: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  longitude: true,
                  latitude: true,
                },
              },
            },
          },
        },
        orderBy: {
          paymentDate: 'asc',
        },
      });

      // Transform payments to Odyssey format
      const odysseyPayments: OdysseyPaymentDto[] = [];

      for (const payment of payments) {
        const odysseyPayment = await this.transformToOdysseyFormat(payment);

        // Apply optional filters
        if (this.shouldIncludePayment(odysseyPayment, query)) {
          odysseyPayments.push(odysseyPayment);
        }
      }

      console.log(`Transformed ${odysseyPayments.length} payments for Odyssey`);

      return {
        payments: odysseyPayments,
        errors: '',
      };
    } catch (error) {
      console.error('Error fetching payments for Odyssey', error);
      return {
        payments: [],
        errors: `Error fetching payments: ${error.message}`,
      };
    }
  }

  async validateApiToken(token: string): Promise<boolean> {
    try {
      // Check if token exists in our API tokens table
      const apiToken = await this.prisma.apiAuthToken.findFirst({
        where: {
          token,
          isActive: true,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

      if (apiToken) {
        // Update last used timestamp
        await this.prisma.apiAuthToken.update({
          where: { id: apiToken.id },
          data: { lastUsedAt: new Date() },
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error validating API token', error);
      return false;
    }
  }

  private async transformToOdysseyFormat(
    payment: any,
  ): Promise<OdysseyPaymentDto> {
    const sale = payment.sale;
    const customer = sale.customer;
    const saleItem = sale.saleItems[0]; // Assuming primary sale item
    const device = saleItem?.devices[0]; // Primary device

    // Determine transaction type based on payment and sale data
    const transactionType = this.determineTransactionType(payment, sale);

    // // Get agent information (creator of the sale)
    // const agentId = sale.creatorDetails
    //   ? `${sale.creatorDetails.firstname}-${sale.creatorDetails.lastname}-${sale.creatorDetails.id}`
    //   : 'system-agent';

    return {
      timestamp: payment.paymentDate.toISOString(),
      amount: payment.amount,
      // currency: 'Naira',
      currency: 'NGN',
      transactionType,
      // transactionId: payment.transactionRef,
      transactionId: payment.id,
      serialNumber: device?.serialNumber || 'N/A',
      customerId: customer.id,
      customerName: `${customer.firstname} ${customer.lastname}`,
      // customerPhone: null, // customer.phone,
      customerCategory: this.mapCustomerCategory(customer),
      // financingId: null,
      meterId: device?.serialNumber || 'N/A',
      // agentId: null, // agentId,
      latitude: customer.latitude || '',
      longitude: customer.longitude || '',
      // utilityId: null, // this.generateUtilityId(customer, sale),
      // failedBatteryCapacityCount: 0,
    };
  }

  private determineTransactionType(payment: any, sale: any): string {
    // Check if it's a full payment
    if (sale.totalPaid >= sale.totalPrice) {
      return 'FULL_PAYMENT';
    }

    // Check if it's an installment payment
    if (sale.status === 'IN_INSTALLMENT' || payment.amount < sale.totalPrice) {
      return 'INSTALLMENT_PAYMENT';
    }

    // Check if there's no contract (non-contract payment)
    if (!sale.contractId) {
      return 'NON_CONTRACT_PAYMENT';
    }

    return 'INSTALLMENT_PAYMENT'; // Default
  }

  private mapCustomerCategory(customer: any): string {
    // Map customer type to Odyssey categories
    switch (customer.type) {
      case 'purchase':
        return 'Residential';
      case 'lead':
        return 'Prospective';
      default:
        return 'Residential';
    }
  }

  private generateUtilityId(customer: any, sale: any): string {
    // Generate a unique utility ID based on customer and sale data
    return `UT${customer.id.slice(-6)}${sale.id.slice(-4)}`;
  }

  private shouldIncludePayment(
    payment: OdysseyPaymentDto,
    query: OdysseyPaymentQueryDto,
  ): boolean {
    // Apply optional filters
    if (query.financingId && payment.financingId !== query.financingId) {
      return false;
    }

    if (query.country && !this.isInCountry(payment, query.country)) {
      return false;
    }

    if (query.siteId && !this.isInSite(payment, query.siteId)) {
      return false;
    }

    return true;
  }

  private isInCountry(payment: OdysseyPaymentDto, country: string): boolean {
    // Simple country check - you can enhance this based on your location data
    if (country.toLowerCase() === 'ng' || country.toLowerCase() === 'nigeria') {
      return (
        payment.customerPhone.startsWith('+234') || payment.currency === 'Naira'
      );
    }
    return true;
  }

  private isInSite(payment: OdysseyPaymentDto, siteId: string): boolean {
    // Implement site-based filtering if you have site data
    // For now, return true to include all payments
    return true;
  }

  // Method to revoke API tokens
  async revokeApiToken(token: string): Promise<boolean> {
    try {
      const result = await this.prisma.apiAuthToken.updateMany({
        where: { token },
        data: { isActive: false },
      });

      return result.count > 0;
    } catch (error) {
      console.error('Error revoking API token', error);
      return false;
    }
  }

  // Method to list active tokens (for admin)
  async listActiveTokens(): Promise<any[]> {
    return await this.prisma.apiAuthToken.findMany({
      where: { isActive: true },
      select: {
        id: true,
        clientName: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
