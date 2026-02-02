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
import { DeviceLocationUpdateController } from './device-location-update.controller';
import { DeviceLocationUpdateService } from './device-location-update.service';
import { FileParserService } from 'src/csv-upload/file-parser.service';
import { TokenGenerationFailureController } from './token-generation-failure.comtroller';
import { TokenGenerationFailureService } from './token-generation-failure.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
    AuthModule,
    NotificationModule,
  ],
  controllers: [
    DeviceController,
    DeviceAssignmentController,
    DeviceLocationUpdateController,
    TokenGenerationFailureController,
  ],
  providers: [
    DeviceService,
    DeviceProcessor,
    OpenPayGoService,
    JobStatusService,
    FileParserService,
    DeviceAssignmentService,
    DeviceLocationUpdateService,
    DeviceAssignmentMigrationService,
    PrismaService,
    TokenGenerationFailureService,
  ],
  exports: [
    BullModule,
    OpenPayGoService,
    DeviceProcessor,
    DeviceService,
    JobStatusService,
    FileParserService,
    DeviceAssignmentService,
    DeviceLocationUpdateService,
    DeviceAssignmentMigrationService,
    TokenGenerationFailureService,
  ],
})
export class DeviceModule {}
