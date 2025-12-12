import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly logsDir = path.join(process.cwd(), 'logs');
  private readonly maxLogFileSize = 10 * 1024 * 1024; // 10MB

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {
    this.initializeLogDirectory();
  }

  private initializeLogDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to initialize log directory:', error);
    }
  }

  private writeErrorToFile(errorData: any) {
    try {
      const errorFile = path.join(this.logsDir, 'error.log');

      // Check file size and rotate if needed
      if (fs.existsSync(errorFile)) {
        const stats = fs.statSync(errorFile);
        if (stats.size > this.maxLogFileSize) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedFile = path.join(this.logsDir, `error.${timestamp}.log`);
          fs.renameSync(errorFile, rotatedFile);
        }
      }

      const errorMessage = `
================================================================================
${errorData.timestamp} [${errorData.statusCode}] ${errorData.method} ${errorData.path}
================================================================================
Message: ${errorData.message}
Exception: ${errorData.exception}
Stack Trace:
${errorData.stack || 'No stack trace available'}
================================================================================
        `;

      // Use async write (non-blocking)
      fs.appendFile(errorFile, errorMessage, (err) => {
        if (err) {
          console.error('Failed to write error to file:', err);
        }
      });
    } catch (error) {
      console.error('Failed to write error to file:', error);
    }
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An error occurred';
    let details: any = null;
    let exceptionMessage = '';
    let stack = '';

    // Determine status and message
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const httpResponse = exception.getResponse();
      message = (httpResponse as any).message || exception.message;
      details = (httpResponse as any).error || null;
      exceptionMessage = exception.message;
      stack = exception.stack || '';
    } else if (exception instanceof Error) {
      message = exception.message;
      exceptionMessage = exception.message;
      stack = exception.stack || '';
    } else {
      exceptionMessage = String(exception);
    }

    // ONLY write to file and log for 500 errors (unhandled exceptions)
    if (status === HttpStatus.INTERNAL_SERVER_ERROR || status >= 500) {
      const errorData = {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        statusCode: status,
        message,
        exception: exceptionMessage,
        stack,
      };

      this.writeErrorToFile(errorData);
    }

    // For 500 errors, return a friendly message to the user
    let userMessage = message;
    let userDetails = details;

    if (status === HttpStatus.INTERNAL_SERVER_ERROR || status >= 500) {
      userMessage =
        'An internal server error occurred. Please try again later.';
      userDetails = null; // Don't expose internal details to users
    }

    const responseBody = {
      statusCode: status,
      message: userMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(userDetails && { details: userDetails }),
    };

    httpAdapter.reply(response, responseBody, status);
  }
}
