import { Module } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [FlutterwaveService, ConfigService, PrismaService],
  exports: [FlutterwaveService],
})
export class FlutterwaveModule {}
