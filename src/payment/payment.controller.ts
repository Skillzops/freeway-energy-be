import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  // UnauthorizedException,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
// import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
// import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
// import { ActionEnum, SubjectEnum } from '@prisma/client';
import { GetSessionUser } from 'src/auth/decorators/getUser';
import { AgentAccessGuard } from 'src/auth/guards/agent-access.guard';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService,
    @InjectQueue('payment-queue') private paymentQueue: Queue,
  ) {}

  // @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  // @RolesAndPermissions({
  //   permissions: [
  //     `${ActionEnum.manage}:${SubjectEnum.Agents}`,
  //     `${ActionEnum.write}:${SubjectEnum.Agents}`,
  //   ],
  // })
  @Post('verify')
  @ApiOperation({ summary: 'Manually verify payment status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        transactionRef: {
          type: 'string',
          description: 'Payment transaction reference',
          example: 'sale-123-1234567890',
        },
      },
      required: ['transactionRef'],
    },
  })
  async verifyPayment(@Body() body: { transactionRef: string }) {
    return this.paymentService.verifyPaymentManually(body.transactionRef);
  }

  @UseGuards(JwtAuthGuard, AgentAccessGuard)
  @Get('pending')
  @ApiOperation({ summary: 'Get pending payments for agent' })
  async getPendingPayments(@GetSessionUser('agent') agent: any) {
    return this.paymentService.getPendingPayments(agent.id);
  }

  // @ApiOperation({ summary: 'Verify payment callback' })
  // @ApiQuery({
  //   name: 'tx_ref',
  //   type: String,
  //   description: 'Transaction reference',
  // })
  // @ApiQuery({
  //   name: 'transaction_id',
  //   type: Number,
  //   description: 'Transaction ID',
  // })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  // })
  // @HttpCode(HttpStatus.OK)
  // @Get('verify/callback')
  // async verifyPayment(
  //   @Query('tx_ref') tx_ref: string,
  //   @Query('transaction_id') transaction_id: number,
  // ) {
  //   try {
  //     console.log('[CONTROLLER] Starting payment verification for:', {
  //       tx_ref,
  //       transaction_id,
  //     });

  //     // Check if queue is ready
  //     await this.paymentQueue.waitUntilReady();
  //     console.log('[CONTROLLER] Queue is ready');

  //     const job = await this.paymentQueue.add(
  //       'verify-payment',
  //       { tx_ref, transaction_id },
  //       {
  //         attempts: 3,
  //         backoff: {
  //           type: 'exponential',
  //           delay: 5000,
  //         },
  //         removeOnComplete: true,
  //         removeOnFail: false,
  //         delay: 1000, // Add small delay to ensure job is processed
  //       },
  //     );

  //     console.log('[CONTROLLER] Job added successfully:', {
  //       jobId: job.id,
  //       jobName: job.name,
  //       jobData: job.data,
  //     });

  //     // Get queue stats for debugging
  //     const waiting = await this.paymentQueue.getWaiting();
  //     const active = await this.paymentQueue.getActive();
  //     const completed = await this.paymentQueue.getCompleted();
  //     const failed = await this.paymentQueue.getFailed();

  //     console.log('[CONTROLLER] Queue stats:', {
  //       waiting: waiting.length,
  //       active: active.length,
  //       completed: completed.length,
  //       failed: failed.length,
  //     });

  //     return {
  //       message: 'Payment verification initiated successfully',
  //       jobId: job.id,
  //       status: 'processing',
  //     };
  //   } catch (error) {
  //     console.error('[CONTROLLER] Error adding job to queue:', error);

  //     // Fallback to direct processing if queue fails
  //     console.log('[CONTROLLER] Falling back to direct processing');
  //     try {
  //       await this.paymentService.verifyPayment(tx_ref, transaction_id);
  //       return { message: 'Payment verified directly (queue failed)' };
  //     } catch (directError) {
  //       console.error(
  //         '[CONTROLLER] Direct processing also failed:',
  //         directError,
  //       );
  //       throw new BadRequestException('Payment verification failed');
  //     }
  //   }
  // }
}
