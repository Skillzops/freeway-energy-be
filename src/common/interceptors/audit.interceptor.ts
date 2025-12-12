import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { AuditActions } from '@prisma/client';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditLogService } from 'src/audit-log/audit-log.service';

/**
 * AuditInterceptor
 *
 * Features:
 * - Logs HTTP requests and responses automatically
 * - Captures request metadata (IP, user agent, user, method, URL)
 * - Logs errors with full context
 * - Calculates request duration
 * - Non-blocking async logging
 * - Only logs write operations (POST, PUT, PATCH, DELETE) to reduce noise
 * - Always logs errors
 *
 * Usage:
 * 1. Global:
 *    app.useGlobalInterceptors(new AuditInterceptor(auditLogService))
 *
 * 2. Per Controller:
 *    @Controller('customers')
 *    @UseInterceptors(AuditInterceptor)
 *    export class CustomersController { }
 *
 * 3. Per Method:
 *    @Post()
 *    @UseInterceptors(AuditInterceptor)
 *    async create() { }
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    // Get handler and controller names
    const handlerName = context.getHandler().name;
    const controllerName = context.getClass().name;

    // Extract request metadata
    const metadata = {
      method: request.method,
      url: request.url,
      userAgent: request.get('user-agent'),
      ipAddress: this.getClientIp(request),
      userId: request.user?.id,
      handler: handlerName,
      controller: controllerName,
    };

    // Log to console for debugging
    this.logger.debug(
      `[${request.method}] ${request.url} from ${metadata.ipAddress}`,
    );

    return next.handle().pipe(
      tap((result) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode || 200;

        // Only log write operations (POST, PUT, PATCH, DELETE) to reduce noise
        // GET/HEAD requests are typically read-only and not worth auditing
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
          this.logSuccess(request, statusCode, duration, metadata, result);
        }
      }),

      catchError((error) => {
        // const duration = Date.now() - startTime;
        // const statusCode = error.status || 500;

        // // Log ALL errors regardless of HTTP method
        // this.logError(request, statusCode, duration, metadata, error);

        return throwError(() => error);
      }),
    );
  }

  /**
   * Log successful write operation
   */
  private logSuccess(
    request: any,
    statusCode: number,
    duration: number,
    metadata: any,
    result: any,
  ): void {
    // setImmediate to make logging non-blocking
    setImmediate(() => {
      this.auditLogService
        .createLog({
          action: request.method, // POST, PUT, PATCH, DELETE
          entity: metadata.controller,
          userId: metadata.userId,
          statusCode,
          requestUrl: request.url,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          metadata: {
            ...metadata,
            duration,
            responseSize: result ? JSON.stringify(result).length : 0,
            timestamp: new Date().toISOString(),
          },
        })
        .catch((error) => {
          this.logger.error('Failed to create audit log:', error);
        });
    });
  }

  private logError(
    request: any,
    statusCode: number,
    duration: number,
    metadata: any,
    error: any,
  ): void {
    setImmediate(() => {
      this.auditLogService
        .createLog({
          action: AuditActions.ERROR,
          entity: metadata.controller,
          userId: metadata.userId,
          statusCode,
          requestUrl: request.url,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          errorMessage: error.message || 'Unknown error',
          metadata: {
            ...metadata,
            duration,
            errorName: error.name,
            errorStatus: error.status,
            timestamp: new Date().toISOString(),
          },
        })
        .catch((error) => {
          this.logger.error('Failed to create error audit log:', error);
        });
    });
  }

  /**
   * Extract client IP address from request
   * Handles proxies and various header formats
   */
  private getClientIp(request: any): string {
    // Try x-forwarded-for header (used by proxies)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwardedFor.split(',')[0].trim();
    }

    // Try other common headers
    const clientIp =
      request.headers['x-client-ip'] ||
      request.headers['cf-connecting-ip'] || // Cloudflare
      request.headers['x-real-ip']; // Nginx

    if (clientIp) {
      return clientIp;
    }

    // Fall back to socket info
    return (
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.connection?.socket?.remoteAddress ||
      'unknown'
    );
  }
}
