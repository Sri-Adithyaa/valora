import { LogoMark } from "./layout/Logo";

/** Functional wallet "card" mockup showing the real wallet reference, name and base currency. */
export function WalletCard({
  reference,
  name,
  baseCode,
  baseSymbol,
  holder,
  status = "ACTIVE",
  className = "",
}: {
  reference: string;
  name: string;
  baseCode: string;
  baseSymbol: string;
  holder?: string;
  status?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative isolate aspect-[1.62/1] w-full overflow-hidden rounded-2xl bg-ink-900 p-5 text-white shadow-pop ring-1 ring-white/5 sm:p-6 ${className}`}
      aria-label={`Valora Wallet ${reference}`}
    >
      {/* subtle guilloché-like rings */}
      <svg className="absolute -top-16 -right-20 -z-10 h-72 w-72 text-money-500/20" viewBox="0 0 200 200" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <circle key={i} cx="100" cy="100" r={20 + i * 10} fill="none" stroke="currentColor" strokeWidth="0.6" />
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-money-900/50 to-transparent" aria-hidden />
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" dark />
            <span className="text-sm font-bold tracking-tight">Valora Wallet</span>
          </div>
          <span className="rounded-full bg-money-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-money-300 uppercase">{status}</span>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.18em] text-ink-400 uppercase">Wallet reference</p>
          <p className="num mt-1 text-lg font-semibold tracking-wider sm:text-xl">{reference}</p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            {holder && <p className="truncate text-xs text-ink-400">{holder}</p>}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-ink-400 uppercase">Base</p>
            <p className="text-sm font-bold">
              <span className="text-money-400">{baseSymbol}</span> {baseCode}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
