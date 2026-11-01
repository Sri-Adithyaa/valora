import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { QuoteInput } from "../services/types";
import { keys } from "./keys";
import { useInvalidateMoney } from "./useWallet";

export function useQuoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuoteInput) => api.trade.quote(body),
    // A quote that fails (e.g. stale market) may create a notification server-side.
    onError: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useExecuteMutation() {
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ quoteId, idempotencyKey }: { quoteId: string; idempotencyKey: string }) =>
      api.trade.execute(quoteId, idempotencyKey),
    onSuccess: (res) => {
      qc.setQueryData(keys.wallet.holdings, res.holdings);
      return invalidate();
    },
    onError: () => invalidate(),
  });
}
