import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import ft from 'node-fetch';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway, PaymentStatus, WalletTransactionStatus } from '@prisma/client';
import { OgaranyaWebhookDto } from './dto/ogaranya-webhook.dto';

@Injectable()
export class OgaranyaService {
  private readonly baseUrl: string;
  private readonly merchantId: string;
  private readonly token: string;
  private readonly privateKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    // private readonly paymentService: PaymentService,
  ) {
    this.baseUrl = this.config.get<string>('OGARANYA_BASE_URL');
    this.merchantId = this.config.get<string>('OGARANYA_MERCHANT_ID');
    this.token = this.config.get<string>('OGARANYA_TOKEN');
    this.privateKey = this.config.get<string>('OGARANYA_PRIVATE_KEY');
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
      Token: this.token,
      Public_key: this.generatePublicKey(),
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

  async createOrder(data: {
    amount: string;
    msisdn: string;
    desc: string;
    reference: string;
  }) {
    const url = `${this.baseUrl}/${this.merchantId}/pay/NG`;
    const response = await ft(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async initiatePayment(
    data: {
      amount: string;
      msisdn: string;
      desc: string;
      reference: string;
      child_merchant_id?: string;
    },
    paymentGatewayCode: string,
  ) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/pay/NG/${paymentGatewayCode}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      },
    );
    return response.json();
  }

  async checkPaymentStatus(orderReference: string) {
    const response = await ft(
      `${this.baseUrl}/${this.merchantId}/payment/${orderReference}/status/NG`,
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
    const payment = await this.prisma.payment.findUnique({
      where: {
        transactionRef: paymentReference,
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
    const topUpTransaction = await this.prisma.walletTransaction.findUnique({
      where: { reference: topupReference },
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
    const { order_reference, statusCode, statusMsg, payDate } =
      webhookData;

    // Check if this is a duplicate request
    // const existingResponse = await this.prisma.paymentResponses.findFirst({
    //   where: {
    //     data: {
    //       path: ['order_reference'],
    //       equals: order_reference,
    //     },
    //   },
    // });

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { ogaranyaOrderRef: order_reference },
          { transactionRef: order_reference },
        ],
      },
      include: { sale: true },
    });

    // If not found in payments, check wallet transactions
    if (!payment) {
      const walletTransaction = await this.prisma.walletTransaction.findFirst({
        where: {
          OR: [
            { ogaranyaOrderRef: order_reference },
            { reference: order_reference },
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

    const allResponses = await this.prisma.paymentResponses.findMany({
      where: {
        data: {
          not: null,
        },
      },
    });

    const existingResponse = allResponses.find((response) => {
      const data = response.data;

      return (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        'order_reference' in data &&
        (data as any).order_reference === order_reference
      );
    });

    // if (existingResponse) {
    //   return {
    //     message: 'Payment already processed',
    //     duplicate: true,
    //   };
    // }

    // Check if payment is successful
    if (statusCode === '00' && statusMsg.toLowerCase().includes('successful')) {
      // Update payment status if not already completed
      if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            paymentStatus: PaymentStatus.COMPLETED,
            updatedAt: new Date(),
            paymentDate: new Date(payDate),
          },
        });

        // Store webhook response
        await this.prisma.paymentResponses.create({
          data: {
            paymentId: payment.id,
            data: webhookData as any,
          },
        });

        // Process post-payment actions (generate tokens, update sale status, etc.)
        // await this.paymentService.handlePostPayment(updatedPayment);

        return {
          message: 'Payment verified and processed successfully',
          saleId: payment.sale.id,
          paymentData: updatedPayment,
        };
      } else {
        return {
          message: 'Payment already completed',
          saleId: payment.sale.id,
        };
      }
    } else {
      // Handle failed payment
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          updatedAt: new Date(),
        },
      });

      // Store webhook response
      await this.prisma.paymentResponses.create({
        data: {
          paymentId: payment.id,
          data: webhookData as any,
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
    if (isNaN(paidAmount) || paidAmount <= 0) {
      throw new BadRequestException(
        'Invalid amount in wallet top-up webhook data',
      );
    }

    const paymentDate = new Date(payDate);
    if (isNaN(paymentDate.getTime())) {
      throw new BadRequestException('Invalid payment date format');
    }

    const expectedAmount = walletTransaction.amount;

    if (paidAmount < expectedAmount) {
      await this.prisma.walletTransaction.update({
        where: { id: walletTransaction.id },
        data: {
          status: 'FAILED',
          errorMessage: `Amount mismatch: expected ${expectedAmount}, received ${paidAmount}`,
          updatedAt: new Date(),
        },
      });

      throw new BadRequestException(
        `Wallet top-up amount mismatch: expected ₦${expectedAmount}, but received ₦${paidAmount}. Top-up rejected.`,
      );
    }

    if (statusCode === '00' && statusMsg.toLowerCase().includes('successful')) {
      if (walletTransaction.status !== 'COMPLETED') {
        await this.prisma.walletTransaction.update({
          where: { id: walletTransaction.id },
          data: {
            status: 'COMPLETED',
            updatedAt: paymentDate,
          },
        });

        await this.prisma.wallet.update({
          where: { agentId: walletTransaction.agentId },
          data: {
            balance: {
              increment: paidAmount,
            },
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
      // Handle failed top-up
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
