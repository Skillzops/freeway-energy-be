import { Test, TestingModule } from '@nestjs/testing';
import { TokenRestorationController } from './token-restoration.controller';
import { TokenRestorationService } from './token-restoration.service';

describe('TokenRestorationController', () => {
  let controller: TokenRestorationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TokenRestorationController],
      providers: [TokenRestorationService],
    }).compile();

    controller = module.get<TokenRestorationController>(TokenRestorationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
