import { useState } from "react";
import { Link } from "react-router-dom";
import { ActivityFeed } from "../components/ActivityFeed";
import { PerformanceChart, PerformanceLegend } from "../components/charts/PerformanceChart";
import { FundDemoModal } from "../components/FundDemoModal";
import { HoldingsTable } from "../components/HoldingsTable";
import { Button, ButtonLink } from "../components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Segmented, StatCard, TableSkeleton, TrendPct } from "../components/ui/Display";
import { Icon } from "../components/ui/Icon";
import { WalletCard } from "../components/WalletCard";
import { useMe } from "../hooks/useAuth";
import { useNow } from "../hooks/useNow";
import { useActivity, usePerformance, useSummary } from "../hooks/useWallet";
import { direction, formatDateTime, formatMoney, relativeTime } from "../lib/format";
import { errorMessage } from "../services/api";
import type { PerformanceRange } from "../services/types";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const tone = (v: string | null | undefined) => (direction(v) === "up" ? "up" : direction(v) === "down" ? "down" : "default");

export default function DashboardPage() {
  const { data: me } = useMe();
  const summary = useSummary();
  const activity = useActivity(12);
  const [range, setRange] = useState<PerformanceRange>("1M");
  const perf = usePerformance(range);
  const [fundOpen, setFundOpen] = useState(false);
  const now = useNow(30_000);
  const s = summary.data;
  const base = s?.base_currency ?? me?.wallet?.base_currency;
  const loading = summary.isLoading;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title={`${greeting()}, ${me?.user.full_name.split(" ")[0] ?? ""}`}
        subtitle="Your multi-currency wallet at a glance. All values in your base currency."
        actions={
          <>
            <Button variant="secondary" onClick={() => setFundOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> Add demo funds
            </Button>
            <ButtonLink to="/trade">
              <Icon name="swap-h" className="h-4 w-4" /> Trade
            </ButtonLink>
          </>
        }
      />

      {summary.isError ? (
        <Card><ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /></Card>
      ) : (
        <>
          {/* overview */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <div className="col-span-2 lg:col-span-1 lg:row-span-2">
              <div className="card flex h-full flex-col justify-between gap-4 bg-ink-900 p-5 text-white">
                <div>
                  <p className="label !text-ink-400">Total portfolio value</p>
                  {loading || !s ? (
                    <div className="mt-2 h-9 w-44 animate-pulse rounded bg-white/10" />
                  ) : (
                    <p className="num mt-2 text-[30px] leading-tight font-semibold tracking-tight">{formatMoney(s.total_value, s.base_currency)}</p>
                  )}
                  <p className="mt-1 text-sm text-ink-400">Valued in {s?.base_currency.currency_code ?? "your base currency"} at the latest stored rates</p>
                </div>
                {s && (
                  <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                    <div>
                      <dt className="text-ink-400">Virtual funds added</dt>
                      <dd className="num mt-0.5 text-sm text-white">{formatMoney(s.total_funded, s.base_currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-400">Cost basis</dt>
                      <dd className="num mt-0.5 text-sm text-white">{formatMoney(s.total_cost_basis, s.base_currency)}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>
            <StatCard
              label="Overall gain / loss"
              icon="chart"
              loading={loading}
              tone={tone(s?.overall_gain)}
              value={s ? formatMoney(s.overall_gain, s.base_currency, { signed: true }) : "—"}
              sub={s && <>vs. virtual funds · <TrendPct value={s.overall_gain_pct} showArrow={false} /></>}
            />
            <StatCard
              label="Daily movement"
              icon="clock"
              loading={loading}
              tone={tone(s?.daily_change)}
              value={s ? formatMoney(s.daily_change, s.base_currency, { signed: true }) : "—"}
              sub={s && <>Last 24h · <TrendPct value={s.daily_change_pct} showArrow={false} /></>}
            />
            <StatCard
              label="Currencies held"
              icon="layers"
              loading={loading}
              value={s ? s.currencies_held : "—"}
              sub={s && `${s.holdings.length} holding${s.holdings.length === 1 ? "" : "s"} in one wallet`}
            />
            <StatCard
              label="Realized P&L"
              loading={loading}
              tone={tone(s?.realized_pnl)}
              value={s ? formatMoney(s.realized_pnl, s.base_currency, { signed: true }) : "—"}
              sub="Booked on sells, after fees"
            />
            <StatCard
              label="Unrealized P&L"
              loading={loading}
              tone={tone(s?.unrealized_pnl)}
              value={s ? formatMoney(s.unrealized_pnl, s.base_currency, { signed: true }) : "—"}
              sub="Open holdings vs. their cost"
            />
            <StatCard
              label="Last market update"
              icon="clock"
              loading={loading}
              value={<span className="text-lg">{s?.last_market_update ? relativeTime(s.last_market_update, new Date(now)) : "—"}</span>}
              sub={s && <>{formatDateTime(s.last_market_update)} · <span className="font-semibold">{s.market_status}</span></>}
            />
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
            <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0" />
            A currency's price change is not your profit. P&amp;L compares each holding's current value with what you paid for it (weighted-average cost).
          </p>

          {/* wallet + performance */}
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[15px] font-bold tracking-tight">Your wallet</h2>
                <Link to="/profile" className="text-xs font-semibold text-money-700 hover:underline">Details</Link>
              </div>
              {me?.wallet && base ? (
                <WalletCard
                  reference={me.wallet.wallet_reference}
                  name={me.wallet.wallet_name}
                  baseCode={base.currency_code}
                  baseSymbol={base.currency_symbol}
                  holder={me.user.full_name}
                  status={me.wallet.status}
                />
              ) : (
                <div className="skeleton aspect-[1.62/1] w-full rounded-2xl" />
              )}
              <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Currencies in wallet">
                {s?.holdings.map((h) => (
                  <span key={h.currency.currency_code} className="num rounded-md bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-700">
                    {h.currency.currency_symbol} {h.currency.currency_code}
                  </span>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Portfolio value over time"
                subtitle={<PerformanceLegend />}
                actions={<Segmented label="Performance range" options={["1D", "1W", "1M", "3M", "1Y", "ALL"] as const} value={range} onChange={setRange} />}
              />
              <div className="px-2 pb-4 sm:px-4">
                {perf.isLoading || !base ? (
                  <div className="skeleton mx-3 h-[260px]" />
                ) : perf.isError ? (
                  <ErrorState message={errorMessage(perf.error)} onRetry={() => perf.refetch()} />
                ) : perf.data && perf.data.points.length > 1 ? (
                  <PerformanceChart points={perf.data.points} currency={base} />
                ) : (
                  <EmptyState icon="chart" title="Not enough history yet">Your value-over-time chart fills in as market snapshots accumulate.</EmptyState>
                )}
              </div>
            </Card>
          </div>

          {/* holdings */}
          <Card className="mt-6 overflow-hidden">
            <CardHeader
              title="Holdings"
              subtitle="Each currency is a separate holding inside your one wallet. Click a row to trade it."
              actions={<ButtonLink to="/portfolio" variant="secondary" size="sm">Portfolio details</ButtonLink>}
            />
            {loading ? (
              <TableSkeleton rows={4} cols={6} />
            ) : s && s.holdings.length > 0 ? (
              <HoldingsTable holdings={s.holdings} base={s.base_currency} variant="dashboard" />
            ) : (
              <EmptyState icon="wallet" title="No holdings yet" action={<Button onClick={() => setFundOpen(true)}>Add demo funds</Button>}>
                Add virtual funds to start trading.
              </EmptyState>
            )}
          </Card>

          {/* activity */}
          <Card className="mt-6 overflow-hidden">
            <CardHeader
              title="Recent activity"
              subtitle="Trades, virtual funding and expired quotes"
              actions={<ButtonLink to="/transactions" variant="ghost" size="sm">All transactions →</ButtonLink>}
            />
            {activity.isLoading ? (
              <TableSkeleton rows={4} cols={3} />
            ) : activity.isError ? (
              <ErrorState message={errorMessage(activity.error)} onRetry={() => activity.refetch()} />
            ) : activity.data && activity.data.length > 0 ? (
              <ActivityFeed items={activity.data} />
            ) : (
              <EmptyState icon="clock" title="No activity yet">Your trades and funding will appear here.</EmptyState>
            )}
          </Card>
        </>
      )}

      {base && <FundDemoModal open={fundOpen} onClose={() => setFundOpen(false)} baseCode={base.currency_code} />}
    </>
  );
}
