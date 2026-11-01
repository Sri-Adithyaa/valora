import { Link, Navigate } from "react-router-dom";
import { Logo } from "../components/layout/Logo";
import { MarketStatusPill } from "../components/layout/MarketStatus";
import { SimulationBanner } from "../components/layout/SimulationBanner";
import { ButtonLink } from "../components/ui/Button";
import { TrendPct } from "../components/ui/Display";
import { Icon, type IconName } from "../components/ui/Icon";
import { FullPageLoader } from "../components/ui/Spinner";
import { useMe } from "../hooks/useAuth";
import { useRates } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { formatRate, relativeTime } from "../lib/format";

const VISION = ["Own currencies.", "Trade what you already hold.", "Build your multi-currency portfolio.", "Choose what you want to liquidate."];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "wallet", title: "One wallet, many holdings", body: "A single Valora Wallet holds INR, USD, EUR, GBP, JPY and more — each currency is its own holding with its own cost basis." },
  { icon: "swap-h", title: "Trade what you hold", body: "Spend any currency you own on any other. INR → USD → EUR → GBP, without converting back to your base currency in between." },
  { icon: "shield", title: "Locked 30-second quotes", body: "Every trade starts with a fixed-rate quote showing the fee and exactly what is debited and credited before you confirm." },
  { icon: "chart", title: "Real portfolio analytics", body: "Weighted-average cost, realized and unrealized P&L, allocation and value over time — price change is never mistaken for profit." },
];

export default function LandingPage() {
  const { data: me, isLoading } = useMe();
  const rates = useRates("", true);
  const now = useNow(30_000);

  if (isLoading) return <FullPageLoader />;
  if (me) return <Navigate to={me.wallet ? "/dashboard" : "/wallet/setup"} replace />;

  return (
    <div className="min-h-screen bg-white">
      <SimulationBanner />
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-100">Log in</Link>
          <ButtonLink to="/register" size="sm">Open an account</ButtonLink>
        </nav>
      </header>

      <main id="main">
        {/* hero */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pt-10 pb-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16 lg:pb-24">
          <div>
            <p className="label !text-money-700">Valora Money · The Money Market</p>
            <h1 className="mt-4 text-[42px] leading-[1.04] font-extrabold tracking-[-0.03em] text-ink-900 sm:text-6xl">
              Where Money<br />Becomes an <span className="text-money-600">Asset.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-600">
              <strong className="font-bold text-ink-900">One Account. One Wallet. Multiple Currency Assets.</strong> Hold currencies the way you hold stocks —
              buy them, keep them, trade one for another, and track every position's performance.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/register" size="lg">Start with virtual funds <Icon name="arrow-right" className="h-4 w-4" /></ButtonLink>
              <ButtonLink to="/login" size="lg" variant="secondary">Log in</ButtonLink>
            </div>
            <ul className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-2 text-sm text-ink-600">
              {VISION.map((v) => (
                <li key={v} className="flex items-center gap-2">
                  <Icon name="check" className="h-4 w-4 shrink-0 text-money-600" strokeWidth={2.4} /> {v}
                </li>
              ))}
            </ul>
          </div>

          {/* live market table */}
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(ellipse_at_top_right,rgba(16,178,102,0.16),transparent_60%)]" aria-hidden />
            <div className="overflow-hidden rounded-2xl bg-ink-900 text-white shadow-pop ring-1 ring-black/5">
              <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
                <div>
                  <p className="text-sm font-bold">Featured markets</p>
                  <p className="text-xs text-ink-400">1 BASE = rate QUOTE · stored snapshots</p>
                </div>
                <MarketStatusPill dark />
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">Featured currency pairs</caption>
                <thead>
                  <tr className="text-left text-[10px] font-semibold tracking-[0.12em] text-ink-500 uppercase">
                    <th scope="col" className="px-5 py-2.5">Pair</th>
                    <th scope="col" className="py-2.5 text-right">Rate</th>
                    <th scope="col" className="py-2.5 text-right">24h</th>
                    <th scope="col" className="hidden px-5 py-2.5 text-right sm:table-cell">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rates.isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td colSpan={4} className="px-5 py-3.5"><div className="h-3 animate-pulse rounded bg-white/5" /></td></tr>
                    ))}
                  {rates.isError && (
                    <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-ink-400">Market data is unavailable right now.</td></tr>
                  )}
                  {rates.data?.slice(0, 8).map((r) => (
                    <tr key={r.pair_id}>
                      <td className="px-5 py-3">
                        <span className="font-bold">{r.symbol}</span>
                        <span className="block text-[11px] text-ink-500">{r.base.currency_name}</span>
                      </td>
                      <td className="num py-3 text-right text-ink-100">{formatRate(r.rate)}</td>
                      <td className="py-3 text-right"><TrendPct value={r.change_pct} className="text-xs" /></td>
                      <td className="hidden px-5 py-3 text-right text-xs text-ink-500 sm:table-cell">{relativeTime(r.recorded_at, new Date(now))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-white/5 px-5 py-3 text-[11px] text-ink-500">Rates refresh about every 2 minutes — never presented as real-time ticks.</p>
            </div>
          </div>
        </section>

        {/* chain */}
        <section className="border-y border-ink-100 bg-ink-50">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8">
            <p className="label">The central idea</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight text-ink-900">The currency you own becomes the source of your next trade.</h2>
            <ol className="mt-8 grid gap-3 sm:grid-cols-4" aria-label="Example trade chain">
              {[
                { c: "INR", s: "₹", t: "Start with a virtual ₹ balance" },
                { c: "USD", s: "$", t: "Buy USD with INR" },
                { c: "EUR", s: "€", t: "Use USD to buy EUR" },
                { c: "GBP", s: "£", t: "Use EUR to buy GBP" },
              ].map((x, i) => (
                <li key={x.c} className="card relative p-5">
                  <span className="num absolute top-4 right-4 text-xs text-ink-300">0{i + 1}</span>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink-900 text-base font-bold text-money-400">{x.s}</span>
                  <p className="mt-3 text-lg font-extrabold">{x.c}</p>
                  <p className="text-sm text-ink-500">{x.t}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* features */}
        <section className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-money-50 text-money-700">
                  <Icon name={f.icon} />
                </span>
                <h3 className="mt-4 font-bold text-ink-900">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-600">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-2xl bg-ink-900 p-8 text-white sm:flex-row sm:items-center sm:p-10">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">Build your multi-currency portfolio.</h2>
              <p className="mt-1 text-sm text-ink-400">Register, open your wallet and receive a virtual starting balance in seconds.</p>
            </div>
            <ButtonLink to="/register" size="lg" variant="light">Create your account</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-100">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-1 px-5 py-6 text-xs text-ink-500 sm:flex-row sm:justify-between sm:px-8">
          <p><span className="font-semibold text-ink-700">Valora Money</span> — Where Money Becomes an Asset.</p>
          <p>Simulated trading platform. No real deposits, withdrawals or banking integrations.</p>
        </div>
      </footer>
    </div>
  );
}
