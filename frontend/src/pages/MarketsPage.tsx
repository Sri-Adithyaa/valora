import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FavouriteStar } from "../components/trade/MarketList";
import { Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton, TrendPct } from "../components/ui/Display";
import { Icon } from "../components/ui/Icon";
import { useCurrencies, useMarketStatus, useRates } from "../hooks/useMarket";
import { useDebounced } from "../hooks/useDebounced";
import { useNow } from "../hooks/useNow";
import { useHoldings } from "../hooks/useWallet";
import { direction, formatDateTime, formatRate, relativeTime } from "../lib/format";
import { directionForPair, tradeHref } from "../lib/trade";
import { errorMessage } from "../services/api";
import type { Rate } from "../services/types";

type Filter = "all" | "featured" | "fav";

const FRESH_TONE = { LIVE: "green", DELAYED: "amber", STALE: "red", UNAVAILABLE: "red" } as const;

function SignedRate({ v }: { v: string | null }) {
  if (v === null) return <span className="text-ink-400">—</span>;
  const d = direction(v);
  return (
    <span className={`num ${d === "up" ? "text-gain" : d === "down" ? "text-loss" : "text-ink-500"}`}>
      {d === "up" ? "+" : ""}
      {formatRate(v)}
    </span>
  );
}

export default function MarketsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [currency, setCurrency] = useState("");
  const debounced = useDebounced(search.trim(), 250);
  const rates = useRates(debounced, false);
  const { data: currencies } = useCurrencies();
  const { data: holdings } = useHoldings();
  const { data: status } = useMarketStatus();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const held = useMemo(() => new Set((holdings ?? []).map((h) => h.currency.currency_code)), [holdings]);

  const rows = useMemo(
    () =>
      (rates.data ?? []).filter((r) => {
        if (filter === "featured" && !r.is_featured) return false;
        if (filter === "fav" && !r.is_favourite) return false;
        if (currency && r.base.currency_code !== currency && r.quote.currency_code !== currency) return false;
        return true;
      }),
    [rates.data, filter, currency],
  );

  const open = (r: Rate) => {
    const d = directionForPair(r, held);
    navigate(tradeHref(d.from, d.to));
  };

  const chip = (value: Filter, label: ReactNode) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors ${filter === value ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Markets"
        title="Currency pairs"
        subtitle={
          <>
            Orientation is always <span className="font-semibold text-ink-700">1 BASE = rate QUOTE</span> — e.g. USD/INR 94.92 means 1 US dollar buys 94.92 rupees.
            Rates are stored snapshots refreshed about every {status ? Math.round(status.update_interval_seconds / 60) : 2} minutes.
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <label htmlFor="markets-search" className="sr-only">Search by currency code, name or country</label>
            <input
              id="markets-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, currency or country (e.g. Euro, Japan)"
              className="input pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            {chip("all", "All")}
            {chip("featured", "Featured")}
            {chip("fav", <><Icon name="star" className="h-3.5 w-3.5" /> Favourites</>)}
            <label htmlFor="currency-filter" className="sr-only">Filter by currency</label>
            <select
              id="currency-filter"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`h-8 rounded-full border px-3 text-[13px] font-semibold ${currency ? "border-money-600 bg-money-50 text-money-800" : "border-ink-200 bg-white text-ink-700"}`}
            >
              <option value="">Any currency</option>
              {currencies?.map((c) => (
                <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name}</option>
              ))}
            </select>
          </div>
        </div>

        {rates.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : rates.isError ? (
          <ErrorState message={errorMessage(rates.error)} onRetry={() => rates.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title="No pairs found">
            {filter === "fav" ? "You haven't starred any pairs yet." : "Try a currency code (USD), a name (Euro) or a country (Japan)."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <caption className="sr-only">Currency pairs with latest rates</caption>
              <thead>
                <tr className="bg-ink-50/70">
                  <th scope="col" className="table-head w-10 py-2.5 pl-3"><span className="sr-only">Favourite</span></th>
                  <th scope="col" className="table-head py-2.5">Pair</th>
                  <th scope="col" className="table-head py-2.5 text-right">Latest rate</th>
                  <th scope="col" className="table-head py-2.5 text-right">24h ago</th>
                  <th scope="col" className="table-head py-2.5 text-right">Change</th>
                  <th scope="col" className="table-head py-2.5 text-right">% change</th>
                  <th scope="col" className="table-head py-2.5 text-right">Last updated</th>
                  <th scope="col" className="table-head py-2.5 pr-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr
                    key={r.pair_id}
                    onClick={() => open(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open(r);
                      }
                    }}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-ink-50/70 focus-visible:bg-money-50/60"
                    aria-label={`Trade ${r.symbol}`}
                  >
                    <td className="py-3 pl-3"><FavouriteStar rate={r} /></td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900">{r.symbol}</span>
                        {r.is_featured && <Pill tone="neutral">Featured</Pill>}
                      </div>
                      <p className="text-xs text-ink-500">{r.base.currency_name} → {r.quote.currency_name}</p>
                    </td>
                    <td className="num py-3 text-right font-semibold text-ink-900">{formatRate(r.rate)}</td>
                    <td className="num py-3 text-right text-ink-500">{formatRate(r.previous_rate)}</td>
                    <td className="py-3 text-right"><SignedRate v={r.change} /></td>
                    <td className="py-3 text-right"><TrendPct value={r.change_pct} /></td>
                    <td className="py-3 text-right text-xs text-ink-500" title={formatDateTime(r.recorded_at, true)}>
                      {relativeTime(r.recorded_at, new Date(now))}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <Pill tone={FRESH_TONE[r.freshness as keyof typeof FRESH_TONE] ?? "neutral"}>{r.freshness}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
          {rows.length} pair{rows.length === 1 ? "" : "s"} · Green and red show market movement only — not your profit or loss. Click a pair to trade it.
        </p>
      </Card>
    </>
  );
}
