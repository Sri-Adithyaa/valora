import { Link, useParams } from "react-router-dom";
import { Card, CardHeader, ErrorState, KV, Pill, TrendMoney } from "../components/ui/Display";
import { ButtonLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { FullPageLoader } from "../components/ui/Spinner";
import { useTrade } from "../hooks/useWallet";
import { formatDateTime, formatMoney, formatRate } from "../lib/format";
import { tradeHref } from "../lib/trade";
import { errorMessage, isApiError } from "../services/api";

export default function TradeDetailPage() {
  const { tradeId } = useParams();
  const validId = tradeId && /^\d+$/.test(tradeId) ? tradeId : undefined;
  const q = useTrade(validId);

  if (!validId) return <NotFoundCard message="That isn't a valid trade ID." />;
  if (q.isLoading) return <FullPageLoader label="Loading trade" />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) return <NotFoundCard message={q.error.message} />;
    return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  }
  const t = q.data!;
  const f = t.from_currency;
  const to = t.to_currency;
  const feeCur = t.fee_currency === f.currency_code ? f : t.fee_currency;

  return (
    <>
      <Link to="/transactions" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900">
        <Icon name="arrow-left" className="h-4 w-4" /> All transactions
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label mb-1.5">Trade #{t.trade_id}</p>
          <h1 className="num text-2xl font-semibold tracking-tight text-ink-900 sm:text-[28px]">{t.trade_reference}</h1>
          <p className="mt-1 text-sm text-ink-500">
            Executed {formatDateTime(t.executed_at, true)} · {t.pair_symbol} · <span className={t.side === "BUY" ? "text-gain" : "text-loss"}>{t.side}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Pill tone="green">{t.status}</Pill>
          <ButtonLink to={tradeHref(to.currency_code, f.currency_code)} variant="secondary" size="sm">Trade {to.currency_code} →</ButtonLink>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="card border-l-4 !border-l-loss p-5">
          <p className="text-[11px] font-bold tracking-wider text-loss uppercase">Debited</p>
          <p className="num mt-1 text-2xl font-semibold">{formatMoney(t.from_amount, f, { code: true })}</p>
          <p className="mt-0.5 text-xs text-ink-500">plus {formatMoney(t.fee, feeCur, { code: true })} fee</p>
        </div>
        <Icon name="arrow-right" className="mx-auto hidden h-6 w-6 text-ink-300 sm:block" />
        <div className="card border-l-4 !border-l-money-500 p-5">
          <p className="text-[11px] font-bold tracking-wider text-money-700 uppercase">Credited</p>
          <p className="num mt-1 text-2xl font-semibold">{formatMoney(t.to_amount, to, { code: true })}</p>
          <p className="mt-0.5 text-xs text-ink-500">Trade value {formatMoney(t.trade_value_base, t.base_currency)}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Execution" />
          <dl className="divide-y divide-ink-100 px-5 pb-4">
            <KV k="Executed rate" v={`1 ${f.currency_code} = ${formatRate(t.executed_rate)} ${to.currency_code}`} strong />
            <KV k="Mid-market rate" v={`1 ${f.currency_code} = ${formatRate(t.mid_rate)} ${to.currency_code}`} />
            <KV k="Fee" v={formatMoney(t.fee, feeCur, { code: true })} />
            <KV k="Trade value (base)" v={formatMoney(t.trade_value_base, t.base_currency)} />
            <KV k="Order ID" v={`#${t.order_id}`} />
            <KV k="Quote ID" v={<span className="text-xs break-all">{t.quote_id}</span>} />
          </dl>
        </Card>
        <Card>
          <CardHeader title="Quote timing" subtitle="The rate was locked when the quote was created and executed before expiry." />
          <dl className="divide-y divide-ink-100 px-5 pb-4">
            <KV k="Rate snapshot recorded" v={formatDateTime(t.rate_recorded_at, true)} />
            <KV k="Quote created" v={formatDateTime(t.quote_created_at, true)} />
            <KV k="Quote expiry" v={formatDateTime(t.quote_expires_at, true)} />
            <KV k="Executed" v={formatDateTime(t.executed_at, true)} strong />
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Realized P&L" subtitle="Booked against the weighted-average cost of the currency you gave up." />
        <div className="px-5 pb-5">
          {t.pnl ? (
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <KV k="Quantity disposed" v={formatMoney(t.pnl.quantity_disposed, f, { code: true })} />
              <KV k="Average cost (per unit)" v={`${formatRate(t.pnl.average_cost)} ${t.base_currency}`} />
              <KV k="Cost value" v={formatMoney(t.pnl.cost_value, t.base_currency)} />
              <KV k="Realized value" v={formatMoney(t.pnl.realized_value, t.base_currency)} />
              <KV k="Profit / loss" v={<TrendMoney value={t.pnl.profit_loss} currency={t.base_currency} className="font-semibold" />} strong />
            </dl>
          ) : (
            <p className="text-sm text-ink-500">No realized P&amp;L for this trade.</p>
          )}
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Ledger entries" subtitle="Immutable debit/credit postings created by this trade." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-t border-ink-100 bg-ink-50/70">
                <th scope="col" className="table-head py-2.5 pl-5">Entry</th>
                <th scope="col" className="table-head py-2.5">Reference</th>
                <th scope="col" className="table-head py-2.5 text-right">Debit</th>
                <th scope="col" className="table-head py-2.5 text-right">Credit</th>
                <th scope="col" className="table-head py-2.5 pr-5 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {t.ledger_entries.map((l) => (
                <tr key={l.ledger_id}>
                  <td className="py-2.5 pl-5">
                    <span className="font-semibold text-ink-800">{l.currency.currency_code}</span>{" "}
                    <span className="text-xs text-ink-500">{l.entry_type.replace(/_/g, " ").toLowerCase()}</span>
                  </td>
                  <td className="num py-2.5 text-ink-600">{l.reference}</td>
                  <td className="num py-2.5 text-right text-loss">{l.direction === "DEBIT" ? formatMoney(l.amount, l.currency, { code: true }) : ""}</td>
                  <td className="num py-2.5 text-right text-gain">{l.direction === "CREDIT" ? formatMoney(l.amount, l.currency, { code: true }) : ""}</td>
                  <td className="num py-2.5 pr-5 text-right">{formatMoney(l.balance_after, l.currency, { code: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function NotFoundCard({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <p className="text-lg font-bold">Trade not found</p>
      <p className="mt-1 text-sm text-ink-500">{message}</p>
      <ButtonLink to="/transactions" variant="secondary" className="mt-4">Back to transactions</ButtonLink>
    </Card>
  );
}
