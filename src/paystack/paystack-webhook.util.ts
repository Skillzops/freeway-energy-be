/** Normalizes Paystack webhook payloads for DVA (dedicated NUBAN) transfers. */
export function normalizePaystackDvaWebhookPayload(payload: unknown) {
  const root = payload as Record<string, unknown> | null | undefined;
  const data = (root?.data ?? {}) as Record<string, unknown>;
  const authorization = (data.authorization ?? {}) as Record<string, unknown>;

  const amountKobo = Number(data.amount);
  const amount =
    Number.isFinite(amountKobo) && amountKobo > 0 ? amountKobo / 100 : undefined;

  return {
    event: typeof root?.event === 'string' ? root.event : undefined,
    channel: typeof data.channel === 'string' ? data.channel : undefined,
    reference:
      typeof data.reference === 'string' ? data.reference : undefined,
    transactionId:
      data.id != null ? String(data.id) : undefined,
    accountNumber:
      typeof authorization.receiver_bank_account_number === 'string'
        ? authorization.receiver_bank_account_number
        : typeof data.credit_account_number === 'string'
          ? data.credit_account_number
          : undefined,
    amount,
    status: typeof data.status === 'string' ? data.status : undefined,
  };
}

export function isPaystackDvaChargePayload(payload: unknown): boolean {
  const normalized = normalizePaystackDvaWebhookPayload(payload);
  return (
    normalized.event === 'charge.success' &&
    normalized.channel === 'dedicated_nuban'
  );
}
