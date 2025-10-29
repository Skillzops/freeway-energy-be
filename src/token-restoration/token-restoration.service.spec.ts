import { Test, TestingModule } from '@nestjs/testing';
import { TokenRestorationService } from './token-restoration.service';

describe('TokenRestorationService', () => {
  let service: TokenRestorationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TokenRestorationService],
    }).compile();

    service = module.get<TokenRestorationService>(TokenRestorationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
