import { forwardRef, Module } from '@nestjs/common';
import { OgaranyaService } from './ogaranya.service';
import { OgaranyaController } from './ogaranya.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';
import { OpenPayGoService } from 'src/openpaygo/openpaygo.service';
import { ReferenceGeneratorService } from 'src/payment/reference-generator.service';

@Module({
  controllers: [OgaranyaController],
  imports: [forwardRef(() => PaymentModule)],
  providers: [
    OgaranyaService,
    PrismaService,
    ConfigService,
    OpenPayGoService,
    ReferenceGeneratorService,
  ],
  exports: [OgaranyaService, ReferenceGeneratorService],
})
export class OgaranyaModule {}
