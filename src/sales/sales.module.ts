import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ContractService } from '../contract/contract.service';
import { EmailService } from '../mailer/email.service';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { TermiiService } from '../termii/termii.service';
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { WalletModule } from 'src/wallet/wallet.module';
import { PaymentModule } from 'src/payment/payment.module';
import { AuthModule } from 'src/auth/auth.module';
import { SalesIdGeneratorService } from './saleid-generator';
import { DeviceAssignmentService } from 'src/device/device-assignment.service';
import { SaleReversalService } from './sale-reversal.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    CloudinaryModule,
    BullModule.registerQueue({
      name: 'payment-queue',
    }),
    WalletModule,
    PaymentModule,
    AuthModule,
  ],
  controllers: [SalesController],
  providers: [
    SalesService,
    PrismaService,
    OpenPayGoService,
    ContractService,
    EmailService,
    FlutterwaveService,
    TermiiService,
    ConfigService,
    SalesIdGeneratorService,
    SaleReversalService,
    DeviceAssignmentService,
  ],
  exports: [
    SalesService,
    OpenPayGoService,
    ContractService,
    EmailService,
    FlutterwaveService,
    TermiiService,
    ConfigService,
    SalesIdGeneratorService,
    SaleReversalService,
    DeviceAssignmentService,
  ],
})
export class SalesModule {}
