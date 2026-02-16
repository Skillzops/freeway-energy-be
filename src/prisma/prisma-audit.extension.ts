import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';

/**
 * Audit Extension for Prisma
 *
 * Automatically captures all database changes (CREATE, UPDATE, DELETE)
 * across all models without manual logging in controllers.
 *
 * Features:
 * - Captures old and new values automatically
 * - Prevents infinite loops by excluding audit tables
 * - Integrates with AuditChangeTrackingService for redaction
 * - Stores detailed change metadata
 * - Works for all entity types
 * - Non-blocking async logging
 */

export interface AuditContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestUrl?: string;
  metadata?: Record<string, any>;
}

// Models that should NOT be audited
// This prevents infinite loops when audit logs create audit logs
const EXCLUDED_MODELS = [
  'AuditLog', // Most important! Prevent audit log creation from triggering audits
  'ApplicationLog', // Also exclude application logs
];

@Injectable()
export class PrismaAuditExtension {
  /**
   * Define the audit extension that hooks into all Prisma operations
   */
  static getExtension(
    auditLogService: any,
    clsService: any,
    prismaClient: any, // Add prismaClient parameter
  ): ReturnType<typeof Prisma.defineExtension> {
    return Prisma.defineExtension({
      name: 'audit-extension',

      query: {
        $allModels: {
          /**
           * Intercept create operations
           */
          async create({ model, args, query }) {
            // CRITICAL: Skip auditing excluded models to prevent infinite loops
            if (EXCLUDED_MODELS.includes(model)) {
              return query(args);
            }

            // Execute the create query
            const result = await query(args);

            // Log the creation in background (non-blocking)
            setImmediate(async () => {
              try {
                const context = clsService.get('auditContext') as AuditContext;
                const userId = context?.userId || clsService.get('userId');

                await auditLogService.createLog({
                  action: 'POST',
                  entity: model,
                  entityId: result.id,
                  userId,
                  newValues: result,
                  metadata: {
                    source: 'database-event',
                    operation: 'create',
                    ...context?.metadata,
                  },
                  ipAddress: context?.ipAddress,
                  userAgent: context?.userAgent,
                  requestUrl: context?.requestUrl,
                });
              } catch (error) {
                console.error(`Failed to audit ${model} create:`, error);
              }
            });

            return result;
          },

          /**
           * Intercept update operations
           */
          async update({ model, args, query }) {
            // CRITICAL: Skip auditing excluded models to prevent infinite loops
            if (EXCLUDED_MODELS.includes(model)) {
              return query(args);
            }

            // Get the old values before update using the prismaClient directly
            let oldValues: any = null;
            try {
              // Use prismaClient[model].findUnique() to get old values
              if (prismaClient && prismaClient[model]) {
                oldValues = await prismaClient[model].findUnique({
                  where: args.where,
                });
              }
            } catch (error) {
              console.error(`Failed to get old values for ${model}:`, error);
            }

            // Execute the update query
            const result = await query(args);

            // Log the update in background (non-blocking)
            setImmediate(async () => {
              try {
                const context = clsService.get('auditContext') as AuditContext;
                const userId = context?.userId || clsService.get('userId');

                await auditLogService.createLog({
                  action: 'PUT',
                  entity: model,
                  entityId: args.where.id || result.id,
                  userId,
                  oldValues,
                  newValues: result,
                  metadata: {
                    source: 'database-event',
                    operation: 'update',
                    ...context?.metadata,
                  },
                  ipAddress: context?.ipAddress,
                  userAgent: context?.userAgent,
                  requestUrl: context?.requestUrl,
                });
              } catch (error) {
                console.error(`Failed to audit ${model} update:`, error);
              }
            });

            return result;
          },

          /**
           * Intercept updateMany operations
           */
          async updateMany({ model, args, query }) {
            // CRITICAL: Skip auditing excluded models to prevent infinite loops
            if (EXCLUDED_MODELS.includes(model)) {
              return query(args);
            }

            // Get old values before update using the prismaClient directly
            let oldRecords: any[] = [];
            try {
              if (prismaClient && prismaClient[model]) {
                oldRecords = await prismaClient[model].findMany({
                  where: args.where,
                });
              }
            } catch (error) {
              console.error(`Failed to get old values for ${model}:`, error);
            }

            // Execute the updateMany query
            const result = await query(args);

            // Log each update in background (non-blocking)
            setImmediate(async () => {
              try {
                const context = clsService.get('auditContext') as AuditContext;
                const userId = context?.userId || clsService.get('userId');

                // Log each record that was updated
                for (const oldRecord of oldRecords) {
                  await auditLogService.createLog({
                    action: 'PUT',
                    entity: model,
                    entityId: oldRecord.id,
                    userId,
                    oldValues: oldRecord,
                    newValues: oldRecord,
                    metadata: {
                      source: 'database-event',
                      operation: 'updateMany',
                      batchOperation: true,
                      ...context?.metadata,
                    },
                    ipAddress: context?.ipAddress,
                    userAgent: context?.userAgent,
                    requestUrl: context?.requestUrl,
                  });
                }
              } catch (error) {
                console.error(`Failed to audit ${model} updateMany:`, error);
              }
            });

            return result;
          },

          /**
           * Intercept delete operations
           */
          async delete({ model, args, query }) {
            // CRITICAL: Skip auditing excluded models to prevent infinite loops
            if (EXCLUDED_MODELS.includes(model)) {
              return query(args);
            }

            // Get the old values before deletion using the prismaClient directly
            let oldValues: any = null;
            try {
              if (prismaClient && prismaClient[model]) {
                oldValues = await prismaClient[model].findUnique({
                  where: args.where,
                });
              }
            } catch (error) {
              console.error(`Failed to get old values for ${model}:`, error);
            }

            // Execute the delete query
            const result = await query(args);

            // Log the deletion in background (non-blocking)
            setImmediate(async () => {
              try {
                const context = clsService.get('auditContext') as AuditContext;
                const userId = context?.userId || clsService.get('userId');

                await auditLogService.createLog({
                  action: 'DELETE',
                  entity: model,
                  entityId: args.where.id || result.id,
                  userId,
                  oldValues,
                  metadata: {
                    source: 'database-event',
                    operation: 'delete',
                    ...context?.metadata,
                  },
                  ipAddress: context?.ipAddress,
                  userAgent: context?.userAgent,
                  requestUrl: context?.requestUrl,
                });
              } catch (error) {
                console.error(`Failed to audit ${model} delete:`, error);
              }
            });

            return result;
          },

          /**
           * Intercept deleteMany operations
           */
          async deleteMany({ model, args, query }) {
            // CRITICAL: Skip auditing excluded models to prevent infinite loops
            if (EXCLUDED_MODELS.includes(model)) {
              return query(args);
            }

            // Get old values before delete using the prismaClient directly
            let oldRecords: any[] = [];
            try {
              if (prismaClient && prismaClient[model]) {
                oldRecords = await prismaClient[model].findMany({
                  where: args.where,
                });
              }
            } catch (error) {
              console.error(`Failed to get old values for ${model}:`, error);
            }

            // Execute the deleteMany query
            const result = await query(args);

            // Log each deletion in background (non-blocking)
            setImmediate(async () => {
              try {
                const context = clsService.get('auditContext') as AuditContext;
                const userId = context?.userId || clsService.get('userId');

                // Log each record that was deleted
                for (const oldRecord of oldRecords) {
                  await auditLogService.createLog({
                    action: 'DELETE',
                    entity: model,
                    entityId: oldRecord.id,
                    userId,
                    oldValues: oldRecord,
                    metadata: {
                      source: 'database-event',
                      operation: 'deleteMany',
                      batchOperation: true,
                      ...context?.metadata,
                    },
                    ipAddress: context?.ipAddress,
                    userAgent: context?.userAgent,
                    requestUrl: context?.requestUrl,
                  });
                }
              } catch (error) {
                console.error(`Failed to audit ${model} deleteMany:`, error);
              }
            });

            return result;
          },
        },
      },
    });
  }
}
