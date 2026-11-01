import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { HistoryRange } from "../services/types";
import { keys } from "./keys";

/** Rates refresh every ~2 minutes server-side; polling every 60 s is plenty. */
export const MARKET_POLL_MS = 60_000;

export function useMarketStatus() {
  return useQuery({
    queryKey: keys.market.status,
    queryFn: api.market.status,
    refetchInterval: MARKET_POLL_MS,
    staleTime: 30_000,
  });
}

export function useCurrencies() {
  return useQuery({
    queryKey: keys.market.currencies,
    queryFn: api.market.currencies,
    staleTime: 10 * 60_000,
  });
}

export function useRates(search = "", featured = false) {
  return useQuery({
    queryKey: keys.market.rates(search, featured),
    queryFn: () => api.market.rates({ search: search || undefined, featured: featured || undefined }),
    refetchInterval: MARKET_POLL_MS,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function usePairLookup(from: string, to: string) {
  return useQuery({
    queryKey: keys.market.lookup(from, to),
    queryFn: () => api.market.lookup(from, to),
    enabled: Boolean(from && to && from !== to),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useHistory(pairId: number | undefined, range: HistoryRange, invert: boolean) {
  return useQuery({
    queryKey: keys.market.history(pairId ?? 0, range, invert),
    queryFn: () => api.market.history(pairId as number, range, invert),
    enabled: typeof pairId === "number",
    refetchInterval: MARKET_POLL_MS,
    staleTime: 30_000,
  });
}

export function useWatchlist(enabled = true) {
  return useQuery({ queryKey: keys.watchlist, queryFn: api.watchlist.list, enabled, staleTime: 60_000 });
}

export function useToggleFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pairId, favourite }: { pairId: number; favourite: boolean }) =>
      favourite ? api.watchlist.add(pairId) : api.watchlist.remove(pairId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: ["market", "rates"] });
      qc.invalidateQueries({ queryKey: ["market", "lookup"] });
    },
  });
}

/** Every active pair that includes `currency` (portfolio quick links). */
export function usePairsForCurrency(currency: string | undefined) {
  return useQuery({
    queryKey: ["market", "pairs", "currency", currency ?? ""],
    queryFn: () => api.market.pairs({ currency }),
    enabled: Boolean(currency),
    staleTime: 5 * 60_000,
  });
}
