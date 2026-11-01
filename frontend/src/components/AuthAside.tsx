import { useRates } from "../hooks/useMarket";
import { formatRate } from "../lib/format";
import { TrendPct } from "./ui/Display";

const CHAIN = ["INR", "USD", "EUR", "GBP"];

/** Right-hand panel on auth pages: the product idea, drawn with real market data (no stock photos). */
export function AuthAside() {
  const { data: rates } = useRates("", true);
  return (
    <div className="flex h-full flex-col justify-between p-10 xl:p-14">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,178,102,0.18),transparent_55%)]" aria-hidden />
      <div className="relative">
        <p className="label !text-money-400">Where Money Becomes an Asset.</p>
        <h2 className="mt-3 max-w-md text-3xl leading-tight font-extrabold tracking-tight text-white xl:text-4xl">
          One account. One wallet. Multiple currency assets.
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-2" aria-label="Example trade chain">
          {CHAIN.map((c, i) => (
            <span key={c} className="flex items-center gap-2">
              <span className="num rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white">{c}</span>
              {i < CHAIN.length - 1 && <span className="text-money-400" aria-hidden>→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 max-w-sm text-sm text-ink-400">Spend any currency you hold to buy any other — no need to convert back first.</p>
      </div>

      <div className="relative mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wider text-ink-400 uppercase">Featured pairs</p>
          <p className="text-[11px] text-ink-500">Stored snapshots · ~2 min refresh</p>
        </div>
        <ul className="divide-y divide-white/5">
          {(rates ?? []).slice(0, 5).map((r) => (
            <li key={r.pair_id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-semibold text-white">{r.symbol}</span>
              <span className="flex items-center gap-4">
                <span className="num text-ink-200">{formatRate(r.rate)}</span>
                <TrendPct value={r.change_pct} className="w-20 text-right text-xs" />
              </span>
            </li>
          ))}
          {!rates && Array.from({ length: 4 }).map((_, i) => <li key={i} className="py-3"><div className="h-3 rounded bg-white/5" /></li>)}
        </ul>
      </div>
    </div>
  );
}
