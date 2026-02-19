import { Controller, Post, Logger } from '@nestjs/common';
import { TokenReconciliationService } from '../services/token-reconciliation.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('exports')
export class TokenReconciliationController {
  private readonly logger = new Logger(TokenReconciliationController.name);

  constructor(
    private readonly tokenReconciliationService: TokenReconciliationService,
  ) {}

  /**
   * Initiate token reconciliation export
   * Returns immediately while processing happens in background via Bull queue
   */
  @ApiExcludeEndpoint()
  @Post('token-reconciliation')
  async generateTokenReconciliationReport(): Promise<{
    success: boolean;
    jobId: string;
    message: string;
  }> {
    try {
      const result =
        await this.tokenReconciliationService.initiateTokenReconciliationExport();

      return {
        success: true,
        jobId: result.jobId,
        message: result.message,
      };
    } catch (error) {
      this.logger.error(
        'Error initiating token reconciliation export',
        error,
      );
      return {
        success: false,
        jobId: null,
        message: `Error: ${error.message}`,
      };
    }
  }

  /**
   * Generate and email to custom recipient
   */
  @ApiExcludeEndpoint()
  @Post('token-reconciliation/:email')
  async generateTokenReconciliationReportCustom(
    email: string,
  ): Promise<{
    success: boolean;
    jobId: string;
    message: string;
  }> {
    try {
      const result =
        await this.tokenReconciliationService.initiateTokenReconciliationExport(
          email,
        );

      return {
        success: true,
        jobId: result.jobId,
        message: result.message,
      };
    } catch (error) {
      this.logger.error(
        'Error initiating token reconciliation export',
        error,
      );
      return {
        success: false,
        jobId: null,
        message: `Error: ${error.message}`,
      };
    }
  }
}