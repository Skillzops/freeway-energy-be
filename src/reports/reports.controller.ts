import { Controller, Get, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import * as fs from 'fs';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('customer-payment-report')
  @ApiOperation({
    summary: 'Download detailed customer payment report as CSV',
    description:
      'Generates and downloads a comprehensive CSV report of all customers with their payment records, sales info, and payment status.',
  })
  async downloadCustomerPaymentReport(@Res() res: Response) {
    try {
      const filePath =
        await this.reportsService.generateCustomerPaymentReport();
      const fileName =
        filePath.split('/').pop() || 'customer_payment_report.csv';

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`,
      );

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      // Clean up file after sending (optional)
      fileStream.on('end', () => {
        fs.unlinkSync(filePath);
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to generate report',
        error: error.message,
      });
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @Get('customer-payment-report/generate')
  @ApiOperation({
    summary: 'Generate customer payment report and return file path',
    description:
      'Generates the CSV report and returns the file path for internal use.',
  })
  async generateCustomerPaymentReport() {
    const filePath =
      await this.reportsService.generateCustomerPaymentReport();
    return {
      message: 'Report generated successfully',
      filePath,
      downloadUrl: `/reports/download/${filePath.split('/').pop()}`,
    };
  }
}
