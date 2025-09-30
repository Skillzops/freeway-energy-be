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
} from '@nestjs/swagger';
import { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { ExportService } from './export.service';
import { ExportDataQueryDto } from './dto/export-query.dto';

@ApiTags('Data Export')
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
    summary: 'Export data to CSV',
    description: `
      Export various types of data to CSV format with flexible filtering options.
      
      **Export Types:**
      - \`sales\`: Export sales records with customer and product information
      - \`customers\`: Export customer records with sales summary
      - \`payments\`: Export payment records with transaction details
      - \`devices\`: Export device records with installation information
      - \`comprehensive\`: Export comprehensive data including all related information

      **Filtering Options:**
      - Date ranges (transaction date or created date)
      - Status filters (sales status, payment status, customer status)
      - Geographic filters (state, LGA)
      - Agent filters (agent ID, category, installer name)
      - Payment filters (method, amount range)
      - Product/Device filters (product ID, serial number)
      
      **Pagination:**
      - Use \`page\` and \`limit\` parameters for large datasets
      - Maximum 5000 records per request
      - Maximum 10000 total records per export
      
      **Examples:**
      - Export all sales for a customer: \`?exportType=sales&customerId=xxx\`
      - Export payments in date range: \`?exportType=payments&startDate=2025-01-01&endDate=2025-12-31\`
      - Export devices for a sale: \`?exportType=devices&customerId=xxx&startDate=2025-01-01\`
      - Export comprehensive data: \`?exportType=comprehensive&agentId=xxx&startDate=2025-01-01\`
    `,
  })
  @ApiProduces('text/csv', 'application/json')
  @ApiOkResponse({
    description: 'CSV file download or JSON response with export details',
    schema: {
      type: 'object',
      properties: {
        totalRecords: { type: 'number', example: 150 },
        estimatedCount: { type: 'number', example: 150 },
        exportType: { type: 'string', example: 'sales' },
        generatedAt: { type: 'string', format: 'date-time' },
        fileSize: { type: 'number', example: 52428 },
        filters: { type: 'object' },
      },
    },
  })
  async exportData(
    @Query() exportDto: ExportDataQueryDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.exportService.exportData(exportDto);

    // Set headers for CSV download
    const filename = `${result.exportType}_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total-Records': result.totalRecords.toString(),
      'X-Estimated-Count': result.estimatedCount?.toString() || '0',
      'X-File-Size': result.fileSize.toString(),
    });

    return new StreamableFile(Buffer.from(result.data, 'utf-8'));
  }
}
