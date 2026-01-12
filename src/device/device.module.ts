import { Module } from '@nestjs/common';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from 'src/jobstatus/jobstatus.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeviceProcessor } from './device.processor';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationModule } from 'src/notification/notification.module';
import { DeviceAssignmentService } from './device-assignment.service';
import { DeviceAssignmentController } from './device-assignment.controller';
import { DeviceAssignmentMigrationService } from './device-assignment-migration.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
    AuthModule,
    NotificationModule,
  ],
  controllers: [DeviceController, DeviceAssignmentController],
  providers: [
    DeviceService,
    DeviceProcessor,
    OpenPayGoService,
    JobStatusService,
    DeviceAssignmentService,
    DeviceAssignmentMigrationService,
    PrismaService,
  ],
  exports: [
    BullModule,
    OpenPayGoService,
    DeviceProcessor,
    DeviceService,
    JobStatusService,
    DeviceAssignmentService,
    DeviceAssignmentMigrationService,
  ],
})
export class DeviceModule {}
