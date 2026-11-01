import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { FundDemoInput, PerformanceRange, TradeFilters } from "../services/types";
import { keys } from "./keys";

const POLL = 60_000;

export function useSummary() {
  return useQuery({ queryKey: keys.wallet.summary, queryFn: api.wallet.summary, refetchInterval: POLL, staleTime: 20_000 });
}

export function useWallet() {
  return useQuery({ queryKey: ["wallet", "detail"], queryFn: api.wallet.get, staleTime: 30_000 });
}

export function useHoldings(enabled = true) {
  return useQuery({
    queryKey: keys.wallet.holdings,
    queryFn: api.wallet.holdings,
    enabled,
    refetchInterval: POLL,
    staleTime: 20_000,
  });
}

export function useActivity(limit = 12) {
  return useQuery({ queryKey: keys.wallet.activity(limit), queryFn: () => api.wallet.activity(limit), refetchInterval: POLL });
}

export function useFundings() {
  return useQuery({ queryKey: keys.wallet.fundings, queryFn: api.wallet.fundings });
}

export function useLedger(page: number, currency: string) {
  return useQuery({
    queryKey: keys.wallet.ledger(page, currency),
    queryFn: () => api.wallet.ledger({ page, page_size: 25, currency: currency || undefined }),
    placeholderData: keepPreviousData,
  });
}

export function usePerformance(range: PerformanceRange) {
  return useQuery({
    queryKey: keys.portfolio.performance(range),
    queryFn: () => api.portfolio.performance(range),
    refetchInterval: POLL,
    placeholderData: keepPreviousData,
  });
}

export function useAllocation() {
  return useQuery({ queryKey: keys.portfolio.allocation, queryFn: api.portfolio.allocation, refetchInterval: POLL });
}

export function useTradeHistory(filters: TradeFilters) {
  return useQuery({
    queryKey: keys.trades.list(filters),
    queryFn: () => api.trade.history(filters),
    placeholderData: keepPreviousData,
  });
}

export function useTrade(id: string | undefined) {
  return useQuery({
    queryKey: keys.trades.detail(id ?? ""),
    queryFn: () => api.trade.get(id as string),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Everything that changes when money moves. */
export function useInvalidateMoney() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.wallet.all }),
      qc.invalidateQueries({ queryKey: keys.portfolio.all }),
      qc.invalidateQueries({ queryKey: keys.trades.all }),
      qc.invalidateQueries({ queryKey: keys.notifications }),
      qc.invalidateQueries({ queryKey: keys.me }),
    ]);
}

export function useFundDemo() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: FundDemoInput) => api.wallet.fundDemo(body),
    onSuccess: () => invalidate(),
  });
}
