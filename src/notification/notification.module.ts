import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { EmailModule } from 'src/mailer/email.module';
import { TermiiService } from 'src/termii/termii.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    EmailModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService, TermiiService, PrismaService],
  exports: [NotificationService, TermiiService, PrismaService],
})
export class NotificationModule {}
