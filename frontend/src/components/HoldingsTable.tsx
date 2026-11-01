import { Link, useNavigate } from "react-router-dom";
import { formatMoney, formatPct, formatRate } from "../lib/format";
import { tradeHref } from "../lib/trade";
import type { Currency, Holding } from "../services/types";
import { CurrencyBadge, TrendMoney, TrendPct } from "./ui/Display";

function tradeTarget(h: Holding, base: Currency): string {
  const code = h.currency.currency_code;
  // Spend the holding by default; for the base currency, suggest buying USD (or EUR for USD wallets).
  if (code === base.currency_code) return tradeHref(code, code === "USD" ? "EUR" : "USD");
  return tradeHref(code, base.currency_code);
}

/**
 * Holdings table. `variant="dashboard"` shows 24h price change and allocation;
 * `variant="portfolio"` shows latest rate and realized P&L. Below `md` it becomes stacked cards.
 */
export function HoldingsTable({
  holdings,
  base,
  variant = "dashboard",
  selected,
  onSelect,
}: {
  holdings: Holding[];
  base: Currency;
  variant?: "dashboard" | "portfolio";
  selected?: string;
  onSelect?: (code: string) => void;
}) {
  const navigate = useNavigate();
  const perUnit = (v: string | null) => (v === null ? "—" : `${base.currency_symbol}${formatRate(v)}`);
  const rowClick = (h: Holding) => (onSelect ? onSelect(h.currency.currency_code) : navigate(tradeTarget(h, base)));

  return (
    <>
      {/* desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Currency holdings valued in {base.currency_code}</caption>
          <thead>
            <tr className="border-y border-ink-100 bg-ink-50/70">
              <th scope="col" className="table-head py-2.5 pl-5">Currency</th>
              <th scope="col" className="table-head py-2.5 text-right">Quantity</th>
              <th scope="col" className="table-head py-2.5 text-right">Avg cost</th>
              {variant === "portfolio" && <th scope="col" className="table-head py-2.5 text-right">Latest rate</th>}
              <th scope="col" className="table-head py-2.5 text-right">Value ({base.currency_code})</th>
              <th scope="col" className="table-head py-2.5 text-right">Unrealized P&amp;L</th>
              {variant === "dashboard" ? (
                <>
                  <th scope="col" className="table-head py-2.5 text-right" title="Market price change of the currency — not your profit">24h price</th>
                  <th scope="col" className="table-head py-2.5 text-right">Allocation</th>
                </>
              ) : (
                <th scope="col" className="table-head py-2.5 text-right">Realized P&amp;L</th>
              )}
              <th scope="col" className="table-head py-2.5 pr-5 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {holdings.map((h) => {
              const code = h.currency.currency_code;
              const isSel = selected === code;
              return (
                <tr
                  key={code}
                  onClick={() => rowClick(h)}
                  className={`cursor-pointer transition-colors ${isSel ? "bg-money-50/70" : "hover:bg-ink-50/70"}`}
                  aria-selected={onSelect ? isSel : undefined}
                >
                  <td className="py-3 pl-5">
                    <CurrencyBadge currency={h.currency} showName />
                  </td>
                  <td className="num py-3 text-right text-ink-900">{formatMoney(h.quantity, h.currency, { code: true })}</td>
                  <td className="num py-3 text-right text-ink-600">{perUnit(h.average_cost)}</td>
                  {variant === "portfolio" && <td className="num py-3 text-right text-ink-600">{perUnit(h.latest_rate)}</td>}
                  <td className="num py-3 text-right font-semibold text-ink-900">{formatMoney(h.current_value, base)}</td>
                  <td className="py-3 text-right">
                    <TrendMoney value={h.unrealized_pnl} currency={base} />
                    <TrendPct value={h.unrealized_pnl_pct} showArrow={false} className="block text-[11px]" />
                  </td>
                  {variant === "dashboard" ? (
                    <>
                      <td className="py-3 text-right"><TrendPct value={h.price_change_24h_pct} /></td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-ink-100 lg:block" aria-hidden>
                            <span className="block h-full rounded-full bg-money-500" style={{ width: `${Math.min(100, Number(h.allocation_pct))}%` }} />
                          </span>
                          <span className="num w-14 text-ink-700">{formatPct(h.allocation_pct, { signed: false, decimals: 1 })}</span>
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className="py-3 text-right"><TrendMoney value={h.realized_pnl} currency={base} /></td>
                  )}
                  <td className="py-3 pr-5 text-right">
                    <Link
                      to={tradeTarget(h, base)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md px-2 py-1 text-xs font-bold text-money-700 hover:bg-money-50"
                      aria-label={`Trade ${code}`}
                    >
                      Trade →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <ul className="divide-y divide-ink-100 border-t border-ink-100 md:hidden">
        {holdings.map((h) => {
          const code = h.currency.currency_code;
          return (
            <li key={code} className={selected === code ? "bg-money-50/70" : ""}>
              <button type="button" onClick={() => rowClick(h)} className="w-full px-4 py-3 text-left">
                <div className="flex items-start justify-between gap-3">
                  <CurrencyBadge currency={h.currency} showName />
                  <div className="text-right">
                    <p className="num font-semibold text-ink-900">{formatMoney(h.current_value, base)}</p>
                    <p className="num text-xs text-ink-500">{formatMoney(h.quantity, h.currency, { code: true })}</p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div><p className="text-ink-500">Unrealized</p><TrendMoney value={h.unrealized_pnl} currency={base} /></div>
                  {variant === "dashboard" ? (
                    <>
                      <div><p className="text-ink-500">24h price</p><TrendPct value={h.price_change_24h_pct} /></div>
                      <div className="text-right"><p className="text-ink-500">Allocation</p><p className="num text-ink-800">{formatPct(h.allocation_pct, { signed: false, decimals: 1 })}</p></div>
                    </>
                  ) : (
                    <>
                      <div><p className="text-ink-500">Avg cost</p><p className="num text-ink-800">{perUnit(h.average_cost)}</p></div>
                      <div className="text-right"><p className="text-ink-500">Realized</p><TrendMoney value={h.realized_pnl} currency={base} /></div>
                    </>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
