import { forwardRef, Module } from '@nestjs/common';
import { OgaranyaService } from './ogaranya.service';
import { OgaranyaController } from './ogaranya.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';
import { ReferenceGeneratorService } from 'src/payment/reference-generator.service';
import { DeviceModule } from 'src/device/device.module';
import { NotificationModule } from 'src/notification/notification.module';
import { BeebeejumpModule } from 'src/beebeejump/beebeejump.module';

@Module({
  controllers: [OgaranyaController],
  imports: [
    forwardRef(() => PaymentModule),
    DeviceModule,
    NotificationModule,
    BeebeejumpModule,
  ],
  providers: [
    OgaranyaService,
    PrismaService,
    ConfigService,
    ReferenceGeneratorService,
  ],
  exports: [OgaranyaService, ReferenceGeneratorService],
})
export class OgaranyaModule {}
