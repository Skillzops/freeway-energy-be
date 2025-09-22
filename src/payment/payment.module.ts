import { forwardRef, Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { ConfigService } from '@nestjs/config';
import { EmailModule } from '../mailer/email.module';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { PrismaService } from '../prisma/prisma.service';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { EmailService } from '../mailer/email.service';
import { BullModule } from '@nestjs/bullmq';
import { PaymentProcessor } from './payment.processor';
import { TermiiService } from '../termii/termii.service';
import { HttpModule } from '@nestjs/axios';
import { WalletService } from 'src/wallet/wallet.service';
import { ReferenceGeneratorService } from './reference-generator.service';
import { OgaranyaModule } from 'src/ogaranya/ogaranya.module';
import { FlutterwaveModule } from 'src/flutterwave/flutterwave.module';
import { DeviceModule } from 'src/device/device.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    EmailModule,
    forwardRef(() => OgaranyaModule),
    BullModule.registerQueue({
      name: 'payment-queue',
    }),
    FlutterwaveModule,
    DeviceModule,
    NotificationModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    ConfigService,
    OpenPayGoService,
    PrismaService,
    FlutterwaveService,
    EmailService,
    PaymentProcessor,
    TermiiService,
    WalletService,
    ReferenceGeneratorService,
  ],
  exports: [
    PaymentService,
    ConfigService,
    OpenPayGoService,
    PrismaService,
    FlutterwaveService,
    EmailService,
    PaymentProcessor,
    TermiiService,
    WalletService,
    ReferenceGeneratorService,
  ],
})
export class PaymentModule {}
