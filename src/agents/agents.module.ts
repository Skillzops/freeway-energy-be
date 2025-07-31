import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EmailModule } from '../mailer/email.module';
import { WalletService } from '../wallet/wallet.service';
import { ProductsModule } from '../products/products.module';
import { SalesModule } from '../sales/sales.module';
import { CustomersModule } from '../customers/customers.module';
import { InstallerService } from '../installer/installer.service';
import { OgaranyaModule } from '../ogaranya/ogaranya.module';

@Module({
  imports: [EmailModule, ProductsModule, SalesModule, CustomersModule, OgaranyaModule],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    PrismaService,
    WalletService,
    InstallerService,
  ],
  exports: [AgentsService, WalletService, InstallerService],
})
export class AgentsModule {}
