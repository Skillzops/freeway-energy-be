import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OdysseyPaymentDto, OdysseyPaymentQueryDto } from './dto/odyssey.dto';
import { PaymentStatus } from '@prisma/client';
import { isValidCoordinate } from '../utils/helpers.util';

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
                      installationLatitude: true,
                      installationLongitude: true,
                    },
                  },
                },
              },
              customer: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  phone: true,
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
      let skippedForMissingCoordinates = 0;

      for (const payment of payments) {
        const odysseyPayment = await this.transformToOdysseyFormat(payment);

        if (!odysseyPayment) {
          skippedForMissingCoordinates += 1;
          continue;
        }

        // Apply optional filters
        if (this.shouldIncludePayment(odysseyPayment, query)) {
          odysseyPayments.push(odysseyPayment);
        }
      }

      console.log(`Transformed ${odysseyPayments.length} payments for Odyssey`);

      return {
        payments: odysseyPayments,
        errors: skippedForMissingCoordinates
          ? `${skippedForMissingCoordinates} payment record(s) were skipped because neither valid device nor customer GPS coordinates are available.`
          : '',
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
        // Usage telemetry must never turn a valid partner request into an
        // authentication failure. The token was already verified above.
        try {
          await this.prisma.apiAuthToken.update({
            where: { id: apiToken.id },
            data: { lastUsedAt: new Date() },
          });
        } catch (error) {
          console.error('Failed to update Odyssey API token usage', error);
        }

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
  ): Promise<OdysseyPaymentDto | null> {
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

    const getValidCoords = (lat?: string | null, lng?: string | null) => {
      if (!lat || !lng || !isValidCoordinate(lat) || !isValidCoordinate(lng)) {
        return null;
      }

      const latitude = Number(lat);
      const longitude = Number(lng);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return null;
      }

      return { latitude: String(latitude), longitude: String(longitude) };
    };

    const deviceCoords = getValidCoords(
      device?.installationLatitude,
      device?.installationLongitude,
    );

    const customerCoords = getValidCoords(
      customer?.latitude,
      customer?.longitude,
    );

    // Odyssey requires usable GPS for every exported record. Prefer device
    // installation coordinates and fall back to the customer's saved location.
    const coords = deviceCoords ?? customerCoords;
    if (!coords) {
      this.logger.warn(
        `Skipping Odyssey payment export payment=${payment.id}: no valid device or customer GPS coordinates`,
      );
      return null;
    }

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
      customerPhone: customer.phone || undefined,
      customerCategory: this.mapCustomerCategory(customer),
      // financingId: null,
      meterId: device?.serialNumber || 'N/A',
      // agentId: null, // agentId,
      // latitude:
      //   (customer?.latitude && customer?.longitude) ? customer?.latitude: '',
      // longitude: (customer?.latitude && customer?.longitude)?  customer?.longitude: '',
      latitude: coords.latitude,
      longitude: coords.longitude,
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
    if (query.country && !this.isInCountry(payment, query.country)) {
      return false;
    }

    return true;
  }

  private isInCountry(payment: OdysseyPaymentDto, country: string): boolean {
    // Simple country check - you can enhance this based on your location data
    if (country.toLowerCase() === 'ng' || country.toLowerCase() === 'nigeria') {
      return (
        (payment.customerPhone?.startsWith('+234') ?? false) ||
        payment.currency === 'NGN'
      );
    }
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
