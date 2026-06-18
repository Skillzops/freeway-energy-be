import { Test, TestingModule } from '@nestjs/testing';
import { BeebeejumpService } from './beebeejump.service';

describe('BeebeejumpService', () => {
  let service: BeebeejumpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BeebeejumpService],
    }).compile();

    service = module.get<BeebeejumpService>(BeebeejumpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
