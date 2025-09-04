import { Module } from '@nestjs/common';
import { JobStatusService } from './jobstatus.service';
import { BullModule } from '@nestjs/bullmq';
import { DeviceService } from 'src/device/device.service';
import { OpenPayGoService } from 'src/openpaygo/openpaygo.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'device-processing',
    }),
    AuthModule,
  ],

  providers: [JobStatusService, OpenPayGoService, DeviceService],
  exports: [BullModule],
})
export class JobstatusModule {}
