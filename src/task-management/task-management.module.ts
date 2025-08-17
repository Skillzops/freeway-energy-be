import { Module } from '@nestjs/common';
import { TaskManagementService } from './task-management.service';
import { TaskManagementController } from './task-management.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentsModule } from 'src/agents/agents.module';
import { SalesModule } from 'src/sales/sales.module';
import { InstallerModule } from 'src/installer/installer.module';

@Module({
  imports: [AgentsModule, SalesModule, InstallerModule],
  controllers: [TaskManagementController],
  providers: [TaskManagementService, PrismaService],
})
export class TaskManagementModule {}
