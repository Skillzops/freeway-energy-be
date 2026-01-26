import { Injectable } from '@nestjs/common';

export interface DetailedChange {
  old?: any;
  new?: any;
  changed: boolean;
  sensitive: boolean;
}

export interface DetailedChanges {
  [key: string]: DetailedChange;
}

@Injectable()
export class AuditChangeTrackingService {
  /**
   * Fields that should be excluded from audit tracking
   * These are system-managed fields that change automatically
   */
  private static readonly EXCLUDED_FIELDS = [
    'updatedAt', // ← Auto-updated by Prisma
    'createdAt', // ← Never changes
    'deletedAt', // ← Soft delete timestamp
    '__v', // ← Version field (MongoDB)
    'creatorDetails', // ← Relation, not a field change
    'user', // ← Relation, not a field change
  ];

  /**
   * Fields that contain sensitive information and should be redacted in logs
   */
  private static readonly SENSITIVE_FIELDS = [
    'password',
    'passwordHash',
    'secret',
    'token',
    'apiKey',
    'refreshToken',
    'ssn',
    'socialSecurityNumber',
    'creditCardNumber',
    'cardNumber',
    'cvv',
    'pin',
  ];

  /**
   * Calculate deep changes between old and new values
   * Excludes system fields and relations
   */
  calculateDeepChanges(
    entity: string,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
  ): DetailedChanges {
    const changes: DetailedChanges = {};

    // Get all keys from both old and new values
    const allKeys = new Set([
      ...Object.keys(oldValues || {}),
      ...Object.keys(newValues || {}),
    ]);

    for (const key of allKeys) {
      // Skip excluded fields (system fields and relations)
      if (AuditChangeTrackingService.EXCLUDED_FIELDS.includes(key)) {
        continue;
      }

      const oldValue = oldValues?.[key];
      const newValue = newValues?.[key];

      // Skip if values are the same
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        continue;
      }

      // Check if field is sensitive
      const isSensitive =
        AuditChangeTrackingService.SENSITIVE_FIELDS.includes(key);

      changes[key] = {
        old: isSensitive ? '[REDACTED]' : oldValue,
        new: isSensitive ? '[REDACTED]' : newValue,
        changed: true,
        sensitive: isSensitive,
      };
    }

    return changes;
  }

  /**
   * Generate a human-readable summary of changes
   */
  generateChangeSummary(
    entity: string,
    detailedChanges: DetailedChanges,
  ): string[] {
    const summary: string[] = [];

    for (const [key, change] of Object.entries(detailedChanges)) {
      if (!change.changed) continue;

      // Format the summary based on value types
      const oldVal = this.formatValue(change.old);
      const newVal = this.formatValue(change.new);

      summary.push(`${key}: ${oldVal} → ${newVal}`);
    }

    return summary;
  }

  /**
   * Format a value for display in summary
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'string') {
      return `"${value}"`;
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
      return '[object]';
    }

    return String(value);
  }

  /**
   * Redact sensitive fields in audit data
   */
  redactSensitiveData(data: Record<string, any>): Record<string, any> {
    const redacted = { ...data };

    for (const field of AuditChangeTrackingService.SENSITIVE_FIELDS) {
      if (field in redacted) {
        redacted[field] = '[REDACTED]';
      }
    }

    return redacted;
  }

  /**
   * Check if a field should be audited
   */
  shouldAuditField(fieldName: string): boolean {
    return !AuditChangeTrackingService.EXCLUDED_FIELDS.includes(fieldName);
  }

  /**
   * Get list of excluded fields
   */
  getExcludedFields(): string[] {
    return AuditChangeTrackingService.EXCLUDED_FIELDS;
  }

  /**
   * Get list of sensitive fields
   */
  getSensitiveFields(): string[] {
    return AuditChangeTrackingService.SENSITIVE_FIELDS;
  }
}
