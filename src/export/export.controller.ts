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
  ApiExtraModels,
} from '@nestjs/swagger';
import { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { ExportService } from './export.service';
import { ExportDataQueryDto } from './dto/export-query.dto';

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

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
    ],
  })
  @Get('data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export business data and generate reports',
    description: `
# 📊 Export & Reporting System

### 1. DEBT REPORT (\`exportType=debt_report\`)
**Purpose:** View individual customer debts remaining and number of months

**What it shows:**
- Outstanding balance per customer
- Remaining months to complete payment  
- Days since last payment
- Overdue status
- **Total debt remaining from ALL customers**

**Use Cases:**
- Track which customers owe money
- See how much total debt the company has
- Identify customers behind on payments

**Example Requests:**
\`\`\`
GET /export/data?exportType=debt_report
GET /export/data?exportType=debt_report&customerId=xxx
GET /export/data?exportType=debt_report&state=Lagos
GET /export/data?exportType=debt_report&overdueDays=60
\`\`\`

**Response Fields Explained:**
- \`outstandingBalance\`: How much customer still owes (totalPrice - totalPaid)
- \`remainingMonths\`: Months left to complete payment (calculated from monthlyPayment)
- \`daysSinceLastPayment\`: Days since customer made their last payment
- \`isOverdue\`: Whether payment is overdue (> 30 days by default)
- \`totalPaymentsMade\`: Number of payments received so far

**Summary Includes:**
- \`totalOutstandingDebt\`: Total debt across ALL customers (NGN)
- \`totalCustomersInDebt\`: Number of unique customers with outstanding debt
- \`totalSalesWithDebt\`: Number of sale records with outstanding balance

---

## 📋 STANDARD EXPORTS

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
- \`overdueDays\`: Minimum days overdue (default: 30)

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
GET /export/data?exportType=weekly_summary&startDate=2025-10-13&endDate=2025-10-19
\`\`\`

**4. Export all Lagos customer debts:**
\`\`\`
GET /export/data?exportType=debt_report&state=Lagos
\`\`\`

**5. Agent's monthly performance:**
\`\`\`
GET /export/data?exportType=monthly_summary&agentId=xxx&startDate=2025-10-01&endDate=2025-10-31
\`\`\`

**6. Customer's payment history:**
\`\`\`
GET /export/data?exportType=payments&customerId=xxx
\`\`\`

---

## 📊 UNDERSTANDING THE DATA

**Debt Calculations:**
- \`outstandingBalance = totalPrice - totalPaid\`
- \`remainingMonths = outstandingBalance / monthlyPayment\` (rounded up)
- \`isOverdue = daysSinceLastPayment > overdueDays (default: 30)\`

**Payment Tracking:**
- First payment = Initial/down payment
- Subsequent payments = Monthly installments (renewals)
- \`missedPayments = expectedPayments - actualPayments\`

**Summary Reports:**
- **New Sales** = Sales created within the date range
- **Renewals** = Installment payments made within the date range (excluding initial payment)
- **Cash Sales** = ONE_OFF payment mode
- **Installment Sales** = INSTALLMENT payment mode
    `,
  })
  @ApiProduces('text/csv', 'application/json')
  @ApiExtraModels(ExportDataQueryDto)
  @ApiOkResponse({
    description: 'Export successful',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            totalRecords: { type: 'number', example: 150 },
            exportType: { type: 'string', example: 'debt_report' },
            generatedAt: { type: 'string', format: 'date-time' },
            fileSize: { type: 'number', example: 45000 },
            summary: {
              type: 'object',
              properties: {
                totalOutstandingDebt: { type: 'number', example: 15000000 },
                totalCustomersInDebt: { type: 'number', example: 45 },
                totalSalesWithDebt: { type: 'number', example: 67 },
              },
            },
            data: { type: 'array', items: { type: 'object' } },
          },
        },
        {
          type: 'string',
          description: 'CSV file content',
        },
      ],
    },
  })
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
        allRecordsCount: result.allRecordsCount,
        currentPage: result.currentPage,
        totalPages: result.totalPages,
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
}

// ### 2. RENEWAL/REACTIVATION REPORT (\`exportType=renewal_report\`)
// **Purpose:** See customers who have NOT paid monthly reactivation payments

// **What it shows:**
// - Customers with overdue installment payments
// - How many days/months they have defaulted
// - Number of missed payments
// - Expected payment amount due

// **Use Cases:**
// - Find customers who stopped paying monthly installments
// - Track payment defaulters
// - Send payment reminders

// **Example Requests:**
// \`\`\`
// GET /export/data?exportType=renewal_report
// GET /export/data?exportType=renewal_report&overdueDays=60
// GET /export/data?exportType=renewal_report&agentId=xxx
// GET /export/data?exportType=renewal_report&state=Lagos
// \`\`\`

// **Response Fields Explained:**
// - \`daysSinceLastPayment\`: Days since customer last paid
// - \`monthsDefaulted\`: Months customer hasn't paid (daysSinceLastPayment / 30)
// - \`missedPayments\`: Number of monthly payments missed
// - \`expectedPaymentAmount\`: Amount customer should have paid (monthlyPayment × missedPayments)

// **Summary Includes:**
// - \`totalDefaulters\`: Number of customers who stopped paying
// - \`totalMissedPayments\`: Total missed payments across all customers

// ---

// ### 3. WEEKLY SUMMARY (\`exportType=weekly_summary\`)
// **Purpose:** Generate weekly reports for new sales and renewals

// **What it shows:**
// - **New Sales:** Total count, cash vs installment quantities, revenue breakdown
// - **Renewals:** Total count and amounts paid (subsequent installment payments)
// - Grand total combined revenue

// **Use Cases:**
// - Weekly performance tracking
// - Compare cash vs installment sales
// - Track renewal payment collections

// **Example Requests:**
// \`\`\`
// GET /export/data?exportType=weekly_summary
// GET /export/data?exportType=weekly_summary&startDate=2025-01-01&endDate=2025-01-07
// GET /export/data?exportType=weekly_summary&agentId=xxx
// \`\`\`

// **Response Fields Explained:**
// - \`newSales.totalCount\`: Number of new sales made
// - \`newSales.totalQuantity\`: Total stock quantity sold
// - \`newSales.cashSalesCount\`: Number of outright/cash sales
// - \`newSales.cashQuantity\`: Stock quantity sold as cash
// - \`newSales.installmentSalesCount\`: Number of installment sales
// - \`newSales.installmentQuantity\`: Stock quantity sold as installment
// - \`renewals.totalCount\`: Number of renewal payments received
// - \`renewals.totalAmount\`: Total money collected from renewals

// ---

// ### 4. MONTHLY SUMMARY (\`exportType=monthly_summary\`)
// **Purpose:** Generate monthly reports (same as weekly but monthly period)

// **Example Requests:**
// \`\`\`
// GET /export/data?exportType=monthly_summary
// GET /export/data?exportType=monthly_summary&startDate=2025-01-01&endDate=2025-01-31
// GET /export/data?exportType=monthly_summary&agentId=xxx
// \`\`\`

// ---

// ### 5. TOTAL OUTSTANDING RECEIVABLES REPORT (\`exportType=total_outstanding_receivables\`)
// **Purpose:** Get total outstanding debt summary with date range filters

// **What it shows:**
// - Total outstanding debt across all sales
// - Count of debts and overdue debts
// - Breakdown of overdue vs non-overdue amounts
// - Overdue threshold applied (default: 30 days)

// **Use Cases:**
// - Track total company receivables
// - See how much is overdue vs current
// - Monitor debt collection trends over time

// **Example Requests:**
// \`\`\`
// GET /export/data?exportType=total_outstanding_receivables
// GET /export/data?exportType=total_outstanding_receivables&startDate=2025-01-01&endDate=2025-12-31
// GET /export/data?exportType=total_outstanding_receivables&overdueDays=60
// \`\`\`

// **Response Fields:**
// - \`totalOutstandingDebt\`: Total of all outstanding balances (NGN)
// - \`totalOutstandingDebtsOverdue\`: Amount that is overdue (NGN)
// - \`totalDebtsCount\`: Number of individual debts
// - \`overdueDebtsCount\`: Number of overdue debts
// - \`nonOverdueDebtsAmount\`: Amount not yet overdue
// - \`nonOverdueDebtsCount\`: Count of non-overdue debts

// ---

// ### 6. DEBT REPORT (\`exportType=debt_report\`)
// **Updated:** Now supports \`isOverdue\` filter to show only overdue or non-overdue debts

// **New Filter:**
// - \`isOverdue\`: true (only overdue), false (only current), or omitted (all)

// **Example Requests:**
// \`\`\`
// GET /export/data?exportType=debt_report&isOverdue=true
// GET /export/data?exportType=debt_report&isOverdue=false
// GET /export/data?exportType=debt_report (shows all)
// \`\`\`
