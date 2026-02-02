import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FailedJobsService } from './failed-jobs.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';

@ApiTags('Failed Jobs Management')
@Controller('failed-jobs')
export class FailedJobsController {
  constructor(private readonly failedJobsService: FailedJobsService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  })
  @Get('stats/all')
  @ApiOperation({ summary: 'Get stats for all queues' })
  async getAllQueuesStats() {
    return this.failedJobsService.getAllQueuesStats();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  })
  @Get('count')
  @ApiOperation({ summary: 'Get failed jobs count' })
  @ApiQuery({ name: 'queue', required: false })
  async getCount(@Query('queue') queueName?: string) {
    return this.failedJobsService.getFailedJobsCount(queueName);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  })
  @Get('stats/:queue')
  @ApiOperation({ summary: 'Get queue statistics' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  async getQueueStats(@Param('queue') queueName: string) {
    return this.failedJobsService.getQueueStats(queueName);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  }) 
  @Get(':queue')
  @ApiOperation({ summary: 'Get all failed jobs for a queue' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiQuery({ name: 'limit', required: false })
  async getFailedJobs(
    @Param('queue') queueName: string,
    @Query('limit') limit: string = '100',
  ) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1) {
      throw new BadRequestException('Invalid limit parameter');
    }
    return this.failedJobsService.getFailedJobs(queueName, limitNum);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  })
  @Get(':queue/grouped-by-reason')
  @ApiOperation({ summary: 'Get failed jobs grouped by failure reason' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  async getGroupedByReason(@Param('queue') queueName: string) {
    return this.failedJobsService.getFailedJobsGroupedByReason(queueName);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.AuditLog}`],
  })
  @Get(':queue/:jobId')
  @ApiOperation({ summary: 'Get failed job details' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  async getJobDetail(
    @Param('queue') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    return this.failedJobsService.getFailedJobDetail(queueName, jobId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.AuditLog}`],
  })
  @Post(':queue/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  async retryJob(
    @Param('queue') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    return this.failedJobsService.retryFailedJob(queueName, jobId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.AuditLog}`],
  })
  @Post(':queue/retry-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry all failed jobs in a queue' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  async retryAllJobs(@Param('queue') queueName: string) {
    return this.failedJobsService.retryAllFailedJobs(queueName);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.AuditLog}`],
  })
  @Delete(':queue/:jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a failed job' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  async removeJob(
    @Param('queue') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    return this.failedJobsService.removeFailedJob(queueName, jobId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.AuditLog}`],
  })
  @Delete(':queue/remove-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove all failed jobs from a queue' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  async removeAllJobs(@Param('queue') queueName: string) {
    return this.failedJobsService.removeAllFailedJobs(queueName);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.AuditLog}`],
  })
  @Post(':queue/cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cleanup old failed jobs' })
  @ApiParam({ name: 'queue', description: 'Queue name' })
  @ApiQuery({ name: 'daysOld', required: false, description: 'Days old' })
  async cleanup(
    @Param('queue') queueName: string,
    @Query('daysOld') daysOld: string = '7',
  ) {
    const days = parseInt(daysOld, 10);
    if (isNaN(days) || days < 1) {
      throw new BadRequestException('Invalid daysOld parameter');
    }
    return this.failedJobsService.cleanupOldFailedJobs(queueName, days);
  }
}
