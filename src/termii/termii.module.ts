import { Module } from '@nestjs/common';
import { TermiiService } from './termii.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TermiiController } from './termii.controller';
import { NotificationService } from 'src/notification/notification.service';
import { EmailModule } from 'src/mailer/email.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    ConfigModule,
    EmailModule,
  ],
  controllers: [TermiiController],
  providers: [TermiiService, NotificationService],
})
export class TermiiModule {}
