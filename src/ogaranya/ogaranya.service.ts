import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import ft from 'node-fetch';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentGateway,
  PaymentMethod,
  PaymentMode,
  PaymentStatus,
  Prisma,
  WalletTransactionStatus,
} from '@prisma/client';
import { OgaranyaWebhookDto } from './dto/ogaranya-webhook.dto';
import { formatPhoneNumber } from 'src/utils/helpers.util';
import {
  DevicePaymentDto,
  PowerPurchaseDto,
} from './dto/ogaranya-power-purchase.dto';
import { PaymentService } from 'src/payment/payment.service';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';

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
    private readonly openPayGo: OpenPayGoService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
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

  async getDeviceInformation(serialNumber: string) {
    const device = await this.prisma.device.findFirst({
      where: {
        serialNumber: {
          equals: serialNumber,
          mode: 'insensitive',
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: true,
                saleItems: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            product: true,
          },
        },
      },
    });

    if (!device) {
      throw new NotFoundException(
        `Device with serial number ${serialNumber} not found`,
      );
    }

    if (!device.saleItems || device.saleItems.length === 0) {
      throw new BadRequestException(
        `Device ${serialNumber} is not attached to any sale`,
      );
    }

    const saleItem = device.saleItems[0];
    const sale = saleItem.sale;
    const customer = sale.customer;

    const address = this.formatCustomerAddress(customer);
    const amount = sale.totalPrice;

    return {
      serialNumber: device.serialNumber,
      customer: {
        name: `${customer.firstname} ${customer.lastname}`.trim(),
        address,
        phone: customer.phone,
        email: customer.email,
      },
      amount,
      saleId: sale.id,
      productName: saleItem.product.name,
      installationStatus: device.installationStatus,
      installationLocation: device.installationLocation,
      totalInstallments: sale.totalInstallmentDuration,
      remainingInstallments: sale.remainingInstallments,
      saleStatus: sale.status,
      totalPaid: sale.totalPaid,
      remainingBalance: sale.totalPrice - sale.totalPaid,
    };
  }

  async recordDevicePayment(devicePaymentDto: DevicePaymentDto) {
    const {
      serialNumber,
      amount: paidAmount,
      orderReference,
      paymentDate,
    } = devicePaymentDto;

    const amount = parseFloat(paidAmount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const device = await this.prisma.device.findFirst({
      where: {
        serialNumber: {
          equals: serialNumber,
          mode: 'insensitive',
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: true,
                saleItems: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!device) {
      throw new NotFoundException(
        `Device with serial number ${serialNumber} not found`,
      );
    }

    if (!device.saleItems || device.saleItems.length === 0) {
      throw new BadRequestException(
        `Device ${serialNumber} is not attached to any sale`,
      );
    }

    if (!device.isTokenable) {
      throw new BadRequestException(
        `Device ${serialNumber} is not tokenable.`,
      );
    }

    const sale = device.saleItems[0].sale;
    const remainingBalance = sale.totalPrice - sale.totalPaid;

    if (amount > remainingBalance + 0.01) {
      throw new BadRequestException(
        `Payment amount (₦${amount}) exceeds remaining balance (₦${remainingBalance})`,
      );
    }

    // Check for duplicate payment
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { ogaranyaOrderRef: orderReference },
          { transactionRef: orderReference },
        ],
      },
    });

    if (
      existingPayment &&
      existingPayment.paymentStatus === PaymentStatus.COMPLETED
    ) {
      return {
        message: 'Payment already processed',
        duplicate: true,
        serialNumber,
        saleId: sale.id,
      };
    }

    // Create or update payment record
    let payment;
    if (existingPayment) {
      payment = await this.prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          paymentStatus: PaymentStatus.COMPLETED,
          paymentDate,
          amount,
        },
      });
    } else {
      payment = await this.prisma.payment.create({
        data: {
          saleId: sale.id,
          amount,
          transactionRef: orderReference,
          paymentStatus: PaymentStatus.COMPLETED,
          paymentMethod: PaymentMethod.ONLINE,
          paymentDate,
          ogaranyaOrderRef: orderReference,
          notes: `Payment for device ${serialNumber}`,
        },
      });
    }

    return {
      message: 'Payment verified and processed successfully',
      saleId: sale.id,
      amountPaid: amount,
      paymentDate: paymentDate,
      paymentData: payment,
    };
  }

  async purchasePower(powerPurchaseDto: PowerPurchaseDto) {
    const {
      serialNumber,
      amount: paidAmount,
      orderReference,
    } = powerPurchaseDto;

    const amount = parseFloat(paidAmount);
    if (isNaN(amount) || amount <= 1) {
      throw new BadRequestException('Invalid amount');
    }

    // Find device and validate
    const device = await this.prisma.device.findFirst({
      where: {
        serialNumber: {
          equals: serialNumber,
          mode: 'insensitive',
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: true,
                saleItems: {
                  include: {
                    product: true,
                    devices: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!device) {
      throw new NotFoundException(
        `Device with serial number ${serialNumber} not found`,
      );
    }

    if (!device.saleItems || device.saleItems.length === 0) {
      throw new BadRequestException(
        `Device ${serialNumber} is not attached to any sale`,
      );
    }

    const saleItem = device.saleItems[0];
    const sale = saleItem.sale;

    if (!device.isTokenable) {
      throw new BadRequestException(
        `Device ${serialNumber} is not tokenable. This device cannot generate tokens.`,
      );
    }

    // Validate amount against remaining balance
    const remainingBalance = sale.totalPrice - sale.totalPaid;

    if (amount > remainingBalance + 0.01) {
      throw new BadRequestException(
        `Payment amount (₦${amount}) exceeds remaining balance (₦${remainingBalance.toFixed(2)})`,
      );
    }

    // Check for duplicate order reference
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { ogaranyaOrderRef: orderReference },
          { transactionRef: orderReference },
        ],
      },
    });

    if (
      existingPayment &&
      existingPayment.paymentStatus === PaymentStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Order reference ${orderReference} has already been processed`,
      );
    }

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        saleId: sale.id,
        amount,
        transactionRef: orderReference,
        paymentStatus: PaymentStatus.COMPLETED,
        paymentMethod: PaymentMethod.ONLINE,
        paymentDate: new Date(),
        ogaranyaOrderRef: orderReference,
        notes: `Power purchase via Ogaranya`,
      },
    });

    // Calculate installment progress using same logic as payment service
    const installmentInfo = this.paymentService.calculateInstallmentProgress(
      sale,
      amount,
    );

    await this.prisma.sales.update({
      where: { id: sale.id },
      data: {
        totalPaid: {
          increment: amount,
        },
        remainingInstallments: installmentInfo.newRemainingDuration,
        status: installmentInfo.newStatus,
      },
    });

    let tokenData = null;
    let tokenGenerated = false;
    let tokenDuration = 0;

    // Determine token duration based on payment mode
    if (saleItem.paymentMode === PaymentMode.ONE_OFF) {
      // For one-off payments, token is forever
      tokenDuration = -1;
    } else {
      // For installment, convert months to days
      tokenDuration =
        installmentInfo.monthsCovered === -1
          ? -1
          : installmentInfo.monthsCovered * 30;
    }

    try {
      tokenData = await this.openPayGo.generateToken(
        device as Prisma.DeviceCreateInput,
        tokenDuration,
        Number(device.count),
      );

      await this.prisma.tokens.create({
        data: {
          deviceId: device.id,
          token: String(tokenData.finalToken),
          duration: tokenDuration,
          tokenReleased: true,
        },
      });

      await this.prisma.device.update({
        where: { id: device.id },
        data: { count: String(tokenData.newCount) },
      });

      tokenGenerated = true;

      // Add to queue
      // await this.notificationService.sendTokenToCustomer(
      //   sale.customer,
      //   deviceTokens,
      // );
    } catch (error) {
      console.error('Token generation failed:', error);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          notes: `Power purchase - Token generation failed: ${error.message}`,
        },
      });
    }

    // Get updated sale
    const updatedSale = await this.prisma.sales.findUnique({
      where: { id: sale.id },
    });

    return {
      serialNumber: device.serialNumber,
      ...(tokenGenerated && {
        token: tokenData.finalToken,
        tokenMessage: `Load this token on your device: ${tokenData.finalToken}`,
      }),
      durationDays:
        tokenDuration === -1 ? 'Unlimited (Forever)' : tokenDuration,
      totalPaid: updatedSale.totalPaid,
      remainingBalance: updatedSale.totalPrice - updatedSale.totalPaid,
      saleId: sale.id,
      paymentId: payment.id,
      saleStatus: updatedSale.status,
      remainingInstallments: updatedSale.remainingInstallments,
      message: tokenGenerated
        ? `Payment successful! Token generated for ${tokenDuration === -1 ? 'unlimited' : tokenDuration + ' days'}`
        : 'Payment successful! Token will be generated once device is ready.',
      paymentData: {
        id: payment.id,
        transactionRef: payment.transactionRef,
        amount: payment.amount,
        paymentStatus: payment.paymentStatus,
        paymentDate: payment.paymentDate,
        paymentMethod: payment.paymentMethod,
        ogaranyaOrderId: payment.ogaranyaOrderId,
        ogaranyaOrderRef: payment.ogaranyaOrderRef,
        ogaranyaSmsNumber: payment.ogaranyaSmsNumber,
        ogaranyaSmsMessage: payment.ogaranyaSmsMessage,
        notes: payment.notes,
        saleId: payment.saleId,
      },
      customerInfo: {
        name: `${sale.customer.firstname} ${sale.customer.lastname}`,
        phone: sale.customer.phone,
        email: sale.customer.email,
      },
      deviceStatus: {
        installed: device.installationStatus === 'installed',
        gpsVerified: device.gpsVerified,
        tokenable: device.isTokenable,
        tokenGenerated,
      },
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

  private async calculateDaysFromAmount(
    serialNumber: string,
    amount: number,
  ): Promise<{ days: number; dailyRate: number; calculationMethod: string }> {
    // Get device and associated sale to understand pricing
    const device = await this.prisma.device.findUnique({
      where: { serialNumber },
      include: {
        saleItems: {
          include: {
            sale: true,
          },
        },
      },
    });

    if (!device || !device.saleItems || device.saleItems.length === 0) {
      // Default fallback: 1 day per ₦100
      const dailyRate = 100;
      const days = Math.floor(amount / dailyRate);
      return {
        days: Math.max(1, days),
        dailyRate,
        calculationMethod: 'Default rate: ₦100/day',
      };
    }

    const sale = device.saleItems[0].sale;

    // Method 1: Calculate from monthly payment (preferred)
    if (sale.totalMonthlyPayment > 0) {
      const dailyRate = sale.totalMonthlyPayment / 30; // Assuming 30 days per month
      const days = Math.floor(amount / dailyRate);
      return {
        days: Math.max(1, days),
        dailyRate,
        calculationMethod: `Based on monthly payment: ₦${sale.totalMonthlyPayment.toFixed(2)}/month`,
      };
    }

    // Method 2: Calculate from total sale (if one-off payment)
    if (sale.totalInstallmentDuration === 0 && sale.totalPrice > 0) {
      // Assume sale covers 365 days (1 year) for one-off purchases
      const dailyRate = sale.totalPrice / 365;
      const days = Math.floor(amount / dailyRate);
      return {
        days: Math.max(1, days),
        dailyRate,
        calculationMethod: `Based on total price (annual): ₦${sale.totalPrice.toFixed(2)}/year`,
      };
    }

    // Method 3: Fallback - default rate
    const dailyRate = 100; // ₦100 per day
    const days = Math.floor(amount / dailyRate);
    return {
      days: Math.max(1, days),
      dailyRate,
      calculationMethod: 'Default rate: ₦100/day',
    };
  }
}
