import { Module } from '@nestjs/common';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from 'src/jobstatus/jobstatus.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeviceProcessor } from './device.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
  ],
  controllers: [DeviceController],
  providers: [
    DeviceService,
    DeviceProcessor,
    OpenPayGoService,
    JobStatusService,
    PrismaService,
  ],
  exports: [
    BullModule,
    OpenPayGoService,
    DeviceProcessor,
    DeviceService,
    JobStatusService,
  ],
})
export class DeviceModule {}
