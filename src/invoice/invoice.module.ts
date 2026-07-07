import { Module, forwardRef } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PaymentModule } from '../payment/payment.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailModule } from '../mailer/email.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogModule,
    forwardRef(() => PaymentModule),
    CloudinaryModule,
    EmailModule,
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoicePdfService],
  exports: [InvoiceService, InvoicePdfService],
})
export class InvoiceModule {}
