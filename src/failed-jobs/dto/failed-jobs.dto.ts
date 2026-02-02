import { IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class FailedJobsQueryDto {
  @IsOptional()
  @IsString()
  queue?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 100;
}

export class FailedJobDetailDto {
  id: string;
  name: string;
  data: any;
  reason: string;
  failedReason: string;
  stacktrace: string[];
  timestamp: number;
  attemptsMade: number;
  maxAttempts: number;
  processedOn?: number;
  finishedOn?: number;
  delay?: number;
}

export class FailedJobWithContextDto extends FailedJobDetailDto {
  relatedData?: any;
}

export class QueueStatsDto {
  queueName: string;
  total: number;
  failed: number;
  completed: number;
  active: number;
  waiting: number;
  delayed: number;
  paused: number;
}

export class AllQueuesStatsDto {
  queues: QueueStatsDto[];
  totals: {
    failed: number;
    active: number;
    completed: number;
    total: number;
  };
}

export class GroupedFailedJobsDto {
  reason: string;
  count: number;
  jobs: FailedJobDetailDto[];
}