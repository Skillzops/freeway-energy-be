import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaystackController } from './paystack.controller';
import { PaystackService } from './paystack.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'payment-queue',
    }),
  ],
  controllers: [PaystackController],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
