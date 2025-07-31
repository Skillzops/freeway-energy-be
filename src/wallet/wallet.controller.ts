import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AgentAccessGuard } from '../auth/guards/agent-access.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { WalletService } from './wallet.service';
import { PaymentService } from '../payment/payment.service';
import { GetSessionUser } from '../auth/decorators/getUser';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateAgentWalletDto } from './dto/create-agent-wallet.dto';
import { PaymentGateway } from '@prisma/client';
import { WalletTopUpDto } from './dto/wallet-topup.dto';

@Controller('wallet')
@ApiTags('Wallet')
@UseGuards(JwtAuthGuard, AgentAccessGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly paymentService: PaymentService,
  ) {}

  @Post('setup')
  @ApiOperation({ summary: 'Set up agent wallet with Ogaranya' })
  async setupWallet(
    @Body() walletData: CreateAgentWalletDto,
    @GetSessionUser('agent') agent: any,
  ) {
    return this.walletService.createAgentWallet(agent.id, walletData);
  }

  @Get('balance')
  async getBalance(@GetSessionUser('agent') agent: any) {
    return {
      balance: await this.walletService.getWalletBalance(agent.id),
      agentId: agent.id,
    };
  }

  @Get('transactions')
  async getTransactions(
    @GetSessionUser('agent') agent: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.walletService.getWalletTransactions(agent.id, page, limit);
  }

  @Post('topup')
  @ApiOperation({ summary: 'Top up wallet using selected payment gateway' })
  @ApiBody({ type: WalletTopUpDto })
  async topUpWallet(
    @Body() topUpDto: WalletTopUpDto,
    @GetSessionUser('agent') agent: any,
  ) {
    const gateway = topUpDto.gateway || PaymentGateway.OGARANYA;

    const paymentData = await this.paymentService.generateWalletTopUpPayment(
      agent.id,
      topUpDto.amount,
      gateway,
    );

    return {
      ...paymentData,
      gateway,
      amount: topUpDto.amount,
    };
  }

  @Post('verify-topup')
  @ApiOperation({ summary: 'Manually verify wallet top-up' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reference: {
          type: 'string',
          description: 'Top-up reference',
          example: 'TOP-ABC123',
        },
      },
      required: ['reference'],
    },
  })
  async verifyTopUp(@Body() body: { reference: string }) {
    return this.paymentService.verifyWalletTopUpManually(body.reference);
  }

  @Get('pending-topups')
  @ApiOperation({ summary: 'Get pending top-up requests' })
  async getPendingTopUps(@GetSessionUser('agent') agent: any) {
    return this.paymentService.getPendingTopUps(agent.id);
  }
}
