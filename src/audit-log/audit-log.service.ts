import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditActions } from '@prisma/client';

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
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(data: CreateAuditLogDto) {
    try {
      let changes: Record<string, any> | undefined;
      if (data.oldValues && data.newValues) {
        changes = this.calculateChanges(data.oldValues, data.newValues);
      }

      return await this.prisma.auditLog.create({
        data: {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          userId: data.userId,
          oldValues: data.oldValues,
          newValues: data.newValues,
          changes,
          metadata: data.metadata,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          statusCode: data.statusCode,
          requestUrl: data.requestUrl,
          errorMessage: data.errorMessage,
        },
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }
  }

  async getLogs(filters: AuditQueryDto) {
    const {
      action,
      userId,
      startDate,
      endDate,
      limit = 100,
      page = 0,
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
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
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

    return {
      logs,
      total,
      limit,
      skip,
    };
  }

  /**
   * Get user activity timeline
   */
  async getUserActivity(userId: string, limit: number = 100) {
    return await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Calculate what changed between old and new values
   */
  private calculateChanges(
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
  ): Record<string, any> {
    const changes: Record<string, any> = {};

    // Check for updated and new fields
    Object.keys(newValues).forEach((key) => {
      if (oldValues[key] !== newValues[key]) {
        changes[key] = {
          old: oldValues[key],
          new: newValues[key],
        };
      }
    });

    // Check for deleted fields
    Object.keys(oldValues).forEach((key) => {
      if (!(key in newValues)) {
        changes[key] = {
          old: oldValues[key],
          new: null,
        };
      }
    });

    return Object.keys(changes).length > 0 ? changes : undefined;
  }
}
