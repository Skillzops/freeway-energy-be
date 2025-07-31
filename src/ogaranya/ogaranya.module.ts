import { forwardRef, Module } from '@nestjs/common';
import { OgaranyaService } from './ogaranya.service';
import { OgaranyaController } from './ogaranya.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PaymentModule } from '../payment/payment.module';

@Module({
  controllers: [OgaranyaController],
  imports: [forwardRef(() => PaymentModule)],
  providers: [OgaranyaService, PrismaService, ConfigService],
  exports: [OgaranyaService],
})
export class OgaranyaModule {}
