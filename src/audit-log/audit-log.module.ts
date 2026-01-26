import { Module, forwardRef } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { AuditChangeTrackingService } from './audit-change-tracking.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [forwardRef(() => PrismaModule)],
  controllers: [AuditLogController],
  providers: [
    AuditChangeTrackingService,
    AuditLogService,
  ],
  exports: [
    AuditLogService,
    AuditChangeTrackingService,
  ],
})
export class AuditLogModule {}