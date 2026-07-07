export type InvoiceEmailBranding = {
  name?: string;
  currencySymbol?: string;
};

export type InvoiceCustomerEmailParams = {
  customerName: string;
  invoiceNumber: string;
  totalAmount: number;
  amountPaid: number;
  balance: number;
  dueDate?: Date | string | null;
  pdfUrl?: string | null;
  tenantName: string;
  currencySymbol?: string;
  installmentNote?: string | null;
};

export type ReceiptCustomerEmailParams = {
  customerName: string;
  invoiceNumber: string;
  receiptNumber: string;
  amountPaid: number;
  paymentDate?: Date | string | null;
  pdfUrl?: string | null;
  tenantName: string;
  currencySymbol?: string;
};

const fmtNgn = (n: number, sym: string) =>
  `${sym}${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2 }).format(n ?? 0)}`;

const formatDueDate = (dueDate?: Date | string | null) => {
  if (!dueDate) return '';
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatPaymentDate = (paymentDate?: Date | string | null) => {
  if (!paymentDate) return new Date().toLocaleDateString('en-NG');
  const d = paymentDate instanceof Date ? paymentDate : new Date(paymentDate);
  return Number.isNaN(d.getTime())
    ? new Date().toLocaleDateString('en-NG')
    : d.toLocaleDateString('en-NG');
};

/** HTML body for POST /invoices/:id/send — requires customer.email on the sale. */
export function buildInvoiceCustomerEmailHtml(
  params: InvoiceCustomerEmailParams,
): string {
  const sym = params.currencySymbol ?? '₦';
  const balance = Math.max(0, params.balance);
  const dueRow = params.dueDate
    ? `<tr><td style="padding:6px 0;color:#64748b">Due Date</td><td style="font-weight:600">${formatDueDate(params.dueDate)}</td></tr>`
    : '';
  const installmentRow = params.installmentNote
    ? `<tr><td style="padding:6px 0;color:#64748b">Installment</td><td style="font-weight:600">${params.installmentNote}</td></tr>`
    : '';
  const pdfBlock = params.pdfUrl
    ? `<p><a href="${params.pdfUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Download Invoice PDF</a></p>`
    : '<p style="color:#64748b;font-size:13px">Your invoice PDF will be available shortly.</p>';

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <h2 style="color:#1d4ed8">Invoice ${params.invoiceNumber}</h2>
      <p>Dear ${params.customerName},</p>
      <p>Your invoice from <strong>${params.tenantName}</strong> is ready. Summary below; use the link to download the PDF.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#64748b">Invoice Number</td><td style="font-weight:600">${params.invoiceNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Total Amount</td><td style="font-weight:600">${fmtNgn(params.totalAmount, sym)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Amount Paid</td><td style="font-weight:600;color:#059669">${fmtNgn(params.amountPaid, sym)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Balance Due</td><td style="font-weight:700;color:${balance > 0 ? '#dc2626' : '#059669'}">${fmtNgn(balance, sym)}</td></tr>
        ${dueRow}
        ${installmentRow}
      </table>
      ${pdfBlock}
      <p style="color:#64748b;font-size:13px">Please contact us if you have any questions.</p>
      <p style="margin-top:24px">Regards,<br/><strong>${params.tenantName}</strong></p>
    </div>
  `;
}

/** HTML body for POST /invoices/:id/receipt/send — requires customer.email and an existing receipt. */
export function buildReceiptCustomerEmailHtml(
  params: ReceiptCustomerEmailParams,
): string {
  const sym = params.currencySymbol ?? '₦';
  const pdfBlock = params.pdfUrl
    ? `<p><a href="${params.pdfUrl}" style="display:inline-block;padding:10px 18px;background:#059669;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Download Receipt PDF</a></p>`
    : '<p style="color:#64748b;font-size:13px">Your receipt PDF will be available shortly.</p>';

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <h2 style="color:#059669">Payment Receipt ${params.receiptNumber}</h2>
      <p>Dear ${params.customerName},</p>
      <p>Thank you — we have received your payment. Your receipt for invoice <strong>${params.invoiceNumber}</strong> is below.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#64748b">Invoice Number</td><td style="font-weight:600">${params.invoiceNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Receipt Number</td><td style="font-weight:600">${params.receiptNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Amount Paid</td><td style="font-weight:600">${fmtNgn(params.amountPaid, sym)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Payment Date</td><td style="font-weight:600">${formatPaymentDate(params.paymentDate)}</td></tr>
      </table>
      ${pdfBlock}
      <p style="margin-top:24px">Regards,<br/><strong>${params.tenantName}</strong></p>
    </div>
  `;
}
