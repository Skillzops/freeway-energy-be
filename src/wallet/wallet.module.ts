import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentModule } from '../payment/payment.module';
import { OgaranyaModule } from '../ogaranya/ogaranya.module';

@Module({
  imports: [PaymentModule, OgaranyaModule],
  controllers: [WalletController],
  providers: [WalletService, PrismaService],
  exports: [WalletService],
})
export class WalletModule {}
