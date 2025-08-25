import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import ft from 'node-fetch';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentGateway,
  PaymentStatus,
  WalletTransactionStatus,
} from '@prisma/client';
import { OgaranyaWebhookDto } from './dto/ogaranya-webhook.dto';
import { formatPhoneNumber } from 'src/utils/helpers.util';

@Injectable()
export class OgaranyaService {
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly token: string;
  private readonly privateKey: string;
  private readonly countryCode: string = 'NG';
  private readonly paymentGatewayCode: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // Updated configuration based on new documentation
    this.baseUrl =
      this.config.get<string>('OGARANYA_BASE_URL') ||
      'https://api.staging.ogaranya.com/v1';
    this.merchantId = this.config.get<string>('OGARANYA_MERCHANT_ID');
    this.token = this.config.get<string>('OGARANYA_TOKEN');
    this.privateKey = this.config.get<string>('OGARANYA_PRIVATE_KEY');
    this.paymentGatewayCode =
      this.config.get<string>('OGARANYA_PAYMENT_GATEWAY_CODE') || '11';
  }

  private generatePublicKey(): string {
    return crypto
      .createHash('sha512')
      .update(this.token + this.privateKey)
      .digest('hex');
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      token: this.token,
      publickey: this.generatePublicKey(),
    };
  }

  async createUserWallet(walletData: {
    firstname: string;
    surname: string;
    account_name?: string;
    phone: string;
    gender: string;
    dob: string;
    bvn: string;
  }) {
    const response = await ft(`${this.baseUrl}/${this.merchantId}/wallet`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(walletData),
    });
    return response.json();
  }

  async creditUserWallet(data: {
    phone: string;
    account_number: string;
    amount: string;
  }) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/wallet/credit`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      },
    );
    return response.json();
  }

  async debitUserWallet(data: {
    phone: string;
    account_number: string;
    amount: string;
    payment_gateway_code: string;
  }) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/wallet/debit`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      },
    );
    return response.json();
  }

  async getWalletInfo(data: { phone: string; account_number: string }) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/wallet/info`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      },
    );
    return response.json();
  }

  async getWalletHistory(data: {
    phone: string;
    account_number: string;
    from: string;
    to: string;
  }) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/wallet/history`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      },
    );
    return response.json();
  }

  // OLD METHOD
  async createOrder(data: {
    amount: string;
    msisdn: string;
    desc: string;
    reference: string;
    send_as_sms?: number;
    child_merchant_id?: string;
  }) {
    const url = `${this.baseUrl}/${this.merchantId}/pay/${this.countryCode}`;
    const response = await ft(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...data,
        send_as_sms: data.send_as_sms || 1,
      }),
    });
    return response.json();
  }

  // NEW METHOD
  async initiatePayment(data: {
    amount: string;
    msisdn: string;
    desc: string;
    reference: string;
    send_as_sms?: number;
    child_merchant_id?: string;
    payment_gateway_code?: string;
  }) {
    const gatewayCode = data.payment_gateway_code || this.paymentGatewayCode;
    const url = `${this.baseUrl}/${this.merchantId}/pay/${this.countryCode}/${gatewayCode}`;

    const payload = {
      amount: data.amount,
      msisdn: formatPhoneNumber(data.msisdn),
      desc: data.desc,
      reference: data.reference,
      send_as_sms: data.send_as_sms || 1, // Default to sending SMS
      ...(data.child_merchant_id && {
        child_merchant_id: data.child_merchant_id,
      }),
    };

    try {
      const response = await ft(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      return result;
    } catch (error) {
      console.error('[OGARANYA] Payment initiation failed:', error);
      throw error;
    }
  }

  // Method to simulate payment for testing
  async simulatePayment(orderReference: string, amount: number) {
    console.log('[OGARANYA] Simulating payment:', { orderReference, amount });

    const url = `${this.baseUrl}/payment/simulation`;
    const payload = {
      order_reference: orderReference,
      amount: amount,
    };

    try {
      const response = await ft(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      console.log('[OGARANYA] Simulation response:', result);
      return result;
    } catch (error) {
      console.error('[OGARANYA] Payment simulation failed:', error);
      throw error;
    }
  }

  async checkPaymentStatus(orderReference: string) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/payment/${orderReference}/status/${this.countryCode}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
    );
    return response.json();
  }

  async getPaymentGateways() {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/payment/gateway`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
    );
    return response.json();
  }

  async getCustomerByPaymentReference(paymentReference: string) {
    // Find payment by reference
    const payment = await this.prisma.payment.findFirst({
      where: {
        transactionRef: {
          equals: paymentReference,
          mode: 'insensitive',
        },
        sale: { paymentGateway: PaymentGateway.OGARANYA },
      },
      include: {
        sale: {
          include: {
            customer: true,
            saleItems: {
              include: {
                devices: true,
                product: true,
              },
            },
            payment: {
              select: {
                transactionRef: true,
                paymentStatus: true,
                amount: true,
                notes: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment with reference ${paymentReference} not found`,
      );
    }

    const { sale } = payment;
    const customer = sale.customer;
    const address = this.formatCustomerAddress(customer);
    const amount = payment.amount;

    return {
      name: `${customer.firstname} ${customer.lastname}`.trim(),
      address,
      amount,
      phone: customer.phone,
      email: customer.email,
      saleId: sale.id,
      paymentReference: paymentReference,
      paymentStatus: payment.paymentStatus,
      customerTransactions: sale.payment,
    };
  }

  async getWalletTopUpByReference(topupReference: string) {
    const topUpTransaction = await this.prisma.walletTransaction.findFirst({
      where: {
        reference: {
          equals: topupReference,
          mode: 'insensitive',
        },
      },
      include: {
        agent: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!topUpTransaction) {
      throw new NotFoundException(
        `Wallet top-up with reference ${topupReference} not found`,
      );
    }

    const agent = topUpTransaction.agent;
    const user = agent.user;

    return {
      name: `${user.firstname} ${user.lastname}`.trim(),
      address: user.location || 'N/A',
      amount: topUpTransaction.amount,
      phone: user.phone,
      email: user.email,
      agentId: agent.id,
      topupReference: topupReference,
      type: 'wallet_topup',
      status: topUpTransaction.status,
    };
  }

  async handlePaymentWebhook(webhookData: OgaranyaWebhookDto) {
    const { order_reference, statusCode, statusMsg, payDate, amount } =
      webhookData;

    const paidAmount = parseFloat(amount);
    if (isNaN(paidAmount) || paidAmount <= 0) {
      throw new BadRequestException('Invalid amount in webhook data');
    }

    const paymentDate = new Date(payDate);
    if (isNaN(paymentDate.getTime())) {
      throw new BadRequestException('Invalid payment date format');
    }

    // const allResponses = await this.prisma.paymentResponses.findMany({
    //   where: { data: { not: null } },
    // });

    // const existingResponse = allResponses.find((response) => {
    //   const data = response.data;
    //   return (
    //     data &&
    //     typeof data === 'object' &&
    //     !Array.isArray(data) &&
    //     'order_reference' in data &&
    //     (data as any).order_reference === order_reference
    //   );
    // });

    // if (existingResponse) {
    //   return {
    //     message: 'Payment already processed',
    //     duplicate: true,
    //   };
    // }

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          {
            ogaranyaOrderRef: {
              equals: order_reference,
              mode: 'insensitive',
            },
          },
          {
            transactionRef: {
              equals: order_reference,
              mode: 'insensitive',
            },
          },
        ],
      },
      include: { sale: true },
    });

    if (!payment) {
      const walletTransaction = await this.prisma.walletTransaction.findFirst({
        where: {
          OR: [
            {
              ogaranyaOrderRef: {
                equals: order_reference,
                mode: 'insensitive',
              },
            },
            { reference: { equals: order_reference, mode: 'insensitive' } },
          ],
        },
      });

      if (walletTransaction) {
        return this.handleWalletTopUpWebhook(walletTransaction, webhookData);
      }

      throw new NotFoundException(
        `Payment or transaction with reference ${order_reference} not found`,
      );
    }

    const expectedAmount = payment.amount;
    const amountTolerance = 0.01;

    if (Math.abs(paidAmount - expectedAmount) > amountTolerance) {
      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: {
            ...webhookData,
            validation_error: `Amount mismatch: expected ${expectedAmount}, received ${paidAmount}`,
            validation_status: 'AMOUNT_MISMATCH',
          } as any,
        },
      });

      throw new BadRequestException(
        `Payment amount mismatch: expected ₦${expectedAmount}, but received ₦${paidAmount}. Payment rejected.`,
      );
    }

    if (statusCode === '00' && statusMsg.toLowerCase().includes('successful')) {
      if (payment.paymentStatus === PaymentStatus.COMPLETED) {
        return {
          message: 'Payment already completed',
          saleId: payment.sale.id,
          amountPaid: paidAmount,
          paymentDate: paymentDate.toISOString(),
        };
      }

      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
          paymentDate: paymentDate,
          updatedAt: new Date(),
        },
      });

      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: {
            ...webhookData,
            validation_status: 'VALIDATED',
            amount_validated: true,
            expected_amount: expectedAmount,
            received_amount: paidAmount,
          } as any,
        },
      });

      return {
        message: 'Payment verified and processed successfully',
        saleId: payment.sale.id,
        amountPaid: paidAmount,
        paymentDate: paymentDate.toISOString(),
        paymentData: updatedPayment, // Return for post-payment processing
      };
    } else {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          paymentDate: paymentDate,
          updatedAt: new Date(),
        },
      });

      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: {
            ...webhookData,
            validation_status: 'PAYMENT_FAILED',
            failure_reason: statusMsg,
          } as any,
        },
      });

      throw new BadRequestException(`Payment failed: ${statusMsg}`);
    }
  }

  private async handleWalletTopUpWebhook(
    walletTransaction: any,
    webhookData: OgaranyaWebhookDto,
  ) {
    const { statusCode, statusMsg, amount, payDate } = webhookData;

    const paidAmount = parseFloat(amount);
    const paymentDate = new Date(payDate);
    const expectedAmount = walletTransaction.amount;

    // Validate amount
    if (Math.abs(paidAmount - expectedAmount) > 0.01) {
      await this.prisma.walletTransaction.update({
        where: { id: walletTransaction.id },
        data: {
          status: WalletTransactionStatus.FAILED,
          errorMessage: `Amount mismatch: expected ${expectedAmount}, received ${paidAmount}`,
          updatedAt: new Date(),
        },
      });

      throw new BadRequestException(
        `Wallet top-up amount mismatch: expected ₦${expectedAmount}, but received ₦${paidAmount}. Top-up rejected.`,
      );
    }

    if (statusCode === '00' && statusMsg.toLowerCase().includes('successful')) {
      if (walletTransaction.status !== WalletTransactionStatus.COMPLETED) {
        await this.prisma.walletTransaction.update({
          where: { id: walletTransaction.id },
          data: {
            status: WalletTransactionStatus.COMPLETED,
            updatedAt: paymentDate,
          },
        });

        await this.prisma.wallet.update({
          where: { agentId: walletTransaction.agentId },
          data: {
            balance: { increment: paidAmount },
            lastSyncAt: paymentDate,
          },
        });

        return {
          message: 'Wallet top-up processed successfully',
          agentId: walletTransaction.agentId,
          amountCredited: paidAmount,
          paymentDate: paymentDate.toISOString(),
        };
      } else {
        return {
          message: 'Wallet top-up already completed',
          agentId: walletTransaction.agentId,
          amountCredited: paidAmount,
          paymentDate: paymentDate.toISOString(),
        };
      }
    } else {
      await this.prisma.walletTransaction.update({
        where: { id: walletTransaction.id },
        data: {
          status: WalletTransactionStatus.FAILED,
          errorMessage: `Payment failed: ${statusMsg}`,
          updatedAt: paymentDate,
        },
      });

      throw new BadRequestException(`Wallet top-up failed: ${statusMsg}`);
    }
  }

  private formatCustomerAddress(customer: any): string {
    const addressParts = [
      customer.installationAddress,
      customer.lga,
      customer.state,
    ].filter(Boolean);

    return addressParts.length > 0
      ? addressParts.join(', ')
      : 'Address not provided';
  }
}
