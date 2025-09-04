import { Module } from '@nestjs/common';
import { TaskManagementService } from './task-management.service';
import { TaskManagementController } from './task-management.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { SalesModule } from 'src/sales/sales.module';
import { InstallerModule } from 'src/installer/installer.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [SalesModule, InstallerModule, AuthModule],
  controllers: [TaskManagementController],
  providers: [TaskManagementService, PrismaService],
})
export class TaskManagementModule {}
