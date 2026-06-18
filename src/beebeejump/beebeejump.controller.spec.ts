import { Test, TestingModule } from '@nestjs/testing';
import { BeebeejumpController } from './beebeejump.controller';
import { BeebeejumpService } from './beebeejump.service';

describe('BeebeejumpController', () => {
  let controller: BeebeejumpController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BeebeejumpController],
      providers: [BeebeejumpService],
    }).compile();

    controller = module.get<BeebeejumpController>(BeebeejumpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
