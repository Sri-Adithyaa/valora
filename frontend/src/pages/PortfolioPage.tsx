import { useState } from "react";
import { Link } from "react-router-dom";
import { ALLOCATION_COLORS, AllocationDonut } from "../components/charts/AllocationDonut";
import { PerformanceChart, PerformanceLegend } from "../components/charts/PerformanceChart";
import { HoldingsTable } from "../components/HoldingsTable";
import { ButtonLink } from "../components/ui/Button";
import { Card, CardHeader, CurrencyBadge, EmptyState, ErrorState, PageHeader, Segmented, StatCard, TableSkeleton, TrendPct } from "../components/ui/Display";
import { Icon } from "../components/ui/Icon";
import { usePairsForCurrency } from "../hooks/useMarket";
import { useAllocation, usePerformance, useSummary } from "../hooks/useWallet";
import { direction, formatMoney, formatPct } from "../lib/format";
import { tradeHref } from "../lib/trade";
import { errorMessage } from "../services/api";
import { PERFORMANCE_RANGES, type Currency, type Holding, type PerformanceRange } from "../services/types";

const tone = (v: string | null | undefined) => (direction(v) === "up" ? "up" : direction(v) === "down" ? "down" : "default");

export default function PortfolioPage() {
  const summary = useSummary();
  const allocation = useAllocation();
  const [range, setRange] = useState<PerformanceRange>("1M");
  const perf = usePerformance(range);
  const [selected, setSelected] = useState<string | undefined>();
  const s = summary.data;
  const selectedHolding = s?.holdings.find((h) => h.currency.currency_code === selected);

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Your currency portfolio"
        subtitle="Every currency you hold, valued in your base currency with weighted-average cost and P&L."
        actions={<ButtonLink to="/trade"><Icon name="swap-h" className="h-4 w-4" /> Trade</ButtonLink>}
      />

      {summary.isError ? (
        <Card><ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <StatCard label="Total value" loading={!s} value={s ? formatMoney(s.total_value, s.base_currency) : "—"} sub={s && `${s.currencies_held} currencies`} />
            <StatCard label="Cost basis" loading={!s} value={s ? formatMoney(s.total_cost_basis, s.base_currency) : "—"} sub="What open holdings cost you" />
            <StatCard label="Unrealized P&L" loading={!s} tone={tone(s?.unrealized_pnl)} value={s ? formatMoney(s.unrealized_pnl, s.base_currency, { signed: true }) : "—"} sub="Open positions" />
            <StatCard label="Realized P&L" loading={!s} tone={tone(s?.realized_pnl)} value={s ? formatMoney(s.realized_pnl, s.base_currency, { signed: true }) : "—"} sub="Closed / exchanged, after fees" />
            <StatCard
              label="Overall vs. funded"
              loading={!s}
              tone={tone(s?.overall_gain)}
              value={s ? formatMoney(s.overall_gain, s.base_currency, { signed: true }) : "—"}
              sub={s && <><TrendPct value={s.overall_gain_pct} showArrow={false} /> of {formatMoney(s.total_funded, s.base_currency)}</>}
            />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="overflow-hidden">
              <CardHeader title="Holdings" subtitle="Select a holding to explore the pairs you can trade it on." />
              {!s ? (
                <TableSkeleton rows={5} cols={7} />
              ) : s.holdings.length === 0 ? (
                <EmptyState icon="wallet" title="No holdings">Add demo funds from the dashboard to get started.</EmptyState>
              ) : (
                <HoldingsTable holdings={s.holdings} base={s.base_currency} variant="portfolio" selected={selected} onSelect={(c) => setSelected(c === selected ? undefined : c)} />
              )}
              {selectedHolding && s && <HoldingPairs holding={selectedHolding} base={s.base_currency} onClose={() => setSelected(undefined)} />}
            </Card>

            <Card>
              <CardHeader title="Asset allocation" subtitle={`Share of total value in ${s?.base_currency.currency_code ?? "base currency"}`} />
              <div className="px-5 pb-5">
                {allocation.isLoading ? (
                  <div className="skeleton mx-auto h-[220px] w-[220px] rounded-full" />
                ) : allocation.isError ? (
                  <ErrorState message={errorMessage(allocation.error)} onRetry={() => allocation.refetch()} />
                ) : allocation.data && allocation.data.slices.length > 0 ? (
                  <>
                    <AllocationDonut allocation={allocation.data} />
                    <ul className="mt-4 space-y-2">
                      {allocation.data.slices.map((sl, i) => (
                        <li key={sl.currency.currency_code}>
                          <button
                            type="button"
                            onClick={() => setSelected(sl.currency.currency_code)}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-ink-50"
                          >
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} aria-hidden />
                              <span className="font-semibold text-ink-800">{sl.currency.currency_code}</span>
                            </span>
                            <span className="num text-ink-600">
                              {formatMoney(sl.value, allocation.data.base_currency)} · <span className="font-semibold text-ink-900">{formatPct(sl.allocation_pct, { signed: false, decimals: 1 })}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <EmptyState icon="layers" title="Nothing to allocate yet" />
                )}
              </div>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Portfolio value over time"
              subtitle={<PerformanceLegend />}
              actions={<Segmented label="Performance range" options={PERFORMANCE_RANGES} value={range} onChange={setRange} />}
            />
            <div className="px-2 pb-4 sm:px-4">
              {perf.isLoading || !s ? (
                <div className="skeleton mx-3 h-[300px]" />
              ) : perf.isError ? (
                <ErrorState message={errorMessage(perf.error)} onRetry={() => perf.refetch()} />
              ) : perf.data && perf.data.points.length > 1 ? (
                <PerformanceChart points={perf.data.points} currency={s.base_currency} height={300} />
              ) : (
                <EmptyState icon="chart" title="Not enough history for this range yet" />
              )}
            </div>
          </Card>

          <Card className="mt-6 p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight"><Icon name="info" className="h-4 w-4 text-money-700" /> How P&amp;L is calculated</h2>
            <div className="mt-3 grid gap-4 text-sm text-ink-600 md:grid-cols-3">
              <p>
                <span className="font-semibold text-ink-900">Weighted-average cost.</span> Each holding carries an average acquisition cost in your base currency.
                Buying more blends the new cost into the average; selling doesn't change it.
              </p>
              <p>
                <span className="font-semibold text-ink-900">Realized P&amp;L</span> is booked when you sell or exchange a currency: what you received (valued in base) minus the
                average cost of what you gave up. Trading fees count as a realized cost.
              </p>
              <p>
                <span className="font-semibold text-ink-900">Unrealized P&amp;L</span> is the current value of what you still hold minus its cost.
                Exchange-rate moves stay unrealized until you sell — a currency rising 1% is a price change, not profit you've locked in.
              </p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function HoldingPairs({ holding, base, onClose }: { holding: Holding; base: Currency; onClose: () => void }) {
  const code = holding.currency.currency_code;
  const pairs = usePairsForCurrency(code);
  return (
    <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CurrencyBadge currency={holding.currency} showName />
          <p className="text-sm text-ink-600">
            You hold <span className="num font-semibold text-ink-900">{formatMoney(holding.quantity, holding.currency, { code: true })}</span> worth{" "}
            <span className="num font-semibold text-ink-900">{formatMoney(holding.current_value, base)}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs font-semibold text-ink-500 hover:text-ink-800">Close</button>
      </div>
      <p className="mt-3 label">Trade {code} on</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pairs.isLoading && Array.from({ length: 5 }).map((_, i) => <span key={i} className="skeleton h-8 w-24 rounded-full" />)}
        {pairs.isError && <span className="text-sm text-loss">{errorMessage(pairs.error)}</span>}
        {pairs.data?.map((p) => {
          const other = p.base.currency_code === code ? p.quote.currency_code : p.base.currency_code;
          return (
            <Link
              key={p.pair_id}
              to={tradeHref(code, other)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 text-[13px] font-bold text-ink-800 hover:border-money-500 hover:text-money-700"
            >
              {p.symbol} <Icon name="arrow-up-right" className="h-3.5 w-3.5" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
