import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Global()
@Module({
  imports: [forwardRef(() => AuditLogModule)],
  providers: [PrismaService],
  exports: [PrismaService, AuditLogModule],
})
export class PrismaModule {}
