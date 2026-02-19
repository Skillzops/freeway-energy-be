// device.processor.ts
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DeviceService } from './services/device.service';
import { unlinkSync } from 'fs';
import {
  Agent,
  Customer,
  Device,
  PaymentMode,
  SaleItem,
  Sales,
  User,
} from '@prisma/client';
import { TokenReconciliationService } from './services/token-reconciliation.service';

export interface BatchTokenJobData {
  filePath: string;
  uploadedBy?: string;
  jobId: string;
  device: Device & {
    saleItems: (SaleItem & {
      paymentMode: PaymentMode;
      sale: Sales & { customer: Customer };
    })[];
  };
  agent?: Agent & { user: User };
  email?: string
}

export interface BatchTokenResult {
  success: boolean;
  jobId: string;
  devicesProcessed: number;
  totalRows: number;
  completedAt: string;
  tokens: Array<{
    deviceSerialNumber: string;
    deviceKey?: string;
    deviceToken: string;
    deviceId?: string;
    tokenId?: string;
    tokenDuration?: number;
    row: number; // To help track which row this token is for
  }>;
  errors?: Array<{
    row: number;
    error: string;
    deviceSerialNumber?: string;
  }>;
}

@Processor('device-processing')
@Injectable()
export class DeviceProcessor extends WorkerHost {
  private readonly logger = new Logger(DeviceProcessor.name);

  constructor(
    private readonly deviceService: DeviceService,
    private readonly tokenReconciliationService: TokenReconciliationService,
  ) {
    super();
  }

  async process(job: Job<BatchTokenJobData>): Promise<BatchTokenResult> {
    console.log(`[PROCESSOR] Processing job: ${job.id}, type: ${job.name}`);

    if (job.name === 'batch-token-generation') {
      const { filePath, jobId, uploadedBy } = job.data;

      try {
        await job.updateProgress(10);

        console.log(
          `[PROCESSOR] Starting batch token generation for job ${jobId}`,
        );

        // Process the batch with progress updates and get detailed results
        const result =
          await this.deviceService.createBatchDeviceTokensWithProgress(
            filePath,
            uploadedBy,
            async (progress: number) => {
              await job.updateProgress(Math.min(progress, 90));
            },
          );

        await job.updateProgress(100);
        console.log(
          `[PROCESSOR] Completed batch token generation for job ${jobId}`,
        );

        const batchResult: BatchTokenResult = {
          success: true,
          jobId,
          devicesProcessed: result.devicesProcessed,
          totalRows: result.totalRows,
          completedAt: new Date().toISOString(),
          tokens: result.tokens || [],
          errors: result.errors || [],
        };

        return batchResult;
      } catch (error) {
        console.error(
          `[PROCESSOR] Error in batch token generation job ${jobId}:`,
          error,
        );
        throw error;
      } finally {
        try {
          unlinkSync(filePath);
          console.log(`[PROCESSOR] Cleaned up file: ${filePath}`);
        } catch (error) {
          console.warn('[PROCESSOR] Failed to delete uploaded file:', error);
        }
      }
    }

    if (job.name === 'test-job') {
      console.log(`[PROCESSOR] Processing test job:`, job.data);
      return {
        success: true,
        jobId: job.id!.toString(),
        devicesProcessed: 0,
        totalRows: 0,
        completedAt: new Date().toISOString(),
        tokens: [],
      };
    }

    if (job.name === 'process-device-token-send') {
      const { device, agent } = job.data;
      await this.deviceService.processDeviceTokenSend(device, agent);

      return {
        success: true,
        jobId: job.id!.toString(),
        devicesProcessed: 0,
        totalRows: 0,
        completedAt: new Date().toISOString(),
        tokens: [],
      };
    }

    if (job.name === 'export-token-reconciliation') {
      this.logger.log(
        `Processing token reconciliation export job ${job.id} for email: ${job.data.email}`,
      );

      try {
        const result =
          await this.tokenReconciliationService.processTokenReconciliationExport(
            job.data.email,
          );
        return {
          success: result.success,
          jobId: job.id!.toString(),
          devicesProcessed: 0,
          totalRows: 0,
          completedAt: new Date().toISOString(),
          tokens: [],
        }; 
      } catch (error) {
        this.logger.error(
          `Error in token reconciliation job ${job.id}:`,
          error,
        );
        throw error;
      }
    }

    throw new Error(`Unknown job type: ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[PROCESSOR] Completed Device Queue Job ${job.id} ✅`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    console.error(`[PROCESSOR] Device Queue Job ${job.id} failed:`, err);
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number) {
    console.log(
      `[PROCESSOR] Device Queue Job ${job.id} progress: ${progress}%`,
    );
  }
}
