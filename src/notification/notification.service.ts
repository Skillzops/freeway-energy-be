import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Customer } from '@prisma/client';
import { EmailService } from 'src/mailer/email.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TermiiService } from 'src/termii/termii.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private readonly termiiService: TermiiService,
  ) {}

  async sendTokenToCustomer(
    customer: Customer,
    deviceTokens: any,
  ): Promise<void> {
    if (customer.email) {
      await this.Email.sendMail({
        to: customer.email,
        from: this.config.get<string>('MAIL_FROM'),
        subject: `Here are your device tokens`,
        template: './device-tokens',
        context: {
          tokens: JSON.stringify(deviceTokens, undefined, 4),
        },
      });
    }

    if (customer.phone) {
      try {
        await this.termiiService.sendDeviceTokensSms(
          customer.phone,
          deviceTokens,
          customer.firstname || customer.lastname,
        );
      } catch (error) {
        console.error('Failed to send device tokens SMS:', error);
      }
    }
  }
}
