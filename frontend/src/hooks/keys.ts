import type { HistoryRange, PerformanceRange, TradeFilters } from "../services/types";

/** Central react-query keys, grouped so related caches can be invalidated together. */
export const keys = {
  me: ["me"] as const,
  wallet: {
    all: ["wallet"] as const,
    summary: ["wallet", "summary"] as const,
    holdings: ["wallet", "holdings"] as const,
    activity: (limit: number) => ["wallet", "activity", limit] as const,
    fundings: ["wallet", "fundings"] as const,
    ledger: (page: number, currency: string) => ["wallet", "ledger", page, currency] as const,
  },
  portfolio: {
    all: ["portfolio"] as const,
    performance: (range: PerformanceRange) => ["portfolio", "performance", range] as const,
    allocation: ["portfolio", "allocation"] as const,
  },
  market: {
    all: ["market"] as const,
    status: ["market", "status"] as const,
    currencies: ["market", "currencies"] as const,
    rates: (search: string, featured: boolean) => ["market", "rates", search, featured] as const,
    lookup: (from: string, to: string) => ["market", "lookup", from, to] as const,
    history: (pairId: number, range: HistoryRange, invert: boolean) =>
      ["market", "history", pairId, range, invert] as const,
  },
  trades: {
    all: ["trades"] as const,
    list: (f: TradeFilters) => ["trades", "list", f] as const,
    detail: (id: string) => ["trades", "detail", id] as const,
  },
  notifications: ["notifications"] as const,
  watchlist: ["watchlist"] as const,
};
