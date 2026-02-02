import { Test, TestingModule } from '@nestjs/testing';
import { FailedJobsService } from './failed-jobs.service';

describe('FailedJobsService', () => {
  let service: FailedJobsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FailedJobsService],
    }).compile();

    service = module.get<FailedJobsService>(FailedJobsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
