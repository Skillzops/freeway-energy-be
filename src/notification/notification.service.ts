import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/mailer/email.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TermiiService } from 'src/termii/termii.service';

interface ITokenRecipient{
  email: string,
  firstname: string,
  lastname: string,
  phone?: string,
  // type?: "agent" | "customer"
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private readonly termiiService: TermiiService,
  ) {}

  async sendTokenToRecipient(
    recipient: ITokenRecipient,
    deviceTokens: any,
  ): Promise<void> {
    if (recipient.email) {
      await this.Email.sendMail({
        to: recipient.email,
        from: this.config.get<string>('MAIL_FROM'),
        subject: `Here are your device tokens`,
        template: './device-tokens',
        context: {
          // tokens: JSON.stringify(deviceTokens, undefined, 4),
          tokens: deviceTokens,
        },
      });
    }

    if (recipient.phone) {
      try {
        await this.termiiService.sendDeviceTokensSms(
          recipient.phone,
          deviceTokens,
          recipient.firstname || recipient.lastname,
        );
      } catch (error) {
        console.error('Failed to send device tokens SMS:', error);
      }
    }
  }
}
