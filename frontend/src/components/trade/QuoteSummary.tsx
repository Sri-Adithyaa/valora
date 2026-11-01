import { formatMoney, formatRate, formatTime } from "../../lib/format";
import type { Quote } from "../../services/types";
import { KV, Pill } from "../ui/Display";

/** Fee rate ("0.002500") as a percentage — Intl scales the exact decimal string, no float maths. */
export function formatFeeRate(feeRate: string): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 3 }).format(feeRate as unknown as number);
}

export function QuoteSummary({ quote }: { quote: Quote }) {
  const f = quote.from_currency;
  const t = quote.to_currency;
  return (
    <dl className="divide-y divide-ink-100" aria-label="Quote details">
      <div className="pb-2">
        <KV k="Locked rate" v={<span className="font-semibold text-ink-900">1 {f.currency_code} = {formatRate(quote.quoted_rate)} {t.currency_code}</span>} />
        <KV k="Inverse" v={`1 ${t.currency_code} = ${formatRate(quote.inverse_rate)} ${f.currency_code}`} />
        <div className="flex items-center justify-between gap-2 py-1 text-xs text-ink-500">
          <span>Rate snapshot {formatTime(quote.rate_recorded_at)}</span>
          {quote.rate_freshness !== "LIVE" && <Pill tone={quote.rate_freshness === "DELAYED" ? "amber" : "red"}>{quote.rate_freshness}</Pill>}
        </div>
      </div>
      <div className="py-2">
        <KV k="Amount spent" v={formatQuantity(quote.from_amount, f)} />
        <KV k={`Fee (${formatFeeRate(quote.fee_rate)})`} v={formatMoney(quote.fee, quote.fee_currency === f.currency_code ? f : quote.fee_currency, { code: true })} />
        <KV k={<span className="font-semibold text-ink-800">Total debit</span>} v={formatQuantity(quote.total_debit, f)} strong />
      </div>
      <div className="py-2">
        <KV
          k={<span className="font-semibold text-ink-800">Estimated received</span>}
          v={<span className="text-base font-semibold text-money-700">{formatQuantity(quote.to_amount, t)}</span>}
        />
        <KV k={`Available ${f.currency_code}`} v={formatQuantity(quote.available_balance, f)} />
        <KV k="Spread (built into rate)" v={formatFeeRate(quote.spread)} />
      </div>
    </dl>
  );
}

function formatQuantity(v: string, c: Quote["from_currency"]) {
  return formatMoney(v, c, { code: true });
}
