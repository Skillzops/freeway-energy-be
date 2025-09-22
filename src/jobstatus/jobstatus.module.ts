import { Module } from '@nestjs/common';
import { JobStatusService } from './jobstatus.service';
import { BullModule } from '@nestjs/bullmq';
import { OpenPayGoService } from 'src/openpaygo/openpaygo.service';
import { AuthModule } from 'src/auth/auth.module';
import { DeviceModule } from 'src/device/device.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
    AuthModule,
    DeviceModule
  ],

  providers: [JobStatusService, OpenPayGoService],
  exports: [BullModule],
})
export class JobstatusModule {}
