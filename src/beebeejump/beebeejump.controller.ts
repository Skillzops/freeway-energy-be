import { Body, Controller, Post } from '@nestjs/common';
import { GetActivationRequestDto } from './dto/get-activation.dto';
import { BeebeejumpService } from './beebeejump.service';

@Controller('activation')
export class BeebeejumpController {
  constructor(private readonly svc: BeebeejumpService) {}

  @Post('code')
  async getCode(@Body() dto: GetActivationRequestDto) {
    return this.svc.getActivationCode(dto);
  }
}
