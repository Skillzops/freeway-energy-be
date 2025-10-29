import { Controller } from '@nestjs/common';
import { TokenRestorationService } from './token-restoration.service';

@Controller('token-restoration')
export class TokenRestorationController {
  constructor(private readonly tokenRestorationService: TokenRestorationService) {}
}
