import { Module } from '@nestjs/common';
import { FailedJobsService } from './failed-jobs.service';
import { FailedJobsController } from './failed-jobs.controller';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'payment-queue' },
      { name: 'csv-processing' },
      { name: 'device-processing' },
      { name: 'agent-queue' },
    ),
  ],
  controllers: [FailedJobsController],
  providers: [FailedJobsService],
})
export class FailedJobsModule {}
