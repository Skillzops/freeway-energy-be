import { Module } from '@nestjs/common';
import { BeebeejumpService } from './beebeejump.service';
import { BeebeejumpController } from './beebeejump.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [BeebeejumpController],
  providers: [BeebeejumpService],
  exports: [BeebeejumpService],
})
export class BeebeejumpModule {}
