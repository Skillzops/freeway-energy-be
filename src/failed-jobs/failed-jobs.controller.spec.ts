import { Test, TestingModule } from '@nestjs/testing';
import { FailedJobsController } from './failed-jobs.controller';
import { FailedJobsService } from './failed-jobs.service';

describe('FailedJobsController', () => {
  let controller: FailedJobsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FailedJobsController],
      providers: [FailedJobsService],
    }).compile();

    controller = module.get<FailedJobsController>(FailedJobsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
