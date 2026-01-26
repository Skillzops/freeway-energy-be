import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditActions } from '@prisma/client';
import {
  AuditChangeTrackingService,
  DetailedChanges,
} from './audit-change-tracking.service';

export interface CreateAuditLogDto {
  action: AuditActions;
  entity: string;
  entityId?: string;
  userId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  statusCode?: number;
  requestUrl?: string;
  errorMessage?: string;
  detailedChanges?: DetailedChanges;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly changeTrackingService: AuditChangeTrackingService,
  ) {}

  async createLog(data: CreateAuditLogDto) {
    try {
      // Calculate detailed changes with excluded fields filtering
      const detailedChanges =
        data.detailedChanges ||
        (data.oldValues && data.newValues
          ? this.changeTrackingService.calculateDeepChanges(
              data.entity,
              data.oldValues,
              data.newValues,
            )
          : undefined);

      // Generate a simple "changes" object for backward compatibility
      let changes: Record<string, any> | undefined;
      if (detailedChanges) {
        changes = {};
        for (const [key, change] of Object.entries(detailedChanges)) {
          // Only include fields that were actually changed
          if (change.changed) {
            changes[key] = {
              old: change.old,
              new: change.new,
            };
          }
        }
      }

      // Generate summary of changes
      const changeSummary =
        detailedChanges &&
        this.changeTrackingService.generateChangeSummary(
          data.entity,
          detailedChanges,
        );

      // Count only the fields that actually changed (not excluded fields)
      const changedFieldCount = changes
        ? Object.keys(changes).length
        : undefined;

      const auditLog = await this.prisma.auditLog.create({
        data: {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          userId: data.userId,
          oldValues: data.oldValues,
          newValues: data.newValues,
          // Store detailed changes in metadata
          metadata: {
            ...data.metadata,
            detailedChanges: detailedChanges
              ? JSON.parse(JSON.stringify(detailedChanges))
              : undefined,
            changeSummary: changeSummary || [],
            changedFieldCount,
          },
          // Keep simple changes for backward compatibility
          changes: changes || undefined,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          statusCode: data.statusCode,
          requestUrl: data.requestUrl,
          errorMessage: data.errorMessage,
        },
      });

      this.logger.debug(
        `Audit log created for ${data.entity} (${data.entityId || 'no-id'})`,
      );

      return auditLog;
    } catch (error) {
      this.logger.error('Failed to create audit log:', error);
    }
  }

  async getLogs(filters: AuditQueryDto) {
    const {
      action,
      userId,
      startDate,
      endDate,
      limit = 100,
      page = 1,
    } = filters;

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const where: any = {};

    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Enhance logs with readable change summaries
    const enhancedLogs = logs.map((log) => ({
      ...log,
      // Extract summary from metadata for easy display
      changeSummary: (log.metadata as any)?.changeSummary || [],
      changedFieldCount: (log.metadata as any)?.changedFieldCount,
    }));

    return {
      logs: enhancedLogs,
      total,
      limit: limitNumber,
      page: pageNumber,
      totalPages: Math.ceil(total / limitNumber),
      skip,
    };
  }

  /**
   * Get user activity timeline with enhanced details
   */
  async getUserActivity(userId: string, limit: number = 100) {
    const logs = await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map((log) => ({
      ...log,
      changeSummary: (log.metadata as any)?.changeSummary || [],
      changedFieldCount: (log.metadata as any)?.changedFieldCount,
    }));
  }

  /**
   * Get detailed audit trail for a specific entity
   */
  async getEntityAuditTrail(entityId: string) {
    return await this.prisma.auditLog.findMany({
      where: { entityId },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get sensitive field changes for an entity
   */
  async getSensitiveFieldChanges(entityId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
      },
    });

    return logs
      .filter((log) => {
        const detailedChanges = (log.metadata as any)?.detailedChanges;
        if (!detailedChanges) return false;

        // Filter logs that have sensitive field changes
        return Object.values(detailedChanges).some(
          (change: any) => change.sensitive && change.changed,
        );
      })
      .map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        userId: log.userId,
        createdAt: log.createdAt,
        sensitiveChanges: (log.metadata as any)?.detailedChanges,
        user: log.user,
      }));
  }
}