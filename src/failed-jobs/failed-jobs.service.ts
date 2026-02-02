import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export interface FailedJobDetail {
  id: string;
  name: string;
  data: any;
  reason: string;
  failedReason: string;
  stacktrace: string[];
  timestamp: number;
  attemptsMade: number;
  maxAttempts: number;
  processedOn?: number;
  finishedOn?: number;
  delay?: number;
}

@Injectable()
export class FailedJobsService {
  private readonly logger = new Logger(FailedJobsService.name);

  constructor(
    @InjectQueue('payment-queue') private paymentQueue: Queue,
    @InjectQueue('csv-processing') private csvQueue: Queue,
    @InjectQueue('device-processing') private deviceQueue: Queue,
    @InjectQueue('agent-queue') private agentQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  private getQueueByName(queueName: string): Queue {
    const queues = {
      'payment-queue': this.paymentQueue,
      'csv-processing': this.csvQueue,
      'device-processing': this.deviceQueue,
      'agent-queue': this.agentQueue,
    };
    return queues[queueName];
  }

  async getFailedJobs(queueName: string, limit: number = 100) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed(0, limit);
    return this.formatJobs(failedJobs);
  }

  async getFailedJobsCount(queueName?: string) {
    if (queueName) {
      const queue = this.getQueueByName(queueName);
      if (!queue) {
        throw new BadRequestException(`Queue ${queueName} not found`);
      }
      return queue.getFailedCount();
    }

    const counts = await Promise.all([
      this.paymentQueue.getFailedCount(),
      this.csvQueue.getFailedCount(),
      this.deviceQueue.getFailedCount(),
      this.agentQueue.getFailedCount(),
    ]);

    return {
      'payment-queue': counts[0],
      'csv-processing': counts[1],
      'device-processing': counts[2],
      'agent-queue': counts[3],
      total: counts.reduce((a, b) => a + b, 0),
    };
  }

  async getFailedJobDetail(queueName: string, jobId: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new BadRequestException(`Job ${jobId} is not in failed state`);
    }

    return this.formatJobDetail(job);
  }

  async retryFailedJob(queueName: string, jobId: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new BadRequestException(`Job ${jobId} is not in failed state`);
    }

    try {
      await job.retry();
      this.logger.log(`Job ${jobId} retried successfully`);
      return { success: true, message: 'Job retried', jobId };
    } catch (error) {
      throw new BadRequestException(`Failed to retry job: ${error.message}`);
    }
  }

  async retryAllFailedJobs(queueName: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed(0, -1);
    let retried = 0;
    let failed = 0;

    for (const job of failedJobs) {
      try {
        await job.retry();
        retried++;
      } catch (error) {
        this.logger.error(`Failed to retry job ${job.id}:`, error.message);
        failed++;
      }
    }

    return {
      success: true,
      message: `Retried ${retried} jobs, ${failed} failed`,
      retried,
      failed,
      total: failedJobs.length,
    };
  }

  async removeFailedJob(queueName: string, jobId: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Job ${jobId} not found`);
    }

    await job.remove();
    this.logger.log(`Job ${jobId} removed`);
    return { success: true, message: 'Job removed', jobId };
  }

  async removeAllFailedJobs(queueName: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed(0, -1);
    let removed = 0;

    for (const job of failedJobs) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        this.logger.error(`Failed to remove job ${job.id}:`, error.message);
      }
    }

    this.logger.log(`Removed ${removed} failed jobs from ${queueName}`);
    return { success: true, message: `Removed ${removed} jobs`, removed };
  }

  async getQueueStats(queueName: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const [
      count,
      failedCount,
      completedCount,
      activeCount,
      waitingCount,
      delayedCount,
    ] = await Promise.all([
      queue.count(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
      queue.getActiveCount(),
      queue.getWaitingCount(),
      queue.getDelayedCount(),
    ]);

    return {
      queueName,
      total: count,
      failed: failedCount,
      completed: completedCount,
      active: activeCount,
      waiting: waitingCount,
      delayed: delayedCount,
    };
  }

  async getAllQueuesStats() {
    const paymentStats = await this.getQueueStats('payment-queue');
    const csvStats = await this.getQueueStats('csv-processing');
    const deviceStats = await this.getQueueStats('device-processing');
    const agentStats = await this.getQueueStats('agent-queue');

    return {
      queues: [paymentStats, csvStats, deviceStats, agentStats],
      totals: {
        failed: paymentStats.failed + csvStats.failed + deviceStats.failed + agentStats.failed,
        active: paymentStats.active + csvStats.active + deviceStats.active + agentStats.active,
        completed: paymentStats.completed + csvStats.completed + deviceStats.completed + agentStats.completed,
        total: paymentStats.total + csvStats.total + deviceStats.total + agentStats.total,
      },
    };
  }

  private formatJobs(jobs: Job[]): FailedJobDetail[] {
    return jobs.map((job) => this.formatJobDetail(job));
  }

  private formatJobDetail(job: Job): FailedJobDetail {
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      reason: job.failedReason || 'Unknown reason',
      failedReason: job.failedReason,
      stacktrace: job.stacktrace || [],
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 1,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      delay: job.delay,
    };
  }

  async cleanupOldFailedJobs(queueName: string, daysOld: number = 7) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const failedJobs = await queue.getFailed(0, -1);

    let removed = 0;
    for (const job of failedJobs) {
      if (job.finishedOn && job.finishedOn < cutoffTime) {
        await job.remove();
        removed++;
      }
    }

    this.logger.log(
      `Removed ${removed} failed jobs older than ${daysOld} days from ${queueName}`,
    );
    return {
      success: true,
      message: `Removed ${removed} old failed jobs`,
      removed,
      daysOld,
    };
  }

  async getFailedJobsGroupedByReason(queueName: string) {
    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed(0, -1);
    const grouped: { [key: string]: FailedJobDetail[] } = {};

    for (const job of failedJobs) {
      const reason = job.failedReason || 'Unknown';
      if (!grouped[reason]) {
        grouped[reason] = [];
      }
      grouped[reason].push(this.formatJobDetail(job));
    }

    return Object.entries(grouped).map(([reason, jobs]) => ({
      reason,
      count: jobs.length,
      jobs,
    }));
  }
}
