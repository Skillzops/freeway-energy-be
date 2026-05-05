import { forwardRef, Module } from '@nestjs/common';
import { PaystackController } from './paystack.controller';
import { PaystackService } from './paystack.service';
import { PaymentModule } from 'src/payment/payment.module';

@Module({
  imports: [forwardRef(() => PaymentModule)],
  controllers: [PaystackController],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
