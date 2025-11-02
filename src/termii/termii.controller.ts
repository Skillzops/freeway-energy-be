import { Controller, Get } from '@nestjs/common';
import { TermiiService } from './termii.service';
import { NotificationService } from 'src/notification/notification.service';

@Controller('termii')
export class TermiiController {
  constructor(
    private readonly termiiService: TermiiService,
    private readonly notificationService: NotificationService,
  ) {}

  @Get('')
  async testConnection() {
    return await this.termiiService.testSmsConnection();
  }

  @Get('send-sms')
  async processDeviceTokenSend() {
    const tokensToSend = [
      {
        deviceSerialNumber: 'device.serialNumber',
        deviceKey: 'device.key',
        deviceToken: 'RTHSSST',
      },
      {
        deviceSerialNumber: 'device.serialNumber',
        deviceKey: 'device.key',
        deviceToken: 'RTHSSST',
      },
    ];

    await this.notificationService.sendTokenToRecipient(
      {
        firstname: 'Francis',
        lastname: 'Okonkwo',
        phone: '07084421497',
        email: 'francisalexander000@gmail.com',
      },
      tokensToSend,
    );
  }
}
