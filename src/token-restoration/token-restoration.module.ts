import { Module } from '@nestjs/common';
import { TokenRestorationService } from './token-restoration.service';
import { TokenRestorationController } from './token-restoration.controller';

@Module({
  controllers: [TokenRestorationController],
  providers: [TokenRestorationService],
})
export class TokenRestorationModule {}
