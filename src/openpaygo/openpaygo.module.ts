import { Module } from '@nestjs/common';
import { OpenPayGoService } from './openpaygo.service';
import { OpenpaygoController } from './openpaygo.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [OpenpaygoController],
  providers: [OpenPayGoService, PrismaService],
})
export class OpenpaygoModule {}
