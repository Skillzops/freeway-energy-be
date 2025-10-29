import { Module } from '@nestjs/common';
import { OdysseyService } from './odyssey.service';
import { OdysseyController } from './odyssey.controller';

@Module({
  controllers: [OdysseyController],
  providers: [OdysseyService],
})
export class OdysseyModule {}
