import { useState } from "react";
import { useHistory } from "../../hooks/useMarket";
import { useNow } from "../../hooks/useNow";
import { formatRate, relativeTime } from "../../lib/format";
import { errorMessage } from "../../services/api";
import { HISTORY_RANGES, type Currency, type HistoryRange, type Pair, type Rate } from "../../services/types";
import { PriceChart, type ChartMode } from "../charts/PriceChart";
import { Segmented, TrendPct } from "../ui/Display";
import { Icon } from "../ui/Icon";

const FRESHNESS_TONE: Record<string, string> = {
  LIVE: "bg-money-500/15 text-money-300",
  DELAYED: "bg-warn/20 text-[#f0c36d]",
  STALE: "bg-loss/20 text-[#f19a93]",
  UNAVAILABLE: "bg-loss/20 text-[#f19a93]",
};

/**
 * Centre column: FROM/TO heading, current rate in the FROM→TO orientation, pair movement, and the chart.
 * If FROM is the pair's quote currency the history is requested with invert=true (server-side inversion).
 */
export function PairChartPanel({
  from,
  to,
  pair,
  rate,
  pairLoading,
  pairError,
}: {
  from: Currency | undefined;
  to: Currency | undefined;
  pair: Pair | undefined;
  rate: Rate | undefined;
  pairLoading: boolean;
  pairError: unknown;
}) {
  const [range, setRange] = useState<HistoryRange>("1D");
  const [mode, setMode] = useState<ChartMode>("line");
  const invert = Boolean(pair && from && pair.quote.currency_code === from.currency_code);
  const history = useHistory(pair?.pair_id, range, invert);
  const now = useNow(30_000);
  const points = history.data?.points;
  const last = points && points.length ? points[points.length - 1] : undefined;
  const fromCode = from?.currency_code ?? "—";
  const toCode = to?.currency_code ?? "—";

  return (
    <section aria-label={`${fromCode}/${toCode} chart`} className="overflow-hidden rounded-xl bg-ink-900 text-white shadow-pop">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              {fromCode}<span className="mx-1 text-ink-500">/</span>{toCode}
            </h1>
            {rate && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${FRESHNESS_TONE[rate.freshness] ?? "bg-white/10 text-ink-300"}`}>{rate.freshness}</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {from?.currency_name ?? ""} → {to?.currency_name ?? ""}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-2xl font-semibold tracking-tight sm:text-[28px]" aria-live="polite">
            {last ? formatRate(last.close) : history.isLoading || pairLoading ? <span className="inline-block h-7 w-28 animate-pulse rounded bg-white/10 align-middle" /> : "—"}
          </p>
          <p className="text-xs text-ink-400">
            1 {fromCode} in {toCode}
            {rate?.recorded_at && <> · updated {relativeTime(rate.recorded_at, new Date(now))}</>}
          </p>
        </div>
      </div>

      {pair && rate && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-4 text-xs sm:px-5">
          <span className="text-ink-400">
            24h · {rate.symbol} <TrendPct value={rate.change_pct} className="ml-1 font-semibold" />
          </span>
          <span className="text-ink-400">
            1 {rate.base.currency_code} = <span className="num text-ink-200">{formatRate(rate.rate)}</span> {rate.quote.currency_code}
          </span>
          {invert && <span className="text-ink-500">Chart shows {fromCode}/{toCode} (inverse of {rate.symbol})</span>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-white/5 px-3 py-2 sm:px-4">
        <Segmented label="Time range" options={HISTORY_RANGES} value={range} onChange={setRange} dark />
        <Segmented
          label="Chart type"
          dark
          value={mode}
          onChange={setMode}
          options={[
            { value: "line", label: <><Icon name="line" className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Line</span></> },
            { value: "candle", label: <><Icon name="candle" className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Candles</span></> },
          ]}
        />
      </div>

      <div className="relative">
        {pairError ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 px-6 text-center sm:h-[380px]">
            <Icon name="alert" className="h-6 w-6 text-warn" />
            <p className="text-sm text-ink-300">{errorMessage(pairError)}</p>
            <p className="text-xs text-ink-500">Choose a different currency pair.</p>
          </div>
        ) : history.isError ? (
          <div className="flex h-[300px] items-center justify-center px-6 text-center text-sm text-ink-300 sm:h-[380px]">
            Chart data is unavailable right now: {errorMessage(history.error)}
          </div>
        ) : (
          <div className="h-[300px] sm:h-[380px]">
            <PriceChart points={points} mode={mode} loading={pairLoading || history.isLoading} dark />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px] text-ink-500 sm:px-5">
        {history.data?.includes_simulated ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2 py-0.5 font-semibold text-[#f0c36d]">
            <Icon name="info" className="h-3.5 w-3.5" /> Includes simulated demonstration history
          </span>
        ) : (
          <span>Source: stored market snapshots{rate?.provider ? ` (${rate.provider})` : ""}</span>
        )}
        <span>Snapshots every ~2 min · not real-time ticks</span>
      </div>
    </section>
  );
}
