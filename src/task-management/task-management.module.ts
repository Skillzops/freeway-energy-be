import { Module } from '@nestjs/common';
import { TaskManagementService } from './task-management.service';
import { TaskManagementController } from './task-management.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { SalesModule } from 'src/sales/sales.module';
import { InstallerModule } from 'src/installer/installer.module';
import { DeviceModule } from 'src/device/device.module';

@Module({
  imports: [SalesModule, InstallerModule, DeviceModule],
  controllers: [TaskManagementController],
  providers: [TaskManagementService, PrismaService],
})
export class TaskManagementModule {}
