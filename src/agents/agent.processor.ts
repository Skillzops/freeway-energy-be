import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AgentsService } from './agents.service';

@Processor('agent-queue')
export class AgentProcessor extends WorkerHost {
  constructor(private readonly agentsService: AgentsService) {
    super();
  }

  async process(job: Job) {
    console.log(`[PROCESSOR] Processing job: ${job.id}, type: ${job.name}`);

    try {
      switch (job.name) {
        case 'process-agent-credentials':
          return await this.agentsService.generateAllAgentCredentials();
        default:
          console.warn(`[PROCESSOR] Unknown job type: ${job.name}`);
          return { processed: false, error: 'Unknown job type' };
      }
    } catch (error) {
      console.error(`[PROCESSOR] Job ${job.name} failed:`, error.message);
      throw error; // Rethrow to trigger retry
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`✅ Agent Queue Job Completed: ${job.name} (${job.id})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    console.error(
      `❌ Agent Queue Job Failed: ${job.name} (${job.id})`,
      err.message,
    );
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number) {
    console.log(
      `🔄 Payment Queue Job Progress: ${job.name} (${job.id}) - ${progress}%`,
    );
  }
}
