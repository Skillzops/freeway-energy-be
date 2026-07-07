import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import * as streamifier from 'streamifier';
import { v2 as cloudinary } from 'cloudinary';
/** PDFKit is CJS-only; default import breaks in compiled Nest output (pdfkit_1.default is not a constructor). */
function createPdfDocument(
  options?: PDFKit.PDFDocumentOptions,
): PDFKit.PDFDocument {
  const pdfkit = require('pdfkit') as typeof import('pdfkit');
  const PDFDocumentCtor =
    (pdfkit as { default?: typeof pdfkit }).default ?? pdfkit;
  return new PDFDocumentCtor(options);
}

@Injectable()
export class InvoicePdfService implements OnModuleInit {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(private readonly cloudinaryService: CloudinaryService) {}

  onModuleInit() {
    this.logger.log(
      'Invoice/receipt PDF engine: PDFKit (no Chromium/Puppeteer)',
    );
  }

  // ─── Upload PDF buffer to Cloudinary ─────────────────────────────────────

  async uploadPdfBuffer(buffer: Buffer, invoiceNumber: string): Promise<string> {
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');

    // ── Save a local copy to /tmp before uploading ────────────────────���─────
    // /tmp is the only writable directory on Vercel serverless (and most Lambda environments).
    const safeId = invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
    const tmpFile = path.join('/tmp', `${safeId}-${Date.now()}.pdf`);
    try {
      fs.writeFileSync(tmpFile, buffer);
      this.logger.log(`PDF saved locally: ${tmpFile}`);
    } catch (e) {
      this.logger.warn(`Could not write temp PDF (non-fatal): ${(e as Error).message}`);
    }

    // ── Upload to Cloudinary ────────────────────────────────────────────────
    // resource_type: 'image' → Cloudinary serves PDF with Content-Type: application/pdf
    // (no Content-Disposition: attachment) so it opens inline in the browser.
    // resource_type: 'raw' forces a download — do NOT use that.
    const publicId = `invoices/${safeId}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'image', public_id: publicId, format: 'pdf' },
        (err, result) => {
          // Clean up temp file after upload attempt regardless of outcome
          try { fs.unlinkSync(tmpFile); } catch {}
          if (err) return reject(err);
          resolve(result.secure_url);
        },
      );
      streamifier.createReadStream(buffer).pipe(stream);
    });
  }

  // ─── HTML Template ────────────────────────────────────────────────────────

  buildHtml(invoice: any, settings: any, tenant: any): string {
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2 }).format(n ?? 0);

    const sym = settings?.currencySymbol ?? '₦';

    const lineItemsHtml = (invoice.lineItems ?? [])
      .map(
        (li: any) => `
      <tr>
        <td>${li.description ?? ''}</td>
        <td class="center">${li.quantity ?? 1}</td>
        <td class="right">${sym}${fmt(li.unitPrice)}</td>
        <td class="right">${sym}${fmt(li.total)}</td>
      </tr>`,
      )
      .join('');

    // PAYG installment schedule
    const installmentsHtml =
      invoice.paymentMode === 'INSTALLMENT' && Array.isArray(invoice.installments)
        ? `
      <h3 class="section-title">Payment Schedule</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Due Date</th>
            <th class="right">Amount Due</th>
            <th class="right">Amount Paid</th>
            <th class="center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.installments
            .map(
              (inst: any, i: number) => `
          <tr>
            <td>${i + 1}</td>
            <td>${inst.dueDate ? new Date(inst.dueDate).toLocaleDateString('en-NG') : '—'}</td>
            <td class="right">${sym}${fmt(inst.amountDue)}</td>
            <td class="right">${sym}${fmt(inst.amountPaid ?? 0)}</td>
            <td class="center badge-${(inst.status ?? 'PENDING').toLowerCase()}">${inst.status ?? 'PENDING'}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
        : '';

    const taxRow =
      settings?.taxEnabled && invoice.taxAmount > 0
        ? `<tr><td class="label">${invoice.taxName ?? 'Tax'} (${invoice.taxRate ?? 0}%)</td><td class="right">${sym}${fmt(invoice.taxAmount)}</td></tr>`
        : '';

    const customer = invoice.sale?.customer;
    const customerName = customer
      ? `${customer.firstname ?? ''} ${customer.lastname ?? ''}`.trim()
      : 'N/A';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 2px solid #e2e8f0; padding-bottom: 24px; }
    .company h1 { font-size: 20px; font-weight: 700; color: #0f172a; }
    .company p { color: #64748b; margin-top: 2px; font-size: 11px; }
    .invoice-meta { text-align: right; }
    .invoice-meta h2 { font-size: 18px; font-weight: 700; color: #1d4ed8; }
    .invoice-meta p { color: #475569; margin-top: 2px; font-size: 11px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .badge-sent { background: #dbeafe; color: #1d4ed8; }
    .badge-paid { background: #d1fae5; color: #059669; }
    .badge-partially_paid { background: #fef3c7; color: #b45309; }
    .badge-overdue { background: #fee2e2; color: #dc2626; }
    .badge-void { background: #f1f5f9; color: #94a3b8; }
    .badge-pending { background: #f1f5f9; color: #475569; }

    .two-col { display: flex; gap: 40px; margin-bottom: 28px; }
    .col h3 { font-size: 10px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .col p { font-size: 12px; color: #334155; line-height: 1.6; }

    .section-title { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; margin: 24px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    thead th { background: #f8fafc; font-size: 11px; font-weight: 600; color: #64748b; padding: 8px 10px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    tbody td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 11px; color: #334155; }
    tbody tr:last-child td { border-bottom: none; }
    .right { text-align: right; }
    .center { text-align: center; }

    .summary { margin-left: auto; width: 280px; margin-top: 20px; }
    .summary table { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .summary td.label { color: #64748b; padding: 7px 12px; }
    .summary td.right { padding: 7px 12px; font-weight: 600; }
    .summary tr.total td { font-size: 13px; font-weight: 700; border-top: 2px solid #e2e8f0; }
    .summary tr.balance td { color: #dc2626; font-size: 13px; font-weight: 700; }
    .summary tr.balance-paid td { color: #059669; font-size: 13px; font-weight: 700; }

    .bank { margin-top: 32px; padding: 16px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
    .bank h3 { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 8px; }
    .bank p { font-size: 12px; color: #334155; line-height: 1.8; }

    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="company">
      ${tenant?.logo ? `<img src="${tenant.logo}" height="40" style="margin-bottom:8px" />` : ''}
      <h1>${tenant?.name ?? 'Company'}</h1>
      <p>${tenant?.address ?? ''}</p>
      ${settings?.taxNumber ? `<p>Tax No: ${settings.taxNumber}</p>` : ''}
    </div>
    <div class="invoice-meta">
      <h2>INVOICE</h2>
      <p><strong>${invoice.invoiceNumber}</strong></p>
      <p>Issue date: ${new Date(invoice.createdAt ?? Date.now()).toLocaleDateString('en-NG')}</p>
      ${invoice.dueDate ? `<p>Due date: ${new Date(invoice.dueDate).toLocaleDateString('en-NG')}</p>` : ''}
      <p style="margin-top:6px"><span class="badge badge-${(invoice.derivedStatus ?? invoice.status ?? 'sent').toLowerCase()}">${(invoice.derivedStatus ?? invoice.status ?? 'SENT').replace(/_/g,' ')}</span></p>
    </div>
  </div>

  <!-- Bill To + Sale Info -->
  <div class="two-col">
    <div class="col">
      <h3>Bill To</h3>
      <p><strong>${customerName}</strong></p>
      ${customer?.phone ? `<p>${customer.phone}</p>` : ''}
      ${customer?.email ? `<p>${customer.email}</p>` : ''}
      ${customer?.address ? `<p>${customer.address}</p>` : ''}
    </div>
    <div class="col">
      <h3>Sale Reference</h3>
      <p>${invoice.sale?.formattedSaleId ?? invoice.saleId ?? '—'}</p>
      ${invoice.type === 'SUB' ? `<p style="color:#64748b;font-size:11px">Sub-invoice of ${invoice.parent?.invoiceNumber ?? ''}</p>` : ''}
    </div>
  </div>

  <!-- Line Items -->
  <h3 class="section-title">Line Items</h3>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="center">Qty</th>
        <th class="right">Unit Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${lineItemsHtml}</tbody>
  </table>

  <!-- PAYG Installment Schedule -->
  ${installmentsHtml}

  <!-- Summary -->
  <div class="summary">
    <table>
      <tbody>
        <tr><td class="label">Subtotal</td><td class="right">${sym}${fmt(invoice.subtotal)}</td></tr>
        ${taxRow}
        <tr class="total"><td class="label">Total</td><td class="right">${sym}${fmt(invoice.totalAmount)}</td></tr>
        <tr><td class="label">Amount Paid</td><td class="right">${sym}${fmt(invoice.liveAmountPaid ?? invoice.amountPaid ?? 0)}</td></tr>
        <tr class="${(invoice.liveAmountPaid ?? invoice.amountPaid ?? 0) >= invoice.totalAmount ? 'balance-paid' : 'balance'}">
          <td class="label">Balance Due</td>
          <td class="right">${sym}${fmt(Math.max(0, invoice.totalAmount - (invoice.liveAmountPaid ?? invoice.amountPaid ?? 0)))}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Bank / Payment Instructions -->
  ${settings?.bankName ? `
  <div class="bank">
    <h3>Payment Instructions</h3>
    <p>
      <strong>Bank:</strong> ${settings.bankName}<br/>
      <strong>Account Name:</strong> ${settings.accountName ?? ''}<br/>
      <strong>Account Number:</strong> ${settings.accountNumber ?? ''}
      ${settings.bankCode ? `<br/><strong>Sort Code:</strong> ${settings.bankCode}` : ''}
    </p>
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    ${settings?.paymentTerms ? `<p>${settings.paymentTerms}</p>` : ''}
    ${settings?.footerNote ? `<p style="margin-top:4px">${settings.footerNote}</p>` : ''}
    <p style="margin-top:8px;color:#cbd5e1">Generated ${new Date().toLocaleString('en-NG')}</p>
  </div>

</body>
</html>`;
  }



  buildReceiptHtml(
    invoice: any,
    payment: any,
    settings: any,
    tenant: any,
    receiptNumber: string,
    note?: string,
  ): string {
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2 }).format(n ?? 0);
    const sym = settings?.currencySymbol ?? '₦';
    const customer = invoice?.sale?.customer;
    const customerName = customer
      ? `${customer.firstname ?? ''} ${customer.lastname ?? ''}`.trim()
      : 'N/A';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; padding: 32px; }
    .header { display:flex; justify-content:space-between; border-bottom:1px solid #e5e7eb; padding-bottom:12px; margin-bottom:20px; }
    .title { color:#059669; font-size:22px; font-weight:700; }
    .meta p { margin: 2px 0; font-size: 12px; color:#4b5563; }
    table { width:100%; border-collapse: collapse; margin-top:16px; }
    th, td { border:1px solid #e5e7eb; padding:8px 10px; font-size:12px; }
    th { background:#f9fafb; text-align:left; color:#6b7280; }
    .right { text-align:right; }
    .foot { margin-top:24px; font-size:11px; color:#6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${tenant?.logo ? `<img src="${tenant.logo}" height="36" style="margin-bottom:8px" />` : ''}
      <div style="font-size:16px;font-weight:700">${tenant?.name ?? 'Company'}</div>
      <div style="font-size:12px;color:#6b7280">${tenant?.address ?? ''}</div>
    </div>
    <div class="meta" style="text-align:right">
      <div class="title">PAYMENT RECEIPT</div>
      <p><strong>${receiptNumber}</strong></p>
      <p>Date: ${new Date(payment?.paymentDate ?? Date.now()).toLocaleDateString('en-NG')}</p>
    </div>
  </div>

  <table>
    <tbody>
      <tr><th>Receipt No.</th><td>${receiptNumber}</td></tr>
      <tr><th>Invoice No.</th><td>${invoice?.invoiceNumber ?? '—'}</td></tr>
      <tr><th>Transaction Ref</th><td>${payment?.transactionRef ?? '—'}</td></tr>
      <tr><th>Customer</th><td>${customerName}</td></tr>
      <tr><th>Payment Method</th><td>${payment?.paymentMethod ?? '—'}</td></tr>
      <tr><th>Amount Paid</th><td class="right">${sym}${fmt(payment?.amount ?? 0)}</td></tr>
      <tr><th>Invoice Total</th><td class="right">${sym}${fmt(invoice?.totalAmount ?? 0)}</td></tr>
      <tr><th>Invoice Balance After Payment</th><td class="right">${sym}${fmt(Math.max(0, (invoice?.totalAmount ?? 0) - (invoice?.liveAmountPaid ?? 0)))}</td></tr>
      ${note ? `<tr><th>Note</th><td>${note}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="foot">
    <p>${settings?.footerNote ?? ''}</p>
    <p>Generated ${new Date().toLocaleString('en-NG')}</p>
  </div>
</body>
</html>`;
  }

  /** Strip HTML to plain text for PDFKit (no headless Chrome required). */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ─── Generate PDF (PDFKit — works on DigitalOcean without Chromium libs) ───

  async generatePdf(html: string): Promise<Buffer> {
    const text = this.htmlToPlainText(html);

    return new Promise((resolve, reject) => {
      const doc = createPdfDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(10).text(text || 'Document', {
        align: 'left',
        lineGap: 4,
      });
      doc.end();
    });
  }
}
