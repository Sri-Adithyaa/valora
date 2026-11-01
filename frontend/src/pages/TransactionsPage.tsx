import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Pagination } from "../components/Pagination";
import { Card, EmptyState, ErrorState, PageHeader, Pill, Segmented, TableSkeleton } from "../components/ui/Display";
import { useMe } from "../hooks/useAuth";
import { useCurrencies } from "../hooks/useMarket";
import { useFundings, useLedger, useTradeHistory } from "../hooks/useWallet";
import { formatDateTime, formatMoney, formatRate } from "../lib/format";
import { errorMessage } from "../services/api";
import type { TradeFilters } from "../services/types";

type Tab = "trades" | "funding" | "ledger";
const TABS: { value: Tab; label: string }[] = [
  { value: "trades", label: "Trades" },
  { value: "funding", label: "Funding" },
  { value: "ledger", label: "Ledger" },
];

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (["trades", "funding", "ledger"].includes(params.get("tab") ?? "") ? params.get("tab") : "trades") as Tab;
  return (
    <>
      <PageHeader
        eyebrow="Transactions"
        title="Transaction history"
        subtitle="Every executed trade, virtual funding entry and immutable ledger posting in your wallet."
        actions={<Segmented label="Transaction view" size="md" options={TABS} value={tab} onChange={(t) => setParams(t === "trades" ? {} : { tab: t })} />}
      />
      {tab === "trades" && <TradesTab />}
      {tab === "funding" && <FundingTab />}
      {tab === "ledger" && <LedgerTab />}
    </>
  );
}

const PAGE_SIZE = 20;

function TradesTab() {
  const { data: currencies } = useCurrencies();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<TradeFilters>({ page: 1, page_size: PAGE_SIZE, currency: "", side: "", status: "", date_from: "", date_to: "" });
  const q = useTradeHistory(filters);
  const set = (patch: Partial<TradeFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const dateError = filters.date_from && filters.date_to && filters.date_from > filters.date_to ? "Start date must be before end date." : null;
  const active = Boolean(filters.currency || filters.side || filters.status || filters.date_from || filters.date_to);

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
        <div>
          <label htmlFor="f-currency" className="label mb-1 block">Currency</label>
          <select id="f-currency" className="input h-9 py-1.5" value={filters.currency} onChange={(e) => set({ currency: e.target.value })}>
            <option value="">All currencies</option>
            {currencies?.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-side" className="label mb-1 block">Direction</label>
          <select id="f-side" className="input h-9 py-1.5" value={filters.side} onChange={(e) => set({ side: e.target.value as TradeFilters["side"] })}>
            <option value="">Buy &amp; sell</option>
            <option value="BUY">Buy (pair base)</option>
            <option value="SELL">Sell (pair base)</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="label mb-1 block">Status</label>
          <select id="f-status" className="input h-9 py-1.5" value={filters.status} onChange={(e) => set({ status: e.target.value as TradeFilters["status"] })}>
            <option value="">Any status</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-from" className="label mb-1 block">From date</label>
          <input id="f-from" type="date" className="input h-9 py-1.5" value={filters.date_from} max={filters.date_to || undefined} onChange={(e) => set({ date_from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-to" className="label mb-1 block">To date</label>
          <input id="f-to" type="date" className="input h-9 py-1.5" value={filters.date_to} min={filters.date_from || undefined} onChange={(e) => set({ date_to: e.target.value })} />
        </div>
        <button
          type="button"
          disabled={!active}
          onClick={() => setFilters({ page: 1, page_size: PAGE_SIZE, currency: "", side: "", status: "", date_from: "", date_to: "" })}
          className="h-9 rounded-lg px-3 text-sm font-semibold text-ink-600 hover:bg-ink-100 disabled:text-ink-300 disabled:hover:bg-transparent"
        >
          Clear
        </button>
        {dateError && <p role="alert" className="text-[13px] font-medium text-loss sm:col-span-2 lg:col-span-6">{dateError}</p>}
      </div>

      {q.isLoading ? (
        <TableSkeleton rows={8} cols={8} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon="swap-h" title={active ? "No trades match these filters" : "No trades yet"}>
          {active ? "Try widening the date range or clearing filters." : <>Head to <Link className="font-semibold text-money-700" to="/trade">Trade</Link> to place your first order.</>}
        </EmptyState>
      ) : (
        <>
          <div className={`overflow-x-auto transition-opacity ${q.isFetching ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[960px] text-sm">
              <caption className="sr-only">Executed trades</caption>
              <thead>
                <tr className="bg-ink-50/70">
                  <th scope="col" className="table-head py-2.5 pl-5">Trade</th>
                  <th scope="col" className="table-head py-2.5">Date &amp; time</th>
                  <th scope="col" className="table-head py-2.5">Exchange</th>
                  <th scope="col" className="table-head py-2.5 text-right">Paid</th>
                  <th scope="col" className="table-head py-2.5 text-right">Received</th>
                  <th scope="col" className="table-head py-2.5 text-right">Executed rate</th>
                  <th scope="col" className="table-head py-2.5 text-right">Fee</th>
                  <th scope="col" className="table-head py-2.5 pr-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {q.data.items.map((t) => (
                  <tr
                    key={t.trade_id}
                    className="cursor-pointer hover:bg-ink-50/70"
                    onClick={() => navigate(`/transactions/${t.trade_id}`)}
                  >
                    <td className="py-3 pl-5">
                      <Link to={`/transactions/${t.trade_id}`} onClick={(e) => e.stopPropagation()} className="num font-semibold text-ink-900 hover:text-money-700">
                        {t.trade_reference}
                      </Link>
                      <p className="text-[11px] text-ink-500">#{t.trade_id} · {t.pair_symbol} <span className={t.side === "BUY" ? "text-gain" : "text-loss"}>{t.side}</span></p>
                    </td>
                    <td className="py-3 text-ink-600">{formatDateTime(t.executed_at)}</td>
                    <td className="py-3 font-semibold text-ink-900">
                      {t.from_currency.currency_code} <span className="text-ink-400">→</span> {t.to_currency.currency_code}
                    </td>
                    <td className="num py-3 text-right text-loss">{formatMoney(t.from_amount, t.from_currency, { code: true })}</td>
                    <td className="num py-3 text-right text-gain">{formatMoney(t.to_amount, t.to_currency, { code: true })}</td>
                    <td className="num py-3 text-right text-ink-600">{formatRate(t.executed_rate)}</td>
                    <td className="num py-3 text-right text-ink-600">{formatMoney(t.fee, t.fee_currency === t.from_currency.currency_code ? t.from_currency : t.fee_currency, { code: true })}</td>
                    <td className="py-3 pr-5 text-right"><Pill tone={t.status === "COMPLETED" ? "green" : "neutral"}>{t.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => set({ page: p })} />
        </>
      )}
    </Card>
  );
}

function FundingTab() {
  const q = useFundings();
  const { data: me } = useMe();
  const base = me?.wallet?.base_currency;
  return (
    <Card className="overflow-hidden">
      {q.isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState icon="wallet" title="No funding yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Virtual funding entries</caption>
            <thead>
              <tr className="bg-ink-50/70">
                <th scope="col" className="table-head py-2.5 pl-5">Reference</th>
                <th scope="col" className="table-head py-2.5">Date &amp; time</th>
                <th scope="col" className="table-head py-2.5">Type</th>
                <th scope="col" className="table-head py-2.5 text-right">Amount</th>
                <th scope="col" className="table-head py-2.5 text-right">Value in base</th>
                <th scope="col" className="table-head py-2.5 pr-5">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {q.data.map((f) => (
                <tr key={f.funding_id}>
                  <td className="num py-3 pl-5 font-semibold text-ink-900">{f.reference}</td>
                  <td className="py-3 text-ink-600">{formatDateTime(f.created_at)}</td>
                  <td className="py-3"><Pill tone={f.funding_type === "INITIAL" ? "dark" : "green"}>{f.funding_type === "INITIAL" ? "Initial balance" : "Demo credit"}</Pill></td>
                  <td className="num py-3 text-right text-gain">+{formatMoney(f.amount, f.currency, { code: true })}</td>
                  <td className="num py-3 text-right text-ink-600">{base ? formatMoney(f.base_value, base) : f.base_value}</td>
                  <td className="py-3 pr-5 text-ink-500">{f.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">Virtual funding is tracked separately from trading gains — it is your invested capital, not profit.</p>
    </Card>
  );
}

function LedgerTab() {
  const { data: currencies } = useCurrencies();
  const [page, setPage] = useState(1);
  const [currency, setCurrency] = useState("");
  const q = useLedger(page, currency);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-100 p-4">
        <div className="w-48">
          <label htmlFor="l-currency" className="label mb-1 block">Currency</label>
          <select id="l-currency" className="input h-9 py-1.5" value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(1); }}>
            <option value="">All currencies</option>
            {currencies?.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code}</option>)}
          </select>
        </div>
        <p className="max-w-md text-xs text-ink-500">The ledger is the immutable audit trail: every debit and credit with the holding balance after posting.</p>
      </div>
      {q.isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon="layers" title="No ledger entries" />
      ) : (
        <>
          <div className={`overflow-x-auto ${q.isFetching ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Ledger entries</caption>
              <thead>
                <tr className="bg-ink-50/70">
                  <th scope="col" className="table-head py-2.5 pl-5">Date &amp; time</th>
                  <th scope="col" className="table-head py-2.5">Reference</th>
                  <th scope="col" className="table-head py-2.5">Entry</th>
                  <th scope="col" className="table-head py-2.5 text-right">Debit</th>
                  <th scope="col" className="table-head py-2.5 text-right">Credit</th>
                  <th scope="col" className="table-head py-2.5 pr-5 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {q.data.items.map((l) => (
                  <tr key={l.ledger_id}>
                    <td className="py-2.5 pl-5 text-ink-600">{formatDateTime(l.created_at, true)}</td>
                    <td className="py-2.5">
                      {l.trade_id ? (
                        <Link to={`/transactions/${l.trade_id}`} className="num font-semibold text-ink-900 hover:text-money-700">{l.reference}</Link>
                      ) : (
                        <span className="num font-semibold text-ink-900">{l.reference}</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <span className="font-semibold text-ink-800">{l.currency.currency_code}</span>{" "}
                      <span className="text-xs text-ink-500">{l.entry_type.replace(/_/g, " ").toLowerCase()}</span>
                    </td>
                    <td className="num py-2.5 text-right text-loss">{l.direction === "DEBIT" ? formatMoney(l.amount, l.currency, { code: true }) : ""}</td>
                    <td className="num py-2.5 text-right text-gain">{l.direction === "CREDIT" ? formatMoney(l.amount, l.currency, { code: true }) : ""}</td>
                    <td className="num py-2.5 pr-5 text-right text-ink-800">{formatMoney(l.balance_after, l.currency, { code: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
