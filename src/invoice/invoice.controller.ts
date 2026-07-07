import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { UpsertInvoiceSettingsDto } from './dto/invoice-settings.dto';
import {
  CreateSubInvoiceDto,
  GenerateInvoiceDto,
  VoidInvoiceDto,
} from './dto/generate-invoice.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';
import { GenerateReceiptDto } from './dto/generate-receipt.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { GetSessionUser } from '../auth/decorators/getUser';

const INVOICE_READ_PERMISSIONS = [
  `${ActionEnum.read}:${SubjectEnum.Invoices}`,
  `${ActionEnum.read}:${SubjectEnum.Sales}`,
  `${ActionEnum.write}:${SubjectEnum.Sales}`,
  `${ActionEnum.manage}:${SubjectEnum.Sales}`,
];

const SALE_SCOPED_INVOICE_READ = {
  permissions: INVOICE_READ_PERMISSIONS,
  allowAgents: true,
} as const;

/** Read/sales staff and agents may email invoices/receipts for accessible sales */
const SALE_SCOPED_INVOICE_SEND = SALE_SCOPED_INVOICE_READ;

@ApiTags('Invoices')
@ApiBearerAuth('access_token')
@UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get('settings')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Get invoice settings' })
  async getSettings() {
    return this.invoiceService.getSettings();
  }

  @Post('settings')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Create or update invoice settings' })
  async upsertSettings(
    @GetSessionUser('id') userId: string,
    @Body() dto: UpsertInvoiceSettingsDto,
  ) {
    return this.invoiceService.upsertSettings(dto, userId);
  }

  @Post('generate')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Generate master invoice for a sale' })
  async generate(
    @Body() dto: GenerateInvoiceDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.generateMasterInvoice(dto, userId);
  }

  @Post('sub')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Create a sub-invoice under a master' })
  async createSub(
    @Body() dto: CreateSubInvoiceDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.createSubInvoice(dto, userId);
  }

  @Patch(':id/void')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Void an invoice' })
  async void(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.voidInvoice(id, dto, userId);
  }

  @Get('stats')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Get invoice/receipt stats' })
  async getStats(@Query('hasReceipt') hasReceipt?: string) {
    return this.invoiceService.getInvoiceStats({ hasReceipt });
  }

  @Get('sale/:saleId')
  @RolesAndPermissions(SALE_SCOPED_INVOICE_READ)
  @ApiOperation({ summary: 'Get all invoices for a sale' })
  async getBySale(
    @Param('saleId') saleId: string,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.getInvoicesBySale(saleId, userId);
  }

  @Get()
  @RolesAndPermissions({
    permissions: [`${ActionEnum.read}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'List invoices (masters only, paginated)' })
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('hasReceipt') hasReceipt?: string,
    @Query('customerName') customerName?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
  ) {
    return this.invoiceService.listInvoices({
      page,
      limit,
      status,
      statusGroup,
      type,
      search,
      hasReceipt,
      customerName,
      dateFrom,
      dateTo,
      dueDateFrom,
      dueDateTo,
    });
  }

  @Get(':id')
  @RolesAndPermissions(SALE_SCOPED_INVOICE_READ)
  @ApiOperation({ summary: 'Get single invoice with live balance' })
  async getOne(
    @Param('id') id: string,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.getInvoiceWithDerivedAmounts(id, userId);
  }

  @Post(':id/pay')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  async pay(
    @Param('id') id: string,
    @Body() dto: PayInvoiceDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.payInvoice(id, dto, userId);
  }

  @Post(':id/receipt')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Generate or regenerate a receipt for an invoice payment' })
  async generateReceipt(
    @Param('id') id: string,
    @Body() dto: GenerateReceiptDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.generateReceiptForInvoice(id, userId, dto);
  }

  @Post(':id/receipt/send')
  @RolesAndPermissions(SALE_SCOPED_INVOICE_SEND)
  @ApiOperation({ summary: 'Send receipt to customer email' })
  async sendReceipt(
    @Param('id') id: string,
    @Body() dto: SendReceiptDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.sendReceiptToCustomer(id, userId, dto?.paymentId);
  }

  @Post(':id/pdf')
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Invoices}`],
  })
  @ApiOperation({ summary: 'Regenerate invoice PDF' })
  async regeneratePdf(
    @Param('id') id: string,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.regenerateInvoicePdf(id, userId);
  }

  @Post(':id/send')
  @RolesAndPermissions(SALE_SCOPED_INVOICE_SEND)
  @ApiOperation({ summary: 'Send invoice PDF to customer email' })
  @ApiOkResponse({ description: 'Invoice emailed successfully' })
  @HttpCode(HttpStatus.OK)
  async sendToCustomer(
    @Param('id') id: string,
    @GetSessionUser('id') userId: string,
  ) {
    return this.invoiceService.sendInvoiceToCustomer(id, userId);
  }
}
