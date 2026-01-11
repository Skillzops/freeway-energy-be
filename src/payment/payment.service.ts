import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentMethod,
  PaymentMode,
  PaymentStatus,
  PaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
  InstallationStatus,
} from '@prisma/client';
import { EmailService } from '../mailer/email.service';
import { ConfigService } from '@nestjs/config';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { TermiiService } from '../termii/termii.service';
import { OgaranyaService } from '../ogaranya/ogaranya.service';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { WalletService } from '../wallet/wallet.service';
import { ReferenceGeneratorService } from './reference-generator.service';
import { DeviceService } from 'src/device/device.service';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private readonly openPayGo: OpenPayGoService,
    private readonly ogaranyaService: OgaranyaService,
    private readonly flutterwaveService: FlutterwaveService,
    private readonly walletService: WalletService,
    private readonly termiiService: TermiiService,
    private readonly referenceGenerator: ReferenceGeneratorService,
    private readonly deviceService: DeviceService,
    private readonly notificationService: NotificationService,
  ) {}

  async generatePaymentPayload(
    saleId: string,
    amount: number,
    email: string,
    gateway: PaymentGateway = PaymentGateway.OGARANYA,
    paymentMethod: PaymentMethod = PaymentMethod.ONLINE,
  ) {
    const sale = await this.prisma.sales.findFirst({
      where: { id: saleId },
      include: {
        saleItems: {
          include: {
            product: true,
            devices: true,
          },
        },
        customer: true,
      },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    const financialMargins = await this.prisma.financialSettings.findFirst();

    // Generate appropriate reference based on gateway
    const transactionRef =
      await this.referenceGenerator.generatePaymentReference();

    let paymentResponse;
    let payment;

    if (paymentMethod === PaymentMethod.ONLINE) {
      if (gateway === PaymentGateway.OGARANYA) {
        paymentResponse = await this.createOgaranyaPayment(
          sale,
          amount,
          transactionRef,
        );
      } else if (gateway === PaymentGateway.FLUTTERWAVE) {
        paymentResponse = await this.createFlutterwavePayment(
          sale,
          amount,
          email,
          transactionRef,
        );
      }

      // Store payment record
      payment = await this.prisma.payment.create({
        data: {
          saleId,
          amount,
          transactionRef,
          paymentDate: new Date(),
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod,
          ...(gateway === PaymentGateway.OGARANYA && {
            ogaranyaOrderId: paymentResponse?.data?.order_id,
            ogaranyaOrderRef: paymentResponse?.data?.order_reference,
            ogaranyaSmsNumber: paymentResponse?.data?.msisdn_to_send_to,
            ogaranyaSmsMessage: paymentResponse?.data?.message,
          }),
        },
      });

      // Update sale with selected gateway
      await this.prisma.sales.update({
        where: { id: saleId },
        data: { paymentGateway: gateway },
      });
    }

    return {
      sale,
      financialMargins,
      payment,
      paymentData: {
        amount,
        tx_ref: transactionRef,
        gateway,
        ...paymentResponse,
      },
    };
  }

  async generateWalletTopUpPayment(
    agentId: string,
    amount: number,
    gateway: PaymentGateway = PaymentGateway.OGARANYA,
  ) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const reference = await this.referenceGenerator.generateTopUpReference();

    if (gateway === PaymentGateway.OGARANYA) {
      return this.createOgaranyaWalletTopUp(agent, amount, reference);
    } else if (gateway === PaymentGateway.FLUTTERWAVE) {
      return this.createFlutterwaveWalletTopUp(agent, amount, reference);
    }
  }

  private async createOgaranyaPayment(
    sale: any,
    amount: number,
    reference: string,
  ) {
    const paymentData = {
      amount: amount.toString(),
      msisdn: sale.customer.phone || '2348000000000',
      desc: `Payment for sale ${sale.id}`,
      reference,
    };

    try {
      const response = await this.ogaranyaService.initiatePayment(paymentData);

      if (response.status !== 'success') {
        throw new BadRequestException(
          'Failed to create payment order with Ogaranya',
        );
      }
      return response;
    } catch (error) {
      throw new BadRequestException(
        `Ogaranya payment initiation failed: ${error.message}`,
      );
    }
  }

  private async createFlutterwavePayment(
    sale: any,
    amount: number,
    email: string,
    reference: string,
  ) {
    const paymentData = {
      tx_ref: reference,
      amount,
      currency: 'NGN',
      customer: {
        email: email || `${sale.customer.phone}@example.com`,
        name: `${sale.customer.firstname} ${sale.customer.lastname}`,
        phonenumber: sale.customer.phone,
      },
      payment_options: 'banktransfer,card,ussd',
      customizations: {
        title: 'Product Purchase',
        description: `Payment for sale ${sale.id}`,
        logo: this.config.get<string>('COMPANY_LOGO_URL'),
      },
      meta: {
        saleId: sale.id,
      },
    };

    try {
      // return await this.flutterwaveService.generatePaymentLink(paymentData);
      return paymentData;
    } catch (error) {
      throw new BadRequestException(
        `Flutterwave payment initiation failed: ${error.message}`,
      );
    }
  }

  private async createOgaranyaWalletTopUp(
    agent: any,
    amount: number,
    reference: string,
  ) {
    const paymentData = {
      amount: amount.toString(),
      msisdn: agent.user.phone || '2348000000000',
      desc: `Wallet top-up for agent ${agent.agentId}`,
      reference,
    };

    try {
      const orderResponse =
        await this.ogaranyaService.initiatePayment(paymentData);

      if (orderResponse.status === 'success') {
        let wallet = await this.prisma.wallet.findUnique({
          where: { agentId: agent.id },
        });

        if (!wallet) {
          wallet = await this.prisma.wallet.create({
            data: {
              agentId: agent.id,
              balance: 0,
            },
          });
        }

        const topUpRequest = await this.prisma.walletTransaction.create({
          data: {
            ogaranyaOrderId: orderResponse.data.order_id,
            ogaranyaOrderRef: orderResponse.data.order_reference,
            ogaranyaSmsNumber: orderResponse.data.msisdn_to_send_to,
            ogaranyaSmsMessage: orderResponse.data.message,
            walletId: wallet.id,
            agentId: agent.id,
            type: WalletTransactionType.CREDIT,
            amount,
            previousBalance: wallet.balance,
            newBalance: wallet.balance + amount,
            reference,
            description: 'Wallet Topup',
            status: WalletTransactionStatus.PENDING,
          },
        });

        return {
          gateway: PaymentGateway.OGARANYA,
          topUpId: topUpRequest.id,
          orderId: orderResponse.data.order_id,
          orderReference: orderResponse.data.order_reference,
          message: orderResponse.data.message,
          smsNumber: orderResponse.data.msisdn_to_send_to,
          amount,
          reference,
        };
      }

      throw new BadRequestException('Failed to create top-up order');
    } catch (error) {
      throw new BadRequestException(
        `Top-up initiation failed: ${error.message}`,
      );
    }
  }

  private async createFlutterwaveWalletTopUp(
    agent: any,
    amount: number,
    reference: string,
  ) {
    const paymentData = {
      tx_ref: reference,
      amount,
      currency: 'NGN',
      customer: {
        email: agent.user.email || `${agent.user.phone}@example.com`,
        name: `${agent.user.firstname} ${agent.user.lastname}`,
        phonenumber: agent.user.phone,
      },
      payment_options: 'banktransfer,card,ussd',
      customizations: {
        title: 'Wallet Top-up',
        description: `Wallet top-up for agent ${agent.agentId}`,
        logo: this.config.get<string>('COMPANY_LOGO_URL'),
      },
      meta: {
        agentId: agent.id,
        type: 'wallet_topup',
      },
    };

    try {
      // const paymentLink =
      //   await this.flutterwaveService.generatePaymentLink(paymentData);

      let wallet = await this.prisma.wallet.findUnique({
        where: { agentId: agent.id },
      });

      if (!wallet) {
        wallet = await this.prisma.wallet.create({
          data: {
            agentId: agent.id,
            balance: 0,
          },
        });
      }

      const topUpRequest = await this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          agentId: agent.id,
          type: WalletTransactionType.CREDIT,
          paymentGateway: PaymentGateway.FLUTTERWAVE,
          amount,
          previousBalance: wallet.balance,
          newBalance: wallet.balance + amount,
          reference,
          description: 'Wallet Topup via Flutterwave',
          status: WalletTransactionStatus.PENDING,
        },
      });

      return {
        gateway: PaymentGateway.FLUTTERWAVE,
        topUpId: topUpRequest.id,
        // paymentLink: paymentLink.data.link,
        paymentData,
        amount,
        reference,
      };
    } catch (error) {
      throw new BadRequestException(
        `Flutterwave top-up initiation failed: ${error.message}`,
      );
    }
  }

  async verifyPaymentManually(transactionRef: string, transactionId?: number) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        transactionRef: { equals: transactionRef, mode: 'insensitive' },
      },
      include: {
        sale: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment with reference ${transactionRef} not found`,
      );
    }

    if (payment.paymentStatus === PaymentStatus.COMPLETED) {
      return {
        status: 'already_completed',
        message: 'Payment already verified and completed',
        payment,
      };
    }

    try {
      // Determine which gateway to verify with
      const gateway = payment.sale.paymentGateway || PaymentGateway.OGARANYA;

      if (gateway === PaymentGateway.OGARANYA) {
        return this.verifyOgaranyaPayment(payment);
      } else if (gateway === PaymentGateway.FLUTTERWAVE) {
        // Only use transaction ID if it's provided and valid
        if (transactionId && transactionId > 0) {
          return this.verifyFlutterwavePayment(payment, transactionId);
        } else {
          // Use reference-based verification for Flutterwave
          return this.verifyFlutterwavePaymentByReference(payment);
        }
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      throw new BadRequestException(
        'Payment verification failed. Please try again.',
      );
    }
  }

  private async verifyOgaranyaPayment(payment: any) {
    const verificationRef = payment.ogaranyaOrderRef || payment.transactionRef;
    const paymentStatus =
      await this.ogaranyaService.checkPaymentStatus(verificationRef);

    if (paymentStatus.status === 'success') {
      if (paymentStatus.data.status === 'SUCCESSFUL') {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            paymentStatus: PaymentStatus.COMPLETED,
            updatedAt: new Date(),
          },
        });

        await this.prisma.paymentResponses.create({
          data: {
            paymentId: payment.id,
            data: paymentStatus,
          },
        });

        await this.handlePostPayment(updatedPayment);

        return {
          status: 'verified',
          message: 'Payment verified successfully via Ogaranya',
          payment: updatedPayment,
        };
      } else {
        return {
          status: 'pending',
          message: 'Payment not yet completed. Please try again later.',
          paymentStatus: paymentStatus.data.status,
        };
      }
    } else {
      throw new BadRequestException('Failed to verify payment with Ogaranya');
    }
  }

  private async verifyFlutterwavePaymentByReference(payment: any) {
    try {
      console.log(
        '[PAYMENT] Verifying Flutterwave payment by reference:',
        payment.transactionRef,
      );

      const verificationResponse =
        await this.flutterwaveService.verifyTransactionByReference(
          payment.transactionRef,
        );

      if (
        verificationResponse.status === 'success' &&
        verificationResponse.data.status === 'successful'
      ) {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            paymentStatus: PaymentStatus.COMPLETED,
            updatedAt: new Date(),
          },
        });

        await this.prisma.paymentResponses.create({
          data: {
            paymentId: payment.id,
            data: verificationResponse,
          },
        });

        await this.handlePostPayment(updatedPayment);

        return {
          status: 'verified',
          message:
            'Payment verified successfully via Flutterwave (by reference)',
          payment: updatedPayment,
        };
      } else {
        return {
          status: 'pending',
          message: 'Payment not yet completed. Please try again later.',
          paymentStatus: verificationResponse.data?.status,
        };
      }
    } catch (error) {
      console.error(
        '[PAYMENT] Flutterwave reference verification failed:',
        error,
      );
      throw new BadRequestException(
        `Failed to verify payment with Flutterwave: ${error.message}`,
      );
    }
  }

  private async verifyFlutterwavePayment(payment: any, transactionId: number) {
    try {
      // Get transaction ID from payment responses or use reference
      // const transactionId = await this.getFlutterwaveTransactionId(payment);
      const verificationResponse =
        await this.flutterwaveService.verifyTransaction(transactionId);

      if (
        verificationResponse.status === 'success' &&
        verificationResponse.data.status === 'successful'
      ) {
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            paymentStatus: PaymentStatus.COMPLETED,
            updatedAt: new Date(),
          },
        });

        await this.prisma.paymentResponses.create({
          data: {
            paymentId: payment.id,
            data: verificationResponse,
          },
        });

        await this.handlePostPayment(updatedPayment);

        return {
          status: 'verified',
          message: 'Payment verified successfully via Flutterwave',
          payment: updatedPayment,
        };
      } else {
        return {
          status: 'pending',
          message: 'Payment not yet completed. Please try again later.',
          paymentStatus: verificationResponse.data?.status,
        };
      }
    } catch (error) {
      throw new BadRequestException(
        `Failed to verify payment with Flutterwave: ${error.message}`,
      );
    }
  }

  // private async getFlutterwaveTransactionId(
  //   payment: any,
  //   transaction_id,
  // ): Promise<number> {
  //   // Try to get transaction ID from payment responses
  //   const paymentResponse = await this.prisma.paymentResponses.findFirst({
  //     where: { paymentId: payment.id },
  //     orderBy: { createdAt: 'desc' },
  //   });

  //   if (
  //     paymentResponse?.data &&
  //     typeof paymentResponse.data === 'object' &&
  //     !Array.isArray(paymentResponse.data) &&
  //     'transaction_id' in paymentResponse.data
  //   ) {
  //     const transactionId = (paymentResponse.data as any).transaction_id;
  //     return transactionId;
  //   }

  //   // If not found, we might need to search by reference
  //   // This would require calling Flutterwave's transaction lookup endpoint
  //   throw new BadRequestException(
  //     'Transaction ID not found for Flutterwave payment verification',
  //   );
  // }

  async verifyWalletTopUpManually(reference: string) {
    const topUpRequest = await this.prisma.walletTransaction.findFirst({
      where: { reference: { equals: reference, mode: 'insensitive' } },
      include: {
        agent: {
          include: { user: true },
        },
      },
    });

    if (!topUpRequest) {
      throw new NotFoundException(
        `Top-up request with reference ${reference} not found`,
      );
    }

    if (topUpRequest.status === WalletTransactionStatus.COMPLETED) {
      return {
        status: 'already_completed',
        message: 'Top-up already verified and completed',
        topUpRequest,
      };
    }

    try {
      // Determine gateway based on reference format or stored data
      if (topUpRequest.ogaranyaOrderRef) {
        return this.verifyOgaranyaTopUp(topUpRequest);
      } else {
        return this.verifyFlutterwaveTopUp(topUpRequest);
      }
    } catch (error) {
      console.error('Top-up verification error:', error);
      await this.prisma.walletTransaction.update({
        where: { id: topUpRequest.id },
        data: { status: WalletTransactionStatus.FAILED },
      });
      throw new BadRequestException(
        'Top-up verification failed. Please try again.',
      );
    }
  }

  private async verifyOgaranyaTopUp(topUpRequest: any) {
    const verificationRef =
      topUpRequest.ogaranyaOrderRef || topUpRequest.reference;
    const paymentStatus =
      await this.ogaranyaService.checkPaymentStatus(verificationRef);

    if (paymentStatus.status === 'success') {
      if (paymentStatus.data.status === 'SUCCESSFUL') {
        const walletTransaction = await this.walletService.creditWallet(
          topUpRequest.agentId,
          topUpRequest.amount,
          topUpRequest.reference,
          `Wallet top-up verified via Ogaranya`,
        );

        const updatedTopUp = await this.prisma.walletTransaction.update({
          where: { id: topUpRequest.id },
          data: {
            status: WalletTransactionStatus.COMPLETED,
            updatedAt: new Date(),
          },
        });

        return {
          status: 'verified',
          message: 'Wallet top-up verified successfully via Ogaranya',
          amount: topUpRequest.amount,
          newBalance: walletTransaction.newBalance,
          topUpRequest: updatedTopUp,
        };
      } else {
        return {
          status: 'pending',
          message: 'Payment not yet completed. Please try again later.',
          paymentStatus: paymentStatus.data.status,
        };
      }
    } else {
      throw new BadRequestException('Failed to verify top-up with Ogaranya');
    }
  }

  private async verifyFlutterwaveTopUp(topUpRequest: any) {
    try {
      const verificationResponse =
        await this.flutterwaveService.verifyTransactionByReference(
          topUpRequest.reference,
        );

      if (
        verificationResponse.status === 'success' &&
        verificationResponse.data.status === 'successful'
      ) {
        const walletTransaction = await this.walletService.creditWallet(
          topUpRequest.agentId,
          topUpRequest.amount,
          topUpRequest.reference,
          `Wallet top-up verified via Flutterwave`,
        );

        const updatedTopUp = await this.prisma.walletTransaction.update({
          where: { id: topUpRequest.id },
          data: {
            status: WalletTransactionStatus.COMPLETED,
            updatedAt: new Date(),
          },
        });

        return {
          status: 'verified',
          message: 'Wallet top-up verified successfully via Flutterwave',
          amount: topUpRequest.amount,
          newBalance: walletTransaction.newBalance,
          topUpRequest: updatedTopUp,
        };
      } else {
        return {
          status: 'pending',
          message: 'Payment not yet completed. Please try again later.',
          paymentStatus: verificationResponse.data?.status,
        };
      }
    } catch (error) {
      throw new BadRequestException(
        `Failed to verify top-up with Flutterwave, ${error.message}`,
      );
    }
  }

  async getPendingPayments(agentId?: string) {
    const where: any = {
      paymentStatus: PaymentStatus.PENDING,
    };

    if (agentId) {
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
      });

      if (agent) {
        where.sale = {
          creatorId: agent.userId,
        };
      }
    }

    return this.prisma.payment.findMany({
      where,
      include: {
        sale: {
          include: {
            customer: {
              select: {
                firstname: true,
                lastname: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingTopUps(agentId: string) {
    return this.prisma.walletTransaction.findMany({
      where: {
        agentId,
        status: WalletTransactionStatus.PENDING,
        type: WalletTransactionType.CREDIT,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // async generateStaticAccount(
  //   saleId: string,
  //   email: string,
  //   bvn: string,
  //   transactionRef: string,
  // ) {
  //   return this.flutterwaveService.generateStaticAccount(
  //     saleId,
  //     email,
  //     bvn,
  //     transactionRef,
  //   );
  // }

  // async verifyPayment(ref: string | number, transaction_id: number) {
  //   const paymentExist = await this.prisma.payment.findUnique({
  //     where: {
  //       transactionRef: ref as string,
  //     },
  //     include: {
  //       sale: true,
  //     },
  //   });

  //   if (!paymentExist)
  //     throw new BadRequestException(`Payment with ref: ${ref} does not exist.`);

  //   const res = await this.flutterwaveService.verifyTransaction(transaction_id);

  //   if (
  //     paymentExist.paymentStatus === PaymentStatus.FAILED &&
  //     paymentExist.sale.status === SalesStatus.CANCELLED
  //   ) {
  //     const refundResponse = await this.flutterwaveService.refundPayment(
  //       transaction_id,
  //       res.data.charged_amount,
  //     );

  //     await this.prisma.$transaction([
  //       this.prisma.payment.update({
  //         where: { id: paymentExist.id },
  //         data: {
  //           paymentStatus: PaymentStatus.REFUNDED,
  //         },
  //       }),
  //       this.prisma.paymentResponses.create({
  //         data: {
  //           paymentId: paymentExist.id,
  //           data: refundResponse,
  //         },
  //       }),
  //     ]);

  //     throw new BadRequestException(
  //       'This sale is cancelled already. Refund Initialised!',
  //     );
  //   }

  //   if (paymentExist.paymentStatus !== PaymentStatus.COMPLETED) {
  //     const [paymentData] = await this.prisma.$transaction([
  //       this.prisma.payment.update({
  //         where: { id: paymentExist.id },
  //         data: {
  //           paymentStatus: PaymentStatus.COMPLETED,
  //         },
  //       }),
  //       this.prisma.paymentResponses.create({
  //         data: {
  //           paymentId: paymentExist.id,
  //           data: res,
  //         },
  //       }),
  //     ]);

  //     await this.handlePostPayment(paymentData);
  //   }

  //   return 'success';
  // }

  async handlePostPayment(paymentData: any) {
    let sale = await this.prisma.sales.findUnique({
      where: { id: paymentData.saleId },
      include: {
        saleItems: {
          include: {
            product: true,
            devices: true,
            SaleRecipient: true,
          },
        },
        customer: true,
        creatorDetails: true,
        installmentAccountDetails: true,
      },
    });

    sale = await this.prisma.sales.update({
      where: { id: sale.id },
      data: {
        totalPaid: {
          increment: paymentData.amount,
        },
      },
      include: {
        saleItems: {
          include: {
            product: true,
            devices: true,
            SaleRecipient: true,
          },
        },
        customer: true,
        creatorDetails: true,
        installmentAccountDetails: true,
      },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    const installmentInfo = this.deviceService.calculateInstallmentProgress(
      sale,
      paymentData.amount,
    );

    // console.log({ installmentInfo });

    await this.prisma.sales.update({
      where: { id: sale.id },
      data: {
        remainingInstallments: installmentInfo.newRemainingDuration,
        status: installmentInfo.newStatus,
      },
    });

    await this.updateDeviceStatusAfterPayment(sale);

    const saleItems = await this.prisma.saleItem.findMany({
      where: { saleId: sale.id },
      include: {
        devices: true,
      },
    });

    // Process tokenable devices
    const deviceTokens = [];
    for (const saleItem of saleItems) {
      // const saleDevices = saleItem.devices;
      // const tokenableDevices = saleDevices.filter(
      //   (device) => device.isTokenable,
      // );

      const installedDevices = saleItem.devices.filter(
        (device) =>
          device.installationStatus === InstallationStatus.installed &&
          device.gpsVerified &&
          device.isTokenable,
      );

      if (installedDevices.length) {
        let tokenDuration: number;
        if (saleItem.paymentMode === PaymentMode.ONE_OFF) {
          tokenDuration = -1; // Represents forever
        } else {
          tokenDuration =
            installmentInfo.monthsCovered == -1
              ? installmentInfo.monthsCovered
              : installmentInfo.monthsCovered * 30;
        }

        for (const device of installedDevices) {
          const token = await this.openPayGo.generateToken(
            device,
            tokenDuration,
            Number(device.count),
          );

          deviceTokens.push({
            deviceSerialNumber: device.serialNumber,
            deviceKey: device.key,
            deviceToken: token.finalToken,
          });

          await this.prisma.device.update({
            where: { id: device.id },
            data: { count: String(token.newCount) },
          });

          await this.prisma.tokens.create({
            data: {
              deviceId: device.id,
              token: String(token.finalToken),
              duration: tokenDuration,
              creatorId: sale.creatorId,
              tokenReleased: true
            },
          });
        }
      }
    }

    // Send device tokens via email and SMS
    if (deviceTokens.length) {
      await this.notificationService.sendTokenToRecipient(
        {
          email: sale.creatorDetails.email,
          phone: sale.creatorDetails.phone,
          firstname: sale.creatorDetails.firstname,
          lastname: sale.creatorDetails.lastname,
        },
        deviceTokens,
      );
    }

    // Handle installment account details if applicable
    if (
      sale.paymentMethod === PaymentMethod.ONLINE &&
      sale.installmentAccountDetailsId &&
      !sale.deliveredAccountDetails
    ) {
      if (sale.customer.email) {
        await this.Email.sendMail({
          to: sale.customer.email,
          from: this.config.get<string>('MAIL_FROM'),
          subject: `Here is your account details for installment payments`,
          template: './installment-account-details',
          context: {
            details: JSON.stringify(
              sale.installmentAccountDetails,
              undefined,
              4,
            ),
          },
        });
      }

      if (sale.customer.phone) {
        try {
          const accountMessage = this.formatInstallmentAccountMessage(
            sale.installmentAccountDetails,
            sale.customer.firstname || sale.customer.lastname,
          );

          await this.termiiService.sendSms({
            to: sale.customer.phone,
            message: accountMessage,
          });
        } catch (error) {
          console.error(
            'Failed to send installment account details SMS:',
            error,
          );
        }
      }

      await this.prisma.sales.update({
        where: { id: sale.id },
        data: { deliveredAccountDetails: true },
      });
    }
  }

  private async updateDeviceStatusAfterPayment(sale: any) {
    try {
      // // Calculate total paid for this sale
      // const totalPaid = await this.prisma.payment.aggregate({
      //   where: {
      //     saleId: sale.id,
      //     paymentStatus: PaymentStatus.COMPLETED,
      //   },
      //   _sum: {
      //     amount: true,
      //   },
      // });

      // const amountPaid = totalPaid._sum.amount || 0;

      // // Determine if devices should be marked as ready for installation
      // const isFullyPaid = amountPaid >= sale.totalPrice;
      // const isInstallmentSale = sale.totalInstallmentDuration > 0;
      // const hasInitialPayment =
      //   amountPaid >= (sale.installmentStartingPrice || 0);

      // // Mark devices as ready if:
      // // 1. Full payment is made, OR
      // // 2. Initial installment payment is made (for installment sales)
      // const shouldMarkReady =
      //   isFullyPaid || (isInstallmentSale && hasInitialPayment);

      // if (shouldMarkReady) {
      //   await this.deviceService.markDevicesReadyForInstallation(sale.id);

      //   console.log(
      //     `[PAYMENT] Marked devices as ready for installation for sale ${sale.id}`,
      //   );
      // } else {
      //   console.log(
      //     `[PAYMENT] Payment received but devices not yet ready for installation. Amount paid: ${amountPaid}, Required: ${sale.installmentStartingPrice || sale.totalPrice}`,
      //   );
      // }
      await this.deviceService.markDevicesReadyForInstallation(sale.id);
    } catch (error) {
      console.error(
        '[PAYMENT] Error updating device status after payment:',
        error,
      );
    }
  }

  private formatInstallmentAccountMessage(
    accountDetails: any,
    customerName?: string,
  ): string {
    const greeting = customerName ? `Dear ${customerName},` : 'Dear Customer,';

    let message = `${greeting}\n\nYour installment payment details:\n\n`;
    message += `Bank: ${accountDetails.bankName}\n`;
    message += `Account: ${accountDetails.accountNumber}\n`;
    message += `Name: ${accountDetails.accountName}\n\n`;
    message += `Use these details for monthly payments.\n\nThank you!`;

    return message;
  }
}
