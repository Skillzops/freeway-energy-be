import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { AuditContext } from 'src/prisma/prisma-audit.extension';

/**
 * Audit Context Middleware
 *
 * Captures request information and stores in CLS (Continuation Local Storage)
 * This makes it available to the Prisma audit extension automatically
 *
 * Sets:
 * - userId: From request.user
 * - ipAddress: From request headers/socket
 * - userAgent: From request headers
 * - requestUrl: From request
 * - metadata: Any custom metadata
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditContextMiddleware.name);

  constructor(private readonly clsService: ClsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Extract user info
    const userId = (req as any).user?.id;

    // Extract IP address
    const ipAddress = this.getClientIp(req);

    // Extract user agent
    const userAgent = req.get('user-agent');

    // Extract request URL
    const requestUrl = req.originalUrl || req.url;

    // Create audit context
    const auditContext: AuditContext = {
      userId,
      ipAddress,
      userAgent,
      requestUrl,
      metadata: {
        httpMethod: req.method,
        endpoint: requestUrl,
      },
    };

    // Store in CLS so it's available to all async operations
    this.clsService.set('auditContext', auditContext);
    this.clsService.set('userId', userId);

    // Log for debugging
    this.logger.debug(`[${req.method}] ${requestUrl} from ${ipAddress}`);

    next();
  }

  /**
   * Extract client IP address from request
   * Handles proxies and various header formats
   */
  private getClientIp(req: Request): string {
    // Try x-forwarded-for header (used by proxies)
    const forwardedFor = req.get('x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    // Try other common headers
    const clientIp =
      req.get('x-client-ip') ||
      req.get('cf-connecting-ip') || // Cloudflare
      req.get('x-real-ip'); // Nginx

    if (clientIp) {
      return clientIp;
    }

    // Fall back to socket info
    return (
      (req.ip ||
        (req.connection as any)?.remoteAddress ||
        (req.socket as any)?.remoteAddress ||
        (req.connection as any)?.socket?.remoteAddress) ??
      'unknown'
    );
  }
}
