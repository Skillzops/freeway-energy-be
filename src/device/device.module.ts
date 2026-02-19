import { Module } from '@nestjs/common';
import { DeviceService } from './services/device.service';
import { DeviceController } from './controllers/device.controller';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from 'src/jobstatus/jobstatus.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeviceProcessor } from './device.processor';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationModule } from 'src/notification/notification.module';
import { DeviceAssignmentService } from './services/device-assignment.service';
import { DeviceAssignmentController } from './controllers/device-assignment.controller';
import { DeviceAssignmentMigrationService } from './services/device-assignment-migration.service';
import { DeviceLocationUpdateController } from './controllers/device-location-update.controller';
import { DeviceLocationUpdateService } from './services/device-location-update.service';
import { FileParserService } from 'src/csv-upload/file-parser.service';
import { TokenGenerationFailureController } from './controllers/token-generation-failure.controller';
import { TokenGenerationFailureService } from './services/token-generation-failure.service';
import { TokenReconciliationController } from './controllers/token-reconciliation.controller';
import { TokenReconciliationService } from './services/token-reconciliation.service';
import { EmailModule } from 'src/mailer/email.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
    AuthModule,
    NotificationModule,
    EmailModule,
  ],
  controllers: [
    DeviceController,
    DeviceAssignmentController,
    DeviceLocationUpdateController,
    TokenGenerationFailureController,
    TokenReconciliationController,
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
    TokenReconciliationService,
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
    TokenReconciliationService
  ],
})
export class DeviceModule {}
