import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Response,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { ExportService } from './export.service';
import {
  ExportDataQueryDto,
  ExportType,
  OutstandingPaymentsQueryDto,
} from './dto/export-query.dto';

@ApiTags('Data Export & Reports')
@Controller('export')
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
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  // @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  // @RolesAndPermissions({
  //   permissions: [
  //     `${ActionEnum.read}:${SubjectEnum.Sales}`,
  //     `${ActionEnum.manage}:${SubjectEnum.Sales}`,
  //   ],
  // })
  @Get('data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export business data and generate reports',
    description: `
      **Comprehensive data export and reporting system with focus on key business metrics.**
      
      ## 🎯 KEY BUSINESS REPORTS
      
      ### 1. DEBT REPORT (\`exportType=debt_report\`)
      **Purpose:** View individual customer debts remaining and number of months
      
      **Shows:**
      - Outstanding balance per customer
      - Remaining months to complete payment
      - Days/months since last payment
      - Overdue status and defaulted months
      - **Total debt remaining from ALL customers**
      
      **Example Usage:**
      \`\`\`
      GET /export/data?exportType=debt_report
      GET /export/data?exportType=debt_report&customerId=xxx
      GET /export/data?exportType=debt_report&overdueDays=35
      GET /export/data?exportType=debt_report&state=Lagos
      \`\`\`
      
      **Summary Includes:**
      - Total Outstanding Debt (₦)
      - Total Customers in Debt
      - Overdue Payments Count
      
      ---
      
      ### 2. RENEWAL/REACTIVATION REPORT (\`exportType=renewal_report\`)
      **Purpose:** See customers who have NOT paid monthly reactivation payments
      
      **Shows:**
      - Customers with overdue installment payments
      - How many days/months they have defaulted
      - Number of missed payments
      - Expected payment amount due
      
      **Example Usage:**
      \`\`\`
      GET /export/data?exportType=renewal_report
      GET /export/data?exportType=renewal_report&overdueDays=35
      GET /export/data?exportType=renewal_report&agentId=xxx
      \`\`\`
      
      **Summary Includes:**
      - Total Defaulters
      - Total Missed Payments
      
      ---
      
      ### 3. WEEKLY SUMMARY (\`exportType=weekly_summary\`)
      **Purpose:** Generate weekly reports for new sales and renewals
      
      **Shows:**
      - **New Sales:** Total count, cash vs installment quantities, revenue breakdown
      - **Renewals:** Total count and amounts paid (subsequent installment payments)
      - Grand total combined revenue
      
      **Example Usage:**
      \`\`\`
      GET /export/data?exportType=weekly_summary
      GET /export/data?exportType=weekly_summary&startDate=2025-01-01&endDate=2025-01-07
      GET /export/data?exportType=weekly_summary&agentId=xxx
      \`\`\`
      
      **Summary Includes:**
      - Total new sales (stock quantities and cash amounts)
      - Total renewals (quantities and amounts paid)
      - Revenue breakdown by payment mode
      
      ---
      
      ### 4. MONTHLY SUMMARY (\`exportType=monthly_summary\`)
      **Purpose:** Generate monthly reports (same as weekly but monthly period)
      
      **Example Usage:**
      \`\`\`
      GET /export/data?exportType=monthly_summary
      GET /export/data?exportType=monthly_summary&startDate=2025-01-01&endDate=2025-01-31
      \`\`\`
      
      ---
      
      ## 📊 STANDARD EXPORTS
      
      ### Sales Export (\`exportType=sales\`)
      Individual sales transactions with payment status
      
      ### Customers Export (\`exportType=customers\`)
      Customer records with debt summary
      
      ### Payments Export (\`exportType=payments\`)
      Payment transaction history
      
      ### Devices Export (\`exportType=devices\`)
      Device installation records
      
      ---
      
      ## 🔍 COMMON FILTERS
      
      **Date Filters:**
      - \`startDate\`: Start date (ISO format: 2025-01-01)
      - \`endDate\`: End date (ISO format: 2025-12-31)
      
      **Location Filters:**
      - \`state\`: Filter by state (e.g., Lagos)
      - \`lga\`: Filter by LGA (e.g., Ikeja)
      
      **Entity Filters:**
      - \`customerId\`: Specific customer
      - \`agentId\`: Specific agent
      - \`salesStatus\`: Sales status (COMPLETED, IN_INSTALLMENT, UNPAID)
      - \`paymentMethod\`: Payment method (CASH, ONLINE, BANK_TRANSFER, etc.)
      - \`paymentMode\`: Payment mode (ONE_OFF, INSTALLMENT)
      
      **Debt Filters:**
      - \`hasOutstandingDebt\`: Only customers with debt (true/false)
      - \`overdueDays\`: Minimum days overdue (default: 35)
      
      **Pagination:**
      - \`page\`: Page number (default: 1)
      - \`limit\`: Records per page (max: 5000)
      - \`format\`: Output format (csv or json)
      
      ---
      
      ## 💡 EXAMPLE USE CASES
      
      **1. View all customer debts:**
      \`\`\`
      GET /export/data?exportType=debt_report&format=json
      \`\`\`
      
      **2. Find customers who haven't paid in 60+ days:**
      \`\`\`
      GET /export/data?exportType=renewal_report&overdueDays=60
      \`\`\`
      
      **3. Get this week's sales report:**
      \`\`\`
      GET /export/data?exportType=weekly_summary&startDate=2025-10-06&endDate=2025-10-12
      \`\`\`
      
      **4. Export all Lagos customer debts:**
      \`\`\`
      GET /export/data?exportType=debt_report&state=Lagos
      \`\`\`
      
      **5. Agent's monthly performance:**
      \`\`\`
      GET /export/data?exportType=monthly_summary&agentId=xxx
      \`\`\`
      
      **6. Customer's payment history:**
      \`\`\`
      GET /export/data?exportType=payments&customerId=xxx
      \`\`\`
    `,
  })
  @ApiProduces('text/csv', 'application/json')
  @ApiExtraModels(ExportDataQueryDto)
  async exportData(
    @Query() exportDto: ExportDataQueryDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.exportService.exportData(exportDto);

    const format = exportDto.format || 'csv';

    if (format === 'json') {
      // Return JSON response with summary
      res.set({
        'Content-Type': 'application/json',
        'X-Total-Records': result.totalRecords.toString(),
        'X-Export-Type': result.exportType,
      });

      return {
        success: true,
        totalRecords: result.totalRecords,
        exportType: result.exportType,
        generatedAt: result.generatedAt,
        fileSize: result.fileSize,
        filters: result.filters,
        summary: result.summary,
        data: result.jsonData,
      };
    }

    // CSV download
    const filename = `${result.exportType}_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total-Records': result.totalRecords.toString(),
      'X-Export-Type': result.exportType,
      'X-File-Size': result.fileSize.toString(),
    });

    return new StreamableFile(Buffer.from(result.data, 'utf-8'));
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('summary/total-debt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get total outstanding debt summary',
    description: `
      Quick endpoint to get the total debt remaining from all customers.
      Returns aggregated statistics without full export.
    `,
  })
  @ApiOkResponse({
    description: 'Total debt summary',
    schema: {
      type: 'object',
      properties: {
        totalOutstandingDebt: { type: 'number', example: 15000000 },
        totalCustomersInDebt: { type: 'number', example: 45 },
        totalSalesWithDebt: { type: 'number', example: 67 },
        overdueCount: { type: 'number', example: 12 },
        averageDebtPerCustomer: { type: 'number', example: 333333.33 },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getTotalDebtSummary() {
    // Call debt report with summary only
    const result = await this.exportService.exportData({
      exportType: 'debt_report',
      format: 'json',
      limit: 1, // We only need the summary, not the full data
    } as ExportDataQueryDto);

    return {
      success: true,
      ...result.summary,
      averageDebtPerCustomer:
        result.summary.totalCustomersInDebt > 0
          ? parseFloat(
              (
                result.summary.totalOutstandingDebt /
                result.summary.totalCustomersInDebt
              ).toFixed(2),
            )
          : 0,
    };
  }

  // @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  // @RolesAndPermissions({
  //   permissions: [
  //     `${ActionEnum.read}:${SubjectEnum.Sales}`,
  //     `${ActionEnum.manage}:${SubjectEnum.Sales}`,
  //   ],
  // })
  @Get('summary/overdue-payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get overdue payments summary',
    description: `
      Quick endpoint to see customers who have not paid monthly reactivation payments.
      Returns count and summary without full export.
    `,
  })
  @ApiExtraModels(OutstandingPaymentsQueryDto)
  async getOverduePaymentsSummary(
    @Query() query?: OutstandingPaymentsQueryDto,
  ) {
    const result = await this.exportService.exportData({
      exportType: ExportType.RENEWAL_REPORT,
      format: 'json',
      overdueDays: query.overdueDays || 35,
      limit: 1,
    } as ExportDataQueryDto);

    return {
      success: true,
      ...result.summary,
    };
  }
}
