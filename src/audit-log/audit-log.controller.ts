import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
@ApiBearerAuth('access_token')
@ApiHeader({
  name: 'Authorization',
  description: 'JWT token used for authentication',
  required: true,
  schema: {
    type: 'string',
    example: 'Bearer <token>',
  },
})
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.read}:${SubjectEnum.AuditLog}`,
      `${ActionEnum.manage}:${SubjectEnum.AuditLog}`,
    ],
  })
  @ApiOperation({ summary: 'Get all audit logs with optional filters' })
  @ApiExtraModels(AuditQueryDto)
  @HttpCode(HttpStatus.OK)
  @Get()
  async getLogs(@Query() filters: AuditQueryDto) {
    return await this.auditLogService.getLogs(filters);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.read}:${SubjectEnum.AuditLog}`,
      `${ActionEnum.manage}:${SubjectEnum.AuditLog}`,
    ],
  })
  @ApiOperation({ summary: 'Get user activity timeline' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'limit', required: false, description: 'Result limit' })
  @HttpCode(HttpStatus.OK)
  @Get('user/:userId')
  async getUserActivity(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
  ) {
    return await this.auditLogService.getUserActivity(userId, limit);
  }
}
