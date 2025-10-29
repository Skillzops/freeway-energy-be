import { Test, TestingModule } from '@nestjs/testing';
import { OdysseyController } from './odyssey.controller';
import { OdysseyService } from './odyssey.service';

describe('OdysseyController', () => {
  let controller: OdysseyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OdysseyController],
      providers: [OdysseyService],
    }).compile();

    controller = module.get<OdysseyController>(OdysseyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
