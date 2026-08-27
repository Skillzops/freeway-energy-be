export interface AgentDetailsLike {
  id: string;
  category?: string | null;
  [key: string]: unknown;
}

/**
 * Picks the single correct Agent profile out of a user's `agentDetails`
 * array (a user can hold more than one Agent row - one per category, e.g.
 * a Sales profile and an Installer profile - see the userId/category
 * migration on the Agent model).
 *
 * Never falls back to "whichever Prisma returned first" when the pick is
 * ambiguous - on sibling codebases that silently picked a user's INSTALLER
 * agent for a sales wallet payment (wrong wallet, `wallet.findUnique` came
 * back null) because it happened to sort before their SALES agent.
 *
 * Resolution order:
 * 1. `agentId` - match a known, specific target id exactly (e.g. a sale's
 *    own `agentId`, or the agent a customer/device is already attributed
 *    to). Use this whenever the caller already knows which agent instance
 *    is authoritative for the record being acted on.
 * 2. `agentCategory` - match the profile the caller is authenticated as,
 *    resolved from the JWT. Use this when there is no record-level target
 *    and the "right" agent is simply whichever one the requester is
 *    currently acting as.
 * 3. If neither is given/matches and there is exactly one candidate, use
 *    it - the unambiguous single-agent case every existing caller relied
 *    on before the to-many migration.
 * 4. Otherwise return `undefined`. Callers must treat "no agent resolved"
 *    as a real, expected outcome (e.g. fall back to a CASH payment method
 *    rather than guessing a wallet) - never re-introduce a `[0]` fallback
 *    at the call site to paper over this.
 */
export function pickAgentDetails<T extends AgentDetailsLike>(
  agentDetails: T[] | null | undefined,
  options: { agentId?: string | null; agentCategory?: string | null } = {},
): T | undefined {
  const candidates = agentDetails ?? [];
  if (candidates.length === 0) return undefined;

  if (options.agentId) {
    const byId = candidates.find((a) => a.id === options.agentId);
    if (byId) return byId;
  }

  if (options.agentCategory) {
    const byCategory = candidates.find(
      (a) => a.category === options.agentCategory,
    );
    if (byCategory) return byCategory;
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}
