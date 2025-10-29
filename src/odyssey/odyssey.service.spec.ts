import { Test, TestingModule } from '@nestjs/testing';
import { OdysseyService } from './odyssey.service';

describe('OdysseyService', () => {
  let service: OdysseyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OdysseyService],
    }).compile();

    service = module.get<OdysseyService>(OdysseyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
