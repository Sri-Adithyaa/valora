import { isApiError } from "../services/api";
import type { Pair } from "../services/types";

/**
 * Pick a sensible FROM → TO direction when the user opens a pair (e.g. from the market list).
 * Prefer spending a currency the user actually holds; otherwise "buy the base with the quote"
 * (USD/INR → spend INR, receive USD), like buying a stock priced in its quote currency.
 */
export function directionForPair(pair: Pick<Pair, "base" | "quote">, held: Set<string>, currentFrom?: string): { from: string; to: string } {
  const b = pair.base.currency_code;
  const q = pair.quote.currency_code;
  const holdsB = held.has(b);
  const holdsQ = held.has(q);
  if (holdsB && !holdsQ) return { from: b, to: q };
  if (holdsQ && !holdsB) return { from: q, to: b };
  if (currentFrom === b) return { from: b, to: q };
  return { from: q, to: b };
}

export function tradeHref(from: string, to: string): string {
  return `/trade?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

/** Plain-language explanation of a trading error. */
export function tradeErrorMessage(e: unknown): { title: string; message: string } {
  if (!isApiError(e)) return { title: "Trade failed", message: "Something went wrong. Please try again." };
  switch (e.code) {
    case "quote_expired":
      return { title: "Quote expired", message: "The 30-second price window closed before you confirmed. Get a fresh quote to continue." };
    case "insufficient_balance":
      return { title: "Insufficient balance", message: e.message };
    case "quote_not_pending":
      return { title: "Quote no longer valid", message: "This quote has already been used or cancelled. Get a fresh quote." };
    case "market_data_unavailable":
      return { title: "Market data unavailable", message: `${e.message} Trading on this pair is paused until rates refresh.` };
    case "pair_not_available":
      return { title: "Pair not available", message: e.message };
    case "idempotency_key_reused":
      return { title: "Duplicate request", message: e.message };
    case "network_error":
      return { title: "Connection problem", message: e.message };
    default:
      return { title: "Trade failed", message: e.message };
  }
}
