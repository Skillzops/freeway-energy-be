import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { BRAND_NAME, BRAND_ORG_CODE } from '../constants/brand.constants';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../mailer/email.service';
import { ConfigService } from '@nestjs/config';
import {
  ActionEnum,
  AuditActions,
  InvoiceStatus,
  InvoiceType,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SubjectEnum,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { UpsertInvoiceSettingsDto } from './dto/invoice-settings.dto';
import { CreateSubInvoiceDto, GenerateInvoiceDto, VoidInvoiceDto } from './dto/generate-invoice.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';
import { GenerateReceiptDto } from './dto/generate-receipt.dto';
import { InvoicePdfService } from './invoice-pdf.service';
import { PaymentService } from '../payment/payment.service';
import { ReferenceGeneratorService } from '../payment/reference-generator.service';
import {
  buildInvoiceCustomerEmailHtml,
  buildReceiptCustomerEmailHtml,
} from './invoice-email.templates';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
    private readonly referenceGenerator: ReferenceGeneratorService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  // ─── Settings ────────────────────────────────────────────────────────────────

  async getSettings() {
    return this.prisma.invoiceSettings.findFirst();
  }

  async upsertSettings(dto: UpsertInvoiceSettingsDto, userId?: string) {
    const existing = await this.prisma.invoiceSettings.findFirst();
    const settings = existing
      ? await this.prisma.invoiceSettings.update({
          where: { id: existing.id },
          data: { ...dto },
        })
      : await this.prisma.invoiceSettings.create({ data: { ...dto } });

    this.auditLogService.createLog({
      action: existing ? AuditActions.PATCH : AuditActions.POST,
      entity: 'InvoiceSettings',
      entityId: settings.id,
      userId,
      oldValues: existing ? { ...existing } : undefined,
      newValues: { ...settings },
      metadata: {
        summary: existing
          ? 'Invoice settings updated'
          : 'Invoice settings created',
      },
    }).catch(() => {});

    return settings;
  }

  /**
   * Fail-fast gate — call this before ANY invoice creation.
   * Throws BadRequestException with a clear, actionable message if settings
   * are missing or incomplete.
   */
  async validateInvoiceSettings() {
    const settings = await this.prisma.invoiceSettings.findFirst();

    if (!settings) {
      throw new BadRequestException(
        'Invoice settings not configured. Go to Settings → Invoicing to set up before generating invoices.',
      );
    }

    const missing: string[] = [];
    if (settings.taxEnabled && !settings.taxRate) missing.push('tax rate');
    if (!settings.bankName)      missing.push('bank name');
    if (!settings.accountNumber) missing.push('account number');
    if (!settings.accountName)   missing.push('account name');
    if (!settings.invoicePrefix) missing.push('invoice prefix');

    if (missing.length) {
      throw new BadRequestException(
        `Invoice settings incomplete. Missing: ${missing.join(', ')}. ` +
          'Go to Settings → Invoicing to complete setup.',
      );
    }

    return settings;
  }

  // ─── Invoice Number Generation ────────────────────────────────────────────

  private async generateInvoiceNumber(settingsId: string): Promise<string> {
    // Atomic increment — safe under concurrent requests
    const updated = await this.prisma.invoiceSettings.update({
      where: { id: settingsId },
      data: { nextSequence: { increment: 1 } },
      select: { nextSequence: true, invoicePrefix: true },
    });

    const orgCode = BRAND_ORG_CODE;
    const year = new Date().getFullYear();
    const seq = String(updated.nextSequence - 1).padStart(4, '0');
    return `${updated.invoicePrefix}-${year}-${orgCode}-${seq}`;
  }



  private async generateReceiptNumber(settingsId: string): Promise<string> {
    const updated = await this.prisma.invoiceSettings.update({
      where: { id: settingsId },
      data: { nextReceiptSequence: { increment: 1 } },
      select: { nextReceiptSequence: true, receiptPrefix: true },
    });

    const orgCode = BRAND_ORG_CODE;
    const year = new Date().getFullYear();
    const seq = String(updated.nextReceiptSequence - 1).padStart(4, '0');
    return `${updated.receiptPrefix}-${year}-${orgCode}-${seq}`;
  }

  private async buildAndUploadReceiptPdf(
    invoice: any,
    payment: any,
    settings: any,
    tenant: any,
    receiptNumber: string,
    note?: string | null,
  ): Promise<string | null> {
    const html = this.invoicePdfService.buildReceiptHtml(
      invoice,
      payment,
      settings,
      tenant
        ? { ...tenant, logo: tenant.logoUrl, address: tenant.companyAddress }
        : null,
      receiptNumber,
      note || undefined,
    );
    const pdfBuffer = await this.invoicePdfService.generatePdf(html);
    const pdfUrl = await this.invoicePdfService.uploadPdfBuffer(pdfBuffer, receiptNumber);
    return pdfUrl;
  }

  private async sendReceiptToCustomerEmail(
    invoice: any,
    payment: any,
    receipt: any,
    tenant: any,
  ): Promise<void> {
    const customer = invoice?.sale?.customer;
    const customerEmail = customer?.email?.trim();
    if (!customerEmail) {
      throw new BadRequestException('Customer has no email address on record');
    }

    const customerName =
      [customer?.firstname, customer?.lastname].filter(Boolean).join(' ').trim() || 'Valued Customer';
    const sym = invoice?.settings?.currencySymbol ?? '₦';
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2 }).format(n ?? 0);
    const receiptHtml = this.invoicePdfService.buildReceiptHtml(
      invoice,
      payment,
      invoice?.settings,
      tenant
        ? { ...tenant, logo: tenant.logoUrl, address: tenant.companyAddress }
        : null,
      receipt.receiptNumber,
      receipt?.note || undefined,
    );
    const receiptPdfBuffer = await this.invoicePdfService.generatePdf(receiptHtml);
    const pdfUrl =
      receipt.pdfUrl ??
      (await this.invoicePdfService.uploadPdfBuffer(
        receiptPdfBuffer,
        receipt.receiptNumber,
      ));

    this.logger.log(
      `Sending receipt ${receipt.receiptNumber} for invoice ${invoice.invoiceNumber} to ${customerEmail}`,
    );

    await this.emailService.sendMail({
      to: customerEmail,
      subject: `Payment Receipt ${receipt.receiptNumber} for Invoice ${invoice.invoiceNumber}`,
      html: buildReceiptCustomerEmailHtml({
        customerName,
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: receipt.receiptNumber,
        amountPaid: payment.amount ?? receipt.amount ?? 0,
        paymentDate: payment.paymentDate ?? receipt.createdAt,
        pdfUrl,
        tenantName: tenant?.name ?? 'Your Provider',
        currencySymbol: sym,
      }),
    });

    this.logger.log(
      `Receipt ${receipt.receiptNumber} email accepted by SMTP for ${customerEmail}`,
    );
  }

  private buildPaygInstallmentNote(sale: {
    saleItems?: Array<{
      paymentMode?: string;
      monthlyPayment?: number | null;
      installmentDuration?: number | null;
      remainingInstallments?: number | null;
    }>;
    totalMonthlyPayment?: number | null;
    remainingInstallments?: number | null;
    totalInstallmentDuration?: number | null;
  } | null | undefined): string | null {
    if (!sale?.saleItems?.length) return null;
    const paygItem = sale.saleItems.find(
      (si) =>
        si.paymentMode === 'INSTALLMENT' ||
        (si.installmentDuration ?? 0) > 0,
    );
    if (!paygItem) return null;
    const monthly =
      paygItem.monthlyPayment ?? sale.totalMonthlyPayment ?? null;
    const total =
      paygItem.installmentDuration ?? sale.totalInstallmentDuration ?? null;
    const remaining =
      paygItem.remainingInstallments ?? sale.remainingInstallments ?? null;
    if (monthly == null) return 'Pay-as-you-go installment plan';
    const paid =
      total != null && remaining != null ? total - remaining : null;
    if (paid != null && total != null) {
      return `₦${monthly.toLocaleString('en-NG')} per installment (${paid + 1} of ${total} due next)`;
    }
    return `₦${monthly.toLocaleString('en-NG')} per installment`;
  }

  async generateReceiptForInvoice(
    invoiceId: string,
    userId: string,
    dto?: GenerateReceiptDto,
  ) {
    const receiptsEnabled = await this.isReceiptFeatureEnabled();
    if (!receiptsEnabled) {
      throw new BadRequestException('Receipts feature is disabled');
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        settings: true,
        sale: { include: { customer: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.settings) {
      throw new BadRequestException('Invoice settings missing');
    }

    let payment = dto?.paymentId
      ? await this.prisma.payment.findFirst({
          where: {
            id: dto.paymentId,
            paymentStatus: PaymentStatus.COMPLETED,
          },
        })
      : null;

    if (!payment) {
      payment = await this.prisma.payment.findFirst({
        where: {
          paymentStatus: PaymentStatus.COMPLETED,
          OR: [
            { invoiceId },
            { saleId: invoice.saleId, invoiceId: null },
          ],
        },
        orderBy: { paymentDate: 'desc' },
      });
    }

    if (!payment) {
      throw new BadRequestException(
        dto?.paymentId
          ? 'Specified payment was not found or not completed for this invoice.'
          : 'No completed payments found for this invoice.',
      );
    }

    if (!payment.invoiceId) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { invoiceId },
      });
      payment = { ...payment, invoiceId };
    }

    const existing = await this.prisma.receipt.findUnique({
      where: { paymentId: payment.id },
    });

    const tenant = this.getCompanyBranding(invoice.settings);

    if (existing) {
      const pdfUrl = await this.buildAndUploadReceiptPdf(
        invoice,
        payment,
        invoice.settings,
        tenant,
        existing.receiptNumber,
        dto?.note ?? existing.note,
      );
      const updated = await this.prisma.receipt.update({
        where: { id: existing.id },
        data: { pdfUrl: pdfUrl ?? existing.pdfUrl, note: dto?.note ?? existing.note },
      });
      if (invoice.settings?.autoEmailReceiptToCustomer) {
        await this.sendReceiptToCustomerEmail(invoice, payment, updated, tenant);
      }
      return updated;
    }

    const receiptNumber = await this.generateReceiptNumber(invoice.settings.id);
    const pdfUrl = await this.buildAndUploadReceiptPdf(
      invoice,
      payment,
      invoice.settings,
      tenant,
      receiptNumber,
      dto?.note ?? payment.notes,
    );

    const receipt = await this.prisma.receipt.create({
      data: {
        receiptNumber,
                invoiceId,
        paymentId: payment.id,
        amount: payment.amount,
        note: dto?.note ?? payment.notes,
        pdfUrl: pdfUrl ?? undefined,
        createdById: userId,
      },
    });

    if (invoice.settings?.autoEmailReceiptToCustomer) {
      await this.sendReceiptToCustomerEmail(invoice, payment, receipt, tenant);
    }

    await this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'Receipt',
      entityId: receipt.id,
      userId,
            metadata: {
        summary: `Receipt ${receipt.receiptNumber} generated for invoice ${invoice.invoiceNumber}`,
        invoiceId,
        paymentId: payment.id,
      },
    });

    return receipt;
  }

  async sendReceiptToCustomer(
    invoiceId: string,
    userId: string,
    paymentId?: string,
  ) {
    const receiptsEnabled = await this.isReceiptFeatureEnabled();
    if (!receiptsEnabled) {
      throw new BadRequestException('Receipts feature is disabled');
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        settings: true,
        sale: { include: { customer: true } },
        receipts: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.saleId) {
      await this.assertCanReadSaleInvoices(invoice.saleId, userId);
    }
    if (!invoice.sale?.customer?.email) {
      throw new BadRequestException('Customer has no email address on record');
    }

    const targetReceipt = paymentId
      ? invoice.receipts?.find((r) => r.paymentId === paymentId)
      : invoice.receipts?.[0];
    if (!targetReceipt) {
      throw new BadRequestException(
        paymentId
          ? 'No receipt found for this payment — generate a receipt first'
          : 'No generated receipt found for this invoice',
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: targetReceipt.paymentId },
    });
    if (!payment) {
      throw new BadRequestException('Associated payment for this receipt was not found');
    }

    const tenant = this.getCompanyBranding(invoice.settings);

    let receiptToSend = targetReceipt;
    if (!receiptToSend.pdfUrl) {
      const pdfUrl = await this.buildAndUploadReceiptPdf(
        invoice,
        payment,
        invoice.settings,
        tenant,
        receiptToSend.receiptNumber,
        receiptToSend.note,
      );
      if (pdfUrl) {
        receiptToSend = await this.prisma.receipt.update({
          where: { id: receiptToSend.id },
          data: { pdfUrl },
        });
      }
    }

    this.logger.log(
      `User ${userId} sending receipt ${receiptToSend.receiptNumber} for invoice ${invoice.invoiceNumber} to ${invoice.sale.customer.email}`,
    );

    await this.sendReceiptToCustomerEmail(invoice, payment, receiptToSend, tenant);

    await this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'Receipt',
      entityId: receiptToSend.id,
      userId,
            metadata: {
        summary: `Receipt ${receiptToSend.receiptNumber} sent to customer for invoice ${invoice.invoiceNumber}`,
        invoiceId,
        paymentId: payment.id,
      },
    });

    return {
      message: `Receipt ${receiptToSend.receiptNumber} sent to customer email`,
      receiptId: receiptToSend.id,
      receiptNumber: receiptToSend.receiptNumber,
    };
  }

  private async isReceiptFeatureEnabled(): Promise<boolean> {
    return true;
  }

  /** Uses invoice settings flag `autoGenerateReceiptOnPayment`. */
  private async maybeAutoGenerateReceipt(
    invoiceId: string,
    paymentId: string,
    userId?: string,
  ): Promise<void> {
    const settings = await this.prisma.invoiceSettings.findFirst({
      select: { autoGenerateReceiptOnPayment: true },
    });
    if (!settings?.autoGenerateReceiptOnPayment) return;

    const existing = await this.prisma.receipt.findUnique({
      where: { paymentId },
    });
    if (existing) return;

    try {
      await this.generateReceiptForInvoice(
        invoiceId,
        userId ?? 'system',
        { paymentId },
      );
    } catch (err: any) {
      this.logger.warn(
        `Auto receipt skipped for payment ${paymentId} on invoice ${invoiceId}: ${err?.message}`,
      );
    }
  }

  private getCompanyBranding(
    settings?: {
      companyName?: string | null;
      companyAddress?: string | null;
      companyLogoUrl?: string | null;
    } | null,
  ) {
    if (!settings) return null;
    return {
      name: settings.companyName ?? BRAND_NAME,
      logoUrl: settings.companyLogoUrl ?? undefined,
      companyAddress: settings.companyAddress ?? undefined,
      logo: settings.companyLogoUrl ?? undefined,
      address: settings.companyAddress ?? undefined,
    };
  }

  private buildSubInvoiceNumber(masterNumber: string, count: number): string {
    return `${masterNumber}/${count}`;
  }

  // ─── Live balance derivation ──────────────────────────────────────────────

  /** MongoDB may omit invoiceId instead of storing null — match both. */
  private unlinkedInvoiceIdWhere(): Prisma.PaymentWhereInput {
    return {
      OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }],
    };
  }

  private unlinkedSalePaymentsWhere(saleId: string): Prisma.PaymentWhereInput {
    return {
      saleId,
      paymentStatus: PaymentStatus.COMPLETED,
      ...this.unlinkedInvoiceIdWhere(),
    };
  }

  async deriveInvoiceAmounts(invoiceId: string, parentId?: string | null) {
    // For sub-invoices sum payments on that sub-invoice only
    // For master, sum payments on master AND all sub-invoices, plus completed
    // sale payments not yet linked (wallet-at-sale-create runs before auto-invoice).
    const invoiceMeta = parentId
      ? null
      : await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
          select: { saleId: true, type: true },
        });

    const orClauses: Prisma.PaymentWhereInput[] = [{ invoiceId }];
    if (!parentId) {
      orClauses.push({ invoice: { parentId: invoiceId } });
      if (
        invoiceMeta?.type === InvoiceType.MASTER &&
        invoiceMeta.saleId
      ) {
        orClauses.push(this.unlinkedSalePaymentsWhere(invoiceMeta.saleId));
      }
    }

    const filter: Prisma.PaymentWhereInput = parentId
      ? { invoiceId, paymentStatus: PaymentStatus.COMPLETED }
      : { paymentStatus: PaymentStatus.COMPLETED, OR: orClauses };

    const agg = await this.prisma.payment.aggregate({
      where: filter,
      _sum: { amount: true },
    });

    return agg._sum.amount ?? 0;
  }

  /**
   * Links completed sale payments to the active master invoice and refreshes
   * amountPaid / status (fixes wallet-first PAYG auto-invoice ordering).
   */
  async syncSalePaymentsToMasterInvoice(
    saleId: string,
    actorUserId?: string,
    options?: { autoReceipt?: boolean },
  ): Promise<void> {
    const salesId = await this.resolveSalesRecordId(saleId);
    const master = await this.prisma.invoice.findFirst({
      where: {
        saleId: salesId,
        type: InvoiceType.MASTER,
        status: { not: InvoiceStatus.VOID },
      },
      select: { id: true, totalAmount: true, dueDate: true, status: true },
    });
    if (!master) return;

    await this.prisma.payment.updateMany({
      where: this.unlinkedSalePaymentsWhere(salesId),
      data: { invoiceId: master.id },
    });

    const liveAmountPaid = await this.deriveInvoiceAmounts(master.id, null);
    const balance = master.totalAmount - liveAmountPaid;
    const status = this.deriveStatus(
      { status: master.status, dueDate: master.dueDate },
      liveAmountPaid,
      balance,
    );

    await this.prisma.invoice.update({
      where: { id: master.id },
      data: { amountPaid: liveAmountPaid, status },
    });

    if (options?.autoReceipt !== false) {
      const linkedPayments = await this.prisma.payment.findMany({
        where: {
          invoiceId: master.id,
          paymentStatus: PaymentStatus.COMPLETED,
        },
        select: { id: true },
      });
      for (const { id: paymentId } of linkedPayments) {
        await this.maybeAutoGenerateReceipt(master.id, paymentId, actorUserId);
      }
    }
  }

  async getInvoiceWithDerivedAmounts(
    invoiceId: string,
    requestUserId?: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        subInvoices: true,
        settings: true,
        payments: {
          where: { paymentStatus: 'COMPLETED' },
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            paymentMethod: true,
            paymentStatus: true,
            createdAt: true,
            transactionRef: true,
            notes: true,
            saleItemId: true,
            recordedBy: { select: { firstname: true, lastname: true } },
          },
        },
        receipts: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, receiptNumber: true, amount: true, pdfUrl: true, createdAt: true, paymentId: true },
        },
        sale: {
          select: {
            formattedSaleId: true,
            customer: {
              select: {
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
              },
            },
            saleItems: {
              select: {
                id: true,
                totalPrice: true,
                paymentMode: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (requestUserId && invoice.saleId) {
      await this.assertCanReadSaleInvoices(invoice.saleId, requestUserId);
    }

    // Resolve voider name without requiring a schema relation
    let voidedByName: string | null = null;
    if (invoice.voidedById) {
      const voider = await this.prisma.user.findUnique({
        where: { id: invoice.voidedById },
        select: { firstname: true, lastname: true, username: true },
      });
      if (voider) {
        voidedByName =
          [voider.firstname, voider.lastname].filter(Boolean).join(' ').trim() ||
          voider.username ||
          null;
      }
    }

    const liveAmountPaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
    const balance = invoice.totalAmount - liveAmountPaid;
    const status = this.deriveStatus(invoice, liveAmountPaid, balance);

    return { ...invoice, voidedByName, liveAmountPaid, balance, derivedStatus: status };
  }

  deriveStatus(
    invoice: { status: InvoiceStatus; dueDate: Date | null },
    liveAmountPaid: number,
    balance: number,
  ): InvoiceStatus {
    if (invoice.status === InvoiceStatus.VOID) return InvoiceStatus.VOID;
    if (balance <= 0) return InvoiceStatus.PAID;
    if (liveAmountPaid > 0 && balance > 0) return InvoiceStatus.PARTIALLY_PAID;
    if (invoice.dueDate && invoice.dueDate < new Date() && balance > 0)
      return InvoiceStatus.OVERDUE;
    if (liveAmountPaid === 0) return InvoiceStatus.SENT;
    return invoice.status;
  }

  /**
   * Accepts either a Sales.id or a SaleItem.id (legacy UI sent sale-item ids).
   */
  private async resolveSalesRecordId(idOrSaleItemId: string): Promise<string> {
    const trimmed = idOrSaleItemId?.trim();
    if (!trimmed) {
      throw new BadRequestException('saleId is required');
    }

    const sale = await this.prisma.sales.findUnique({
      where: { id: trimmed },
      select: { id: true },
    });
    if (sale) return sale.id;

    const saleItem = await this.prisma.saleItem.findUnique({
      where: { id: trimmed },
      select: { saleId: true },
    });
    if (saleItem?.saleId) return saleItem.saleId;

    throw new NotFoundException('Sale not found');
  }

  // ─── Generate Master Invoice (Direct Sale) ────────────────────────────────

  async generateMasterInvoice(
    dto: GenerateInvoiceDto,
    createdById: string,
  ) {
    const settings = await this.validateInvoiceSettings();
    const salesId = await this.resolveSalesRecordId(dto.saleId);

    const sale = await this.prisma.sales.findUnique({
      where: { id: salesId },
      include: {
        saleItems: { include: { product: true, devices: true } },
        customer: true,
      },
    });

    if (!sale) throw new NotFoundException('Sale not found');

    // Guard: one active master invoice per sale
    const existing = await this.prisma.invoice.findFirst({
      where: {
        saleId: salesId,
        type: InvoiceType.MASTER,
        status: { not: InvoiceStatus.VOID },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `An active master invoice (${existing.invoiceNumber}) already exists for this sale. Void it before generating a new one.`,
      );
    }

    const subtotal = sale.totalPrice ?? 0;
    const taxAmount = settings.taxEnabled
      ? parseFloat(((subtotal * settings.taxRate) / 100).toFixed(2))
      : 0;
    const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

    const invoiceNumber = await this.generateInvoiceNumber(settings.id);

    const lineItems: any[] =
      sale.saleItems.map((item) => ({
        description: item.product
          ? `${item.product.name}${item.devices?.[0] ? ` — SN: ${item.devices[0].serialNumber}` : ''}`
          : 'Product',
        quantity: item.quantity ?? 1,
        unitPrice: item.totalPrice / (item.quantity ?? 1),
        total: item.totalPrice,
        metadata: { saleItemId: item.id, productId: item.productId },
      }));

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        saleId: salesId,
        settingsId: settings.id,
        type: InvoiceType.MASTER,
        status: InvoiceStatus.SENT,
        subtotal,
        taxName: settings.taxName,
        taxRate: settings.taxEnabled ? settings.taxRate : 0,
        taxAmount,
        totalAmount,
        dueDate: dto.dueDate
          ? new Date(dto.dueDate)
          : settings.defaultDueDays > 0
          ? new Date(Date.now() + settings.defaultDueDays * 86_400_000)
          : null,
        note: dto.note,
                createdById,
        lineItems: { create: lineItems },
      },
      include: { lineItems: true },
    });

    await this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'Invoice',
      entityId: invoice.id,
      userId: createdById,
            metadata: {
        summary: `Master invoice ${invoiceNumber} generated for sale ${sale.formattedSaleId}`,
        invoiceNumber,
        saleId: salesId,
        totalAmount,
      },
    });

    // Fire-and-forget PDF generation — never blocks the response
    this.generateAndAttachPdf(invoice.id).catch((err) =>
      this.logger.error(`PDF fire-and-forget failed for ${invoice.id}: ${err?.message}`),
    );

    await this.syncSalePaymentsToMasterInvoice(salesId).catch((err) =>
      this.logger.warn(
        `Payment sync after invoice ${invoice.invoiceNumber}: ${err?.message}`,
      ),
    );

    return invoice;
  }

  // ─── Generate Master Invoice for PAYG (called inside sale transaction) ───

  async generatePaygoMasterInvoice(
    tx: Prisma.TransactionClient,
    saleId: string,
        createdById: string,
    settings: Awaited<ReturnType<typeof this.getSettings>>,
    sale: any,
  ) {
    const subtotal = sale.totalPrice ?? 0;
    const taxAmount = settings.taxEnabled
      ? parseFloat(((subtotal * settings.taxRate) / 100).toFixed(2))
      : 0;
    const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

    // Atomic sequence increment within the transaction
    const updatedSettings = await tx.invoiceSettings.update({
      where: { id: settings.id },
      data: { nextSequence: { increment: 1 } },
      select: { nextSequence: true, invoicePrefix: true },
    });

    const orgCode = BRAND_ORG_CODE;
    const year = new Date().getFullYear();
    const seq = String(updatedSettings.nextSequence - 1).padStart(4, '0');
    const invoiceNumber = `${updatedSettings.invoicePrefix}-${year}-${orgCode}-${seq}`;

    const lineItems: any[] =
      (sale.saleItems || []).map((item: any) => ({
        description: item.product?.name || 'Product',
        quantity: item.quantity ?? 1,
        unitPrice: item.totalPrice / (item.quantity ?? 1),
        total: item.totalPrice,
        metadata: { saleItemId: item.id, productId: item.productId },
      }));

    return tx.invoice.create({
      data: {
        invoiceNumber,
        saleId,
        settingsId: settings.id,
        type: InvoiceType.MASTER,
        status: InvoiceStatus.SENT,
        subtotal,
        taxName: settings.taxName,
        taxRate: settings.taxEnabled ? settings.taxRate : 0,
        taxAmount,
        totalAmount,
                createdById,
        lineItems: { create: lineItems },
      },
      include: { lineItems: true },
    });
  }

  // ─── Create Sub-Invoice (Direct Sale only) ────────────────────────────────

  async createSubInvoice(dto: CreateSubInvoiceDto, createdById: string) {
    const settings = await this.validateInvoiceSettings();

    if (!settings.allowSubInvoices) {
      throw new BadRequestException(
        'Sub-invoices are disabled. Enable them in Settings → Invoicing.',
      );
    }

    const master = await this.prisma.invoice.findUnique({
      where: { id: dto.masterInvoiceId },
      include: { subInvoices: { where: { status: { not: InvoiceStatus.VOID } } } },
    });

    if (!master) throw new NotFoundException('Master invoice not found');
    if (master.type !== InvoiceType.MASTER)
      throw new BadRequestException('Can only create sub-invoices under a master invoice');
    if (master.status === InvoiceStatus.VOID)
      throw new BadRequestException('Cannot create sub-invoice under a voided master');

    // Guard: PAYG invoices never get sub-invoices
    const sale = await this.prisma.sales.findUnique({
      where: { id: master.saleId },
      select: { totalInstallmentDuration: true, formattedSaleId: true },
    });
    if ((sale?.totalInstallmentDuration ?? 0) > 0) {
      throw new BadRequestException('Sub-invoices are not allowed for PAYG sales.');
    }

    // Guard: sum of open sub-invoices + new amount must not exceed master balance
    const liveAmountPaid = await this.deriveInvoiceAmounts(master.id, null);
    const masterBalance = master.totalAmount - liveAmountPaid;
    const openSubTotal = master.subInvoices.reduce((s, si) => s + si.totalAmount, 0);
    const availableForSub = masterBalance - openSubTotal;

    if (dto.amount > availableForSub) {
      throw new BadRequestException(
        `Sub-invoice amount (${dto.amount}) exceeds available master balance (${availableForSub.toFixed(2)}).`,
      );
    }

    const subCount = master.subInvoices.length + 1;
    const subNumber = this.buildSubInvoiceNumber(master.invoiceNumber, subCount);

    const subtotal = dto.amount;
    const taxAmount = settings.taxEnabled
      ? parseFloat(((subtotal * settings.taxRate) / 100).toFixed(2))
      : 0;
    const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

    const subInvoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: subNumber,
        saleId: master.saleId,
        settingsId: settings.id,
        parentId: master.id,
        type: InvoiceType.SUB,
        status: InvoiceStatus.SENT,
        subtotal,
        taxName: settings.taxName,
        taxRate: settings.taxEnabled ? settings.taxRate : 0,
        taxAmount,
        totalAmount,
        dueDate: dto.dueDate
          ? new Date(dto.dueDate)
          : settings.defaultDueDays > 0
          ? new Date(Date.now() + settings.defaultDueDays * 86_400_000)
          : null,
        note: dto.note,
                createdById,
      },
    });

    await this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'Invoice',
      entityId: subInvoice.id,
      userId: createdById,
            metadata: {
        summary: `Sub-invoice ${subNumber} created under master ${master.invoiceNumber}`,
        masterInvoiceId: master.id,
        amount: totalAmount,
      },
    });

    // Fire-and-forget PDF
    this.generateAndAttachPdf(subInvoice.id).catch((err) =>
      this.logger.error(`Sub-invoice PDF failed for ${subInvoice.id}: ${err?.message}`),
    );

    return subInvoice;
  }

  // ─── Void Invoice ─────────────────────────────────────────────────────────

  async voidInvoice(invoiceId: string, dto: VoidInvoiceDto, userId: string) {

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subInvoices: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.VOID)
      throw new BadRequestException('Invoice is already voided');

    const liveAmountPaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
    if (liveAmountPaid > 0) {
      throw new BadRequestException(
        `Cannot void invoice ${invoice.invoiceNumber} — it has payments recorded against it (₦${liveAmountPaid.toFixed(2)}).`,
      );
    }

    // Cascade void to all sub-invoices
    const subIds = invoice.subInvoices.map((s) => s.id);
    await this.prisma.$transaction([
      ...(subIds.length
        ? [
            this.prisma.invoice.updateMany({
              where: { id: { in: subIds } },
              data: {
                status: InvoiceStatus.VOID,
                voidedAt: new Date(),
                voidedById: userId,
                voidReason: `Parent invoice voided: ${dto.reason}`,
              },
            }),
          ]
        : []),
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.VOID,
          voidedAt: new Date(),
          voidedById: userId,
          voidReason: dto.reason,
        },
      }),
    ]);

    await this.auditLogService.createLog({
      action: AuditActions.PATCH,
      entity: 'Invoice',
      entityId: invoiceId,
      userId,
            metadata: {
        summary: `Invoice ${invoice.invoiceNumber} voided${subIds.length ? ` (+ ${subIds.length} sub-invoices)` : ''}`,
        reason: dto.reason,
        cascadedSubInvoices: subIds.length,
      },
    });

    return { message: 'Invoice voided successfully', invoiceNumber: invoice.invoiceNumber };
  }

  // ─── List / Fetch ─────────────────────────────────────────────────────────

  /** Agents may only read invoices for sales they created; staff need Invoices or Sales read access. */
  async assertCanReadSaleInvoices(salesId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: true } },
        agentDetails: true,
      },
    });
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const roleName = user.role.role;
    if (roleName === 'admin' || roleName === 'super-admin') {
      return;
    }

    const permissionKeys = user.role.permissions.map(
      (p) => `${p.action}:${p.subject}`,
    );
    const hasManageAll = user.role.permissions.some(
      (p) => p.action === ActionEnum.manage && p.subject === SubjectEnum.all,
    );
    if (hasManageAll) {
      return;
    }

    const staffInvoiceRead = [
      `${ActionEnum.read}:${SubjectEnum.Invoices}`,
      `${ActionEnum.read}:${SubjectEnum.Sales}`,
      `${ActionEnum.write}:${SubjectEnum.Sales}`,
      `${ActionEnum.manage}:${SubjectEnum.Sales}`,
    ];
    if (staffInvoiceRead.some((key) => permissionKeys.includes(key))) {
      return;
    }

    if (user.agentDetails) {
      const sale = await this.prisma.sales.findUnique({
        where: { id: salesId },
        select: { creatorId: true },
      });
      if (!sale || sale.creatorId !== userId) {
        throw new ForbiddenException(
          'You can only view invoices for your own sales',
        );
      }
      return;
    }

    throw new ForbiddenException(
      'You do not have permission to view these invoices',
    );
  }

  async getInvoicesBySale(saleId: string, requestUserId?: string) {
    const salesId = await this.resolveSalesRecordId(saleId);
    if (requestUserId) {
      await this.assertCanReadSaleInvoices(salesId, requestUserId);
    }
    await this.syncSalePaymentsToMasterInvoice(salesId, undefined, {
      autoReceipt: false,
    }).catch(() => {});

    const invoices = await this.prisma.invoice.findMany({
      where: { saleId: salesId },
      include: {
        lineItems: true,
        subInvoices: true,
        payments: {
          where: { paymentStatus: PaymentStatus.COMPLETED },
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            paymentMethod: true,
            paymentStatus: true,
            createdAt: true,
            notes: true,
          },
        },
        receipts: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            paymentId: true,
            receiptNumber: true,
            pdfUrl: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      invoices.map(async (inv) => {
        const liveAmountPaid = await this.deriveInvoiceAmounts(inv.id, inv.parentId);
        const balance = Math.max(0, inv.totalAmount - liveAmountPaid);
        const derivedStatus = this.deriveStatus(inv, liveAmountPaid, balance);
        return {
          ...inv,
          liveAmountPaid,
          balance,
          derivedStatus,
          amountPaid: liveAmountPaid,
        };
      }),
    );
  }

  async listInvoices(query: {
    page?: number | string;
    limit?: number | string;
    status?: string;
    statusGroup?: string;
    type?: string;
    search?: string;
    hasReceipt?: string;
    customerName?: string;
    dateFrom?: string;
    dateTo?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
  }) {
    const page = Math.max(1, Math.floor(Number(query.page ?? 1)));
    const limit = Math.max(1, Math.floor(Number(query.limit ?? 20)));

    const where: Prisma.InvoiceWhereInput = {
      type: query.type
        ? (query.type as InvoiceType)
        : InvoiceType.MASTER,
      ...(query.status && { status: query.status }),
      ...(query.statusGroup === 'pending' && {
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
      }),
      ...(query.search && {
        OR: [
          { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          { receipts: { some: { receiptNumber: { contains: query.search, mode: 'insensitive' } } } },
        ],
      }),
      ...((query.hasReceipt === '1' || query.hasReceipt === 'true') && {
        receipts: { some: {} },
      }),
      ...(query.customerName && {
        sale: {
          customer: {
            OR: [
              { firstname: { contains: query.customerName, mode: 'insensitive' } },
              { lastname: { contains: query.customerName, mode: 'insensitive' } },
            ],
          },
        },
      }),
      ...((query.dateFrom || query.dateTo) && {
        createdAt: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo + 'T23:59:59.999Z') }),
        },
      }),
      ...((query.dueDateFrom || query.dueDateTo) && {
        dueDate: {
          ...(query.dueDateFrom && { gte: new Date(query.dueDateFrom) }),
          ...(query.dueDateTo && { lte: new Date(query.dueDateTo + 'T23:59:59.999Z') }),
        },
      }),
    };

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          lineItems: true,
          subInvoices: { select: { id: true, status: true, totalAmount: true } },
          receipts: {
            select: { receiptNumber: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          payments: {
            where: { paymentStatus: 'COMPLETED' },
            select: { paymentDate: true },
            orderBy: { paymentDate: 'desc' },
            take: 1,
          },
          sale: {
            select: {
              customer: { select: { firstname: true, lastname: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const enriched = await Promise.all(
      invoices.map(async (inv) => {
        const liveAmountPaid = await this.deriveInvoiceAmounts(inv.id, inv.parentId);
        const balance = Math.max(0, inv.totalAmount - liveAmountPaid);
        const derivedStatus = this.deriveStatus(inv, liveAmountPaid, balance);
        return {
          ...inv,
          amountPaid: liveAmountPaid,
          liveAmountPaid,
          balance,
          derivedStatus,
          status: derivedStatus,
          lastPaymentDate: inv.payments?.[0]?.paymentDate ?? null,
          receiptNumber: inv.receipts?.[0]?.receiptNumber ?? null,
          customerName: inv.sale?.customer
            ? `${inv.sale.customer.firstname ?? ''} ${inv.sale.customer.lastname ?? ''}`.trim()
            : null,
        };
      }),
    );

    return {
      invoices: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInvoiceStats(query?: { hasReceipt?: string }) {
    const hasReceiptOnly = query?.hasReceipt === '1' || query?.hasReceipt === 'true';
    const whereBase: Prisma.InvoiceWhereInput = {
      type: InvoiceType.MASTER,
      ...(hasReceiptOnly ? { receipts: { some: {} } } : {}),
    };

    const [total, paid, pending] = await Promise.all([
      this.prisma.invoice.count({ where: whereBase }),
      this.prisma.invoice.count({
        where: { ...whereBase, status: InvoiceStatus.PAID },
      }),
      this.prisma.invoice.count({
        where: {
          ...whereBase,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
        },
      }),
    ]);

    return { total, paid, pending };
  }

  // ─── Pay Invoice ──────────────────────────────────────────────────────────

  async payInvoice(
    invoiceId: string,
    dto: PayInvoiceDto,
    requestUserId: string,
  ) {

    // 1. Fetch invoice + linked sale
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        settings: true,
        subInvoices: { where: { status: { not: InvoiceStatus.VOID } } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.VOID)
      throw new BadRequestException('Cannot pay a voided invoice');

    // Guard: if this is a master invoice that has active sub-invoices,
    // payment must go through a sub-invoice — not the master directly.
    if (
      invoice.type === InvoiceType.MASTER &&
      invoice.subInvoices?.length > 0
    ) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber} has active sub-invoices. ` +
          'Payment must be made against a sub-invoice, not the master.',
      );
    }

    const sale = await this.prisma.sales.findUnique({
      where: { id: invoice.saleId },
      include: { customer: true },
    });
    if (!sale) throw new NotFoundException('Linked sale not found');

    // 2. Guard: amount must not exceed live balance
    const liveAmountPaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
    const balance = invoice.totalAmount - liveAmountPaid;
    if (dto.amount > Math.ceil(balance)) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds invoice balance (${balance.toFixed(2)})`,
      );
    }
    if (balance <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    // 3. Determine payment method
    const user = await this.prisma.user.findUnique({
      where: { id: requestUserId },
      select: { agentDetails: true },
    });
    const paymentMethod =
      dto.paymentMethod ||
      (user?.agentDetails ? PaymentMethod.WALLET : PaymentMethod.CASH);

    if (paymentMethod === PaymentMethod.WALLET && !user?.agentDetails) {
      throw new BadRequestException('Wallet payment is only supported for agent users.');
    }

    // 4. ONLINE — generate redirect payload, do not create payment record yet
    if (paymentMethod === PaymentMethod.ONLINE) {
      return this.paymentService.generatePaymentPayload(
        sale.id,
        dto.amount,
        sale.customer?.email || `${sale.customer?.phone}@gmail.com`,
        dto.paymentGateway || sale.paymentGateway || PaymentGateway.OGARANYA,
        PaymentMethod.ONLINE,
        invoiceId,           // webhook will attach completed payment to this invoice
      );
    }

    // 5. WALLET / CASH — atomic transaction with 3-attempt ref retry
    const payment = await this.prisma.$transaction(
      async (tx) => {
        // 5a. Wallet debit
        if (user?.agentDetails && paymentMethod === PaymentMethod.WALLET) {
          const agentId = user.agentDetails.id;
          const wallet = await tx.wallet.findUnique({ where: { agentId } });
          if (!wallet) throw new NotFoundException('Wallet not found');
          if (wallet.balance < dto.amount)
            throw new BadRequestException(
              `Insufficient wallet balance. Required: ₦${dto.amount}, Available: ₦${wallet.balance}`,
            );
          await tx.wallet.update({
            where: { agentId },
            data: { balance: wallet.balance - dto.amount },
          });
          await tx.walletTransaction.create({
            data: {
              agentId,
              walletId: wallet.id,
              type: WalletTransactionType.DEBIT,
              amount: dto.amount,
              previousBalance: wallet.balance,
              newBalance: wallet.balance - dto.amount,
              reference: `inv-${invoiceId}-${Date.now()}`,
              description: `Payment for invoice ${invoice.invoiceNumber}`,
              saleId: sale.id,
              status: WalletTransactionStatus.COMPLETED,
            },
          });
        }

        // 5b. Create payment record — 3-attempt P2002 retry on txRef collision
        let txRef = await this.referenceGenerator.generatePaymentReference();
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await tx.payment.create({
              data: {
                saleId: sale.id,
                invoiceId,
                amount: dto.amount,
                paymentMethod,
                transactionRef: txRef,
                paymentStatus: PaymentStatus.COMPLETED,
                recordedById: requestUserId,
                notes: dto.notes,
                paymentDate: new Date(),
                saleItemId: dto.saleItemId ?? null,
              },
            });
          } catch (err) {
            if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
              txRef = await this.referenceGenerator.generatePaymentReference();
              continue;
            }
            throw err;
          }
        }
        throw new BadRequestException(
          'Unable to persist payment after multiple reference retries.',
        );
      },
      { timeout: 20000, maxWait: 20000 },
    );

    // 6. Update invoice amountPaid cache (non-blocking best-effort)
    const newLivePaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
    const newBalance = invoice.totalAmount - newLivePaid;
    const newStatus = this.deriveStatus(invoice, newLivePaid, newBalance);
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: newLivePaid, status: newStatus },
    });

    // 7. Trigger sale post-payment side effects (token gen, device status, totalPaid agg)
    await this.paymentService.handlePostPayment(payment);

    await this.maybeAutoGenerateReceipt(invoiceId, payment.id, requestUserId);

    // 8. Audit log
    await this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'InvoicePayment',
      entityId: payment.id,
      userId: requestUserId,
            metadata: {
        summary: `Payment of ₦${dto.amount} recorded on invoice ${invoice.invoiceNumber}`,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        amount: dto.amount,
        paymentMethod,
        saleId: sale.id,
        newBalance,
        newStatus,
      },
    });

    return { payment, invoiceNumber: invoice.invoiceNumber, newBalance, newStatus };
  }


  // ─── PDF Generation ───────────────────────────────────────────────────────

  /**
   * Generate PDF for an invoice and upload to Cloudinary.
   * Updates invoice.pdfUrl. Called after invoice creation and on explicit regen.
   * Non-throwing by default (pass throwOnError=true for explicit regen endpoint).
   */
  async generateAndAttachPdf(invoiceId: string, throwOnError = false): Promise<string | null> {
    try {
      // Fetch full invoice data needed for the template
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          lineItems: true,
          subInvoices: true,
          settings: true,
          sale: {
            include: {
              customer: true,
              saleItems: { include: { product: true } },
            },
          },
        },
      });
      if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

      // Derive live amounts for PDF accuracy
      const liveAmountPaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
      const balance = invoice.totalAmount - liveAmountPaid;

      const tenant = this.getCompanyBranding(invoice.settings);

      const html = this.invoicePdfService.buildHtml(
        { ...invoice, liveAmountPaid, balance },
        invoice.settings,
        tenant,
      );

      const pdfBuffer = await this.invoicePdfService.generatePdf(html);
      const pdfUrl = await this.invoicePdfService.uploadPdfBuffer(pdfBuffer, invoice.invoiceNumber);

      // Update invoice with pdfUrl
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfUrl },
      });

      this.logger.log(`PDF generated for invoice ${invoice.invoiceNumber}: ${pdfUrl}`);
      return pdfUrl;
    } catch (err) {
      this.logger.error(`PDF generation failed for invoice ${invoiceId}: ${err?.message}`);
      if (throwOnError) throw err;
      return null;
    }
  }

  /**
   * Explicit regenerate endpoint — always throws on failure.
   */
  async regenerateInvoicePdf(invoiceId: string, userId: string): Promise<{ pdfUrl: string }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: {  invoiceNumber: true, status: true } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.VOID) throw new BadRequestException('Cannot generate PDF for a voided invoice');

    const pdfUrl = await this.generateAndAttachPdf(invoiceId, true);

    await this.auditLogService.createLog({
      action: AuditActions.PATCH,
      entity: 'Invoice',
      entityId: invoiceId,
      userId,
            metadata: { summary: `PDF regenerated for invoice ${invoice.invoiceNumber}`, pdfUrl },
    });

    return { pdfUrl };
  }

  // ─── Send Invoice to Customer Email ───────────────────────────────────────

  async sendInvoiceToCustomer(invoiceId: string, userId: string): Promise<{ message: string }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        settings: true,
        sale: {
          include: {
            customer: true,
            saleItems: { include: { product: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.saleId) {
      await this.assertCanReadSaleInvoices(invoice.saleId, userId);
    }

    const customer = invoice.sale?.customer;
    const customerEmail = customer?.email;
    if (!customerEmail) {
      throw new BadRequestException(
        'Customer does not have an email address on file — cannot send invoice.',
      );
    }

    const customerName =
      [customer.firstname, customer.lastname].filter(Boolean).join(' ').trim() || 'Valued Customer';

    // Build fresh PDF (always regenerate so amounts are live)
    const liveAmountPaid = await this.deriveInvoiceAmounts(invoiceId, invoice.parentId);
    const balance = invoice.totalAmount - liveAmountPaid;

    const tenant = this.getCompanyBranding(invoice.settings);

    const html = this.invoicePdfService.buildHtml(
      { ...invoice, liveAmountPaid, balance },
      invoice.settings,
      tenant,
    );

    const pdfBuffer = await this.invoicePdfService.generatePdf(html);
    const pdfUrl =
      invoice.pdfUrl ??
      (await this.invoicePdfService.uploadPdfBuffer(
        pdfBuffer,
        invoice.invoiceNumber,
      ));

    if (pdfUrl && !invoice.pdfUrl) {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfUrl },
      });
    }

    const tenantName = tenant?.name ?? 'Your Provider';
    const sym = (invoice.settings as any)?.currencySymbol ?? '₦';
    const installmentNote = this.buildPaygInstallmentNote(invoice.sale);

    this.logger.log(
      `User ${userId} sending invoice ${invoice.invoiceNumber} to ${customerEmail} (pdfUrl=${pdfUrl ? 'yes' : 'no'})`,
    );

    await this.emailService.sendMail({
      to: customerEmail,
      subject: `Invoice ${invoice.invoiceNumber} from ${tenantName}`,
      html: buildInvoiceCustomerEmailHtml({
        customerName,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
        amountPaid: liveAmountPaid,
        balance: Math.max(0, balance),
        dueDate: invoice.dueDate,
        pdfUrl,
        tenantName,
        currencySymbol: sym,
        installmentNote,
      }),
    });

    this.logger.log(
      `Invoice ${invoice.invoiceNumber} email accepted by SMTP for ${customerEmail}`,
    );

    this.auditLogService.createLog({
      action: AuditActions.POST,
      entity: 'Invoice',
      entityId: invoiceId,
      userId,
            metadata: {
        summary: `Invoice ${invoice.invoiceNumber} emailed to ${customerEmail}`,
        customerEmail,
      },
    }).catch(() => {});

    return { message: `Invoice sent to ${customerEmail}` };
  }

}