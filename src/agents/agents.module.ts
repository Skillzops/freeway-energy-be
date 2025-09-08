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
import { DeviceModule } from 'src/device/device.module';
import { BullModule } from '@nestjs/bullmq';
import { AgentProcessor } from './agent.processor';

@Module({
  imports: [
    EmailModule,
    ProductsModule,
    SalesModule,
    CustomersModule,
    OgaranyaModule,
    DeviceModule,
    BullModule.registerQueue({
      name: 'agent-queue',
    }),
  ],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    PrismaService,
    WalletService,
    InstallerService,
    AgentProcessor,
  ],
  exports: [AgentsService, WalletService, InstallerService],
})
export class AgentsModule {}
