import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { IMail } from './interfaces/mail.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  constructor(
    readonly mailService: MailerService,
    readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendMail(value: IMail) {
    try {
      console.log('hellyo from email service');
      await this.mailService.sendMail({
        ...value,
      });
      console.log('hellyo from email233 service');

      return 'Email Sent Successfully';
    } catch (error) {
      console.log(error);

      // to remove the user being created when the mailing fails
      if (value.userId) {
        await this.prisma.user.delete({
          where: {
            id: value.userId,
          },
        });
      }

      throw error;
    }
  }

  async sendBatchProgressEmail(
    batchNumber: number,
    results: any[],
    processed: number,
    skipped: number,
    errors: number,
  ) {
    const fileName = `payment-correction-batch-${batchNumber}-${Date.now()}.json`;
    const fileContent = JSON.stringify(
      {
        batchNumber,
        timestamp: new Date().toISOString(),
        summary: { processed, skipped, errors },
        corrections: results,
      },
      null,
      2,
    );

    await this.sendMail({
      from: this.config.get<string>('EMAIL_USER'),
      to: 'francisalexander000@gmail.com',
      subject: `Payment Correction Progress - Batch ${batchNumber} Completed`,
      html: `
        <h2>Payment Correction Progress Update</h2>
        <p><strong>Batch ${batchNumber} completed at:</strong> ${new Date().toLocaleString()}</p>
        <h3>Current Statistics:</h3>
        <ul>
          <li><strong>Processed:</strong> ${processed}</li>
          <li><strong>Skipped:</strong> ${skipped}</li>
          <li><strong>Errors:</strong> ${errors}</li>
          <li><strong>Corrections in this batch:</strong> ${results.length}</li>
        </ul>
        <p>Detailed results are attached as JSON file.</p>
      `,
      attachments: [
        {
          filename: fileName,
          content: fileContent,
          contentType: 'application/json',
        },
      ],
    });
  }

  async sendErrorEmail(
    error: any,
    deviceSerialNumber: string,
    iteration: number,
  ) {
    await this.sendMail({
      from: this.config.get<string>('EMAIL_USER'),
      to: 'francisalexander000@gmail.com',
      subject: `Payment Correction Error - Device ${deviceSerialNumber}`,
      html: `
        <h2>Payment Correction Error</h2>
        <p><strong>Error occurred at:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Iteration:</strong> ${iteration}</p>
        <p><strong>Device Serial Number:</strong> ${deviceSerialNumber}</p>
        <h3>Error Details:</h3>
        <pre>${error.message || error}</pre>
        <h3>Stack Trace:</h3>
        <pre>${error.stack || 'No stack trace available'}</pre>
      `,
    });
  }

  async sendCompletionEmail(
    processed: number,
    skipped: number,
    errors: number,
    startTime: Date,
    allResults: any[],
  ) {
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000; // seconds

    const fileName = `payment-correction-final-report-${Date.now()}.json`;
    const fileContent = JSON.stringify(
      {
        summary: {
          totalProcessed: processed,
          totalSkipped: skipped,
          totalErrors: errors,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationSeconds: duration,
        },
        allCorrections: allResults,
      },
      null,
      2,
    );

    await this.sendMail({
      from: this.config.get<string>('EMAIL_USER'),
      to: 'francisalexander000@gmail.com',
      subject: `Payment Correction Process Completed - Final Report`,
      html: `
          <h1>Payment Correction Process Completed</h1>
          <p><strong>Completion Time:</strong> ${endTime.toLocaleString()}</p>
          <p><strong>Total Duration:</strong> ${Math.round(duration)} seconds</p>
          
          <h2>Final Summary:</h2>
          <ul>
            <li><strong>Total Processed:</strong> ${processed}</li>
            <li><strong>Total Skipped:</strong> ${skipped}</li>
            <li><strong>Total Errors:</strong> ${errors}</li>
            <li><strong>Success Rate:</strong> ${((processed / (processed + skipped + errors)) * 100).toFixed(2)}%</li>
          </ul>
          
          <p>Complete detailed report is attached.</p>
        `,
      attachments: [
        {
          filename: fileName,
          content: fileContent,
          contentType: 'application/json',
        },
      ],
    });
  }

  async sendCriticalErrorEmail(
    error: any,
    processed: number,
    skipped: number,
    errors: number,
  ) {
      await this.sendMail({
        from: this.config.get<string>('EMAIL_USER'),
        to: 'francisalexander000@gmail.com',
        subject: `CRITICAL ERROR - Payment Correction Process Failed`,
        html: `
          <h1 style="color: red;">CRITICAL ERROR</h1>
          <p><strong>Error Time:</strong> ${new Date().toLocaleString()}</p>
          <p>The payment correction process has encountered a critical error and has been terminated.</p>
          
          <h2>Progress Before Failure:</h2>
          <ul>
            <li><strong>Processed:</strong> ${processed}</li>
            <li><strong>Skipped:</strong> ${skipped}</li>
            <li><strong>Errors:</strong> ${errors}</li>
          </ul>
          
          <h2>Error Details:</h2>
          <pre style="background-color:rgb(155, 81, 81); padding: 10px;">${error.message || error}</pre>
          
          <h2>Stack Trace:</h2>
          <pre style="background-color: #f5f5f5; padding: 10px;">${error.stack || 'No stack trace available'}</pre>
          
          <p><strong>Action Required:</strong> Please investigate and restart the process if necessary.</p>
        `,
      });
  }
}
