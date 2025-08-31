import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OgaranyaService } from '../ogaranya/ogaranya.service';
import { CreateAgentWalletDto } from './dto/create-agent-wallet.dto';
import { GetWalletTransactionsQuery } from './dto/wallet-transactions.dto';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ogaranyaService: OgaranyaService,
  ) {}

  async createAgentWallet(agentId: string, walletData: CreateAgentWalletDto) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    // Validate required data
    this.validateWalletData(walletData);

    try {
      // Create wallet with Ogaranya
      const ogaranyaWallet = await this.ogaranyaService.createUserWallet({
        firstname: walletData.firstname,
        surname: walletData.surname,
        account_name:
          walletData.account_name ||
          `${walletData.firstname} ${walletData.surname}`,
        phone: walletData.phone,
        gender: walletData.gender,
        dob: walletData.dob,
        bvn: walletData.bvn,
      });

      if (ogaranyaWallet.status === 'success') {
        // Store Ogaranya details
        await this.prisma.agent.update({
          where: { id: agentId },
          data: {
            ogaranyaAccountNumber: ogaranyaWallet.data?.account_number,
            ogaranyaPhone: walletData.phone,
          },
        });

        // Create local wallet record
        const wallet = await this.prisma.wallet.create({
          data: {
            agentId,
            balance: 0,
            lastSyncAt: new Date(),
          },
        });

        return {
          success: true,
          wallet,
          ogaranyaData: ogaranyaWallet.data,
          message: 'Wallet created successfully',
        };
      }

      throw new Error('Ogaranya wallet creation failed');
    } catch (error) {
      console.error('Wallet creation failed:', error);
      throw new BadRequestException(`Wallet creation failed: ${error.message}`);
    }
  }

  private validateWalletData(data: CreateAgentWalletDto) {
    // Additional validation
    if (!data.phone.startsWith('234')) {
      throw new BadRequestException(
        'Phone number must be in Nigerian format (234xxxxxxxxxx)',
      );
    }

    // Validate BVN format (basic check)
    if (!/^\d{11}$/.test(data.bvn)) {
      throw new BadRequestException('BVN must be exactly 11 digits');
    }

    // Validate date format
    const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    if (!dateRegex.test(data.dob)) {
      throw new BadRequestException(
        'Date of birth must be in DD/MM/YYYY format',
      );
    }
  }

  async getWalletBalance(agentId: string): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { agentId },
    });

    return wallet?.balance || 0;

    // const agent = await this.prisma.agent.findUnique({
    //   where: { id: agentId },
    // });


    // if (!agent?.ogaranyaAccountNumber || !agent?.ogaranyaPhone) {
    //   // Return 0 if wallet not set up, or throw error
    //   return 0;
    //   // throw new BadRequestException('Agent wallet not properly set up with Ogaranya');
    // }

    // try {
    //   // Get balance from Ogaranya
    //   const walletInfo = await this.ogaranyaService.getWalletInfo({
    //     phone: agent.ogaranyaPhone,
    //     account_number: agent.ogaranyaAccountNumber,
    //   });

    //   if (walletInfo.status === 'success') {
    //     const balance = parseFloat(walletInfo.data?.balance || '0');

    //     // Update local cache
    //     await this.prisma.wallet.upsert({
    //       where: { agentId },
    //       update: {
    //         balance,
    //         lastSyncAt: new Date(),
    //       },
    //       create: {
    //         agentId,
    //         balance,
    //         lastSyncAt: new Date(),
    //       },
    //     });

    //     return balance;
    //   }

    //   throw new Error('Failed to fetch balance from Ogaranya');
    // } catch (error) {
    //   console.error('Ogaranya balance fetch failed:', error);

    //   // Fallback to cached balance
    //   const localWallet = await this.prisma.wallet.findUnique({
    //     where: { agentId },
    //   });

    //   return localWallet?.balance || 0;
    // }
  }

  async creditWallet(
    agentId: string,
    amount: number,
    reference: string,
    description?: string,
    paymentId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { agentId },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      const newBalance = wallet.balance + amount;

      await tx.wallet.update({
        where: { agentId },
        data: { balance: newBalance },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          agentId,
          type: WalletTransactionType.CREDIT,
          amount,
          previousBalance: wallet.balance,
          newBalance,
          reference,
          description,
          paymentId,
          status: WalletTransactionStatus.COMPLETED,
        },
      });
    });
  }

  async debitWallet(
    agentId: string,
    amount: number,
    reference: string,
    description?: string,
    saleId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { agentId },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      if (wallet.balance < amount) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const newBalance = wallet.balance - amount;

      await tx.wallet.update({
        where: { agentId },
        data: { balance: newBalance },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          agentId,
          type: WalletTransactionType.DEBIT,
          amount,
          previousBalance: wallet.balance,
          newBalance,
          reference,
          description,
          saleId,
          status: WalletTransactionStatus.COMPLETED,
        },
      });
    });
  }

  async getWalletTransactions(agentId: string, query?: GetWalletTransactionsQuery) {
    const { page = 1, limit = 100, type } = query;

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { agentId, ...(type? {type}: {}) },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    const total = await this.prisma.walletTransaction.count({
      where: { agentId },
    });

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(total / limitNumber),
    };
  }

  async getWalletStats(agentId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { agentId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // Aggregate stats
    const [creditSum, debitSum, transactionCount, pendingTopUps] =
      await this.prisma.$transaction([
        this.prisma.walletTransaction.aggregate({
          where: { agentId, type: WalletTransactionType.CREDIT, status: WalletTransactionStatus.COMPLETED },
          _sum: { amount: true },
        }),
        this.prisma.walletTransaction.aggregate({
          where: { agentId, type: WalletTransactionType.DEBIT, status: WalletTransactionStatus.COMPLETED },
          _sum: { amount: true },
        }),
        this.prisma.walletTransaction.count({
          where: { agentId },
        }),
        this.prisma.walletTransaction.count({
          where: { agentId, status: WalletTransactionStatus.PENDING },
        }),
      ]);

    const lastTransaction = await this.prisma.walletTransaction.findFirst({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      balance: wallet.balance,
      totalCredits: creditSum._sum.amount || 0,
      totalDebits: debitSum._sum.amount || 0,
      transactionCount,
      pendingTopUps,
      lastTransactionDate: lastTransaction?.createdAt || null,
    };
  }

  private async generateTestBVN(): Promise<string> {
    // Generate random 11-digit BVN for testing
    return Math.floor(10000000000 + Math.random() * 90000000000).toString();
  }
}
