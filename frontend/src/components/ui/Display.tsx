/** Small presentational building blocks: cards, stats, badges, trend values, empty/error states. */
import type { ReactNode } from "react";
import { direction, formatMoney, formatPct, MINUS } from "../../lib/format";
import type { Currency } from "../../services/types";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function CardHeader({ title, subtitle, actions, className = "" }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold tracking-tight text-ink-900">{title}</h2>
        {subtitle && <div className="mt-0.5 text-[13px] text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="label mb-1.5">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 max-w-2xl text-sm text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
  loading = false,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "up" | "down";
  icon?: IconName;
  loading?: boolean;
}) {
  const valueTone = tone === "up" ? "text-gain" : tone === "down" ? "text-loss" : "text-ink-900";
  return (
    <div className="card flex flex-col justify-between gap-2 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="label">{label}</p>
        {icon && <Icon name={icon} className="h-4 w-4 text-ink-400" />}
      </div>
      {loading ? (
        <div className="skeleton h-7 w-32" />
      ) : (
        <p className={`num text-[22px] font-semibold leading-tight tracking-tight sm:text-2xl ${valueTone}`}>{value}</p>
      )}
      {sub && <div className="text-[13px] text-ink-500">{loading ? <span className="skeleton inline-block h-4 w-24" /> : sub}</div>}
    </div>
  );
}

/** Coloured, signed percentage with an arrow glyph. */
export function TrendPct({ value, className = "", showArrow = true }: { value: string | null | undefined; className?: string; showArrow?: boolean }) {
  if (value === null || value === undefined) return <span className={`num text-ink-400 ${className}`}>—</span>;
  const d = direction(value);
  const tone = d === "up" ? "text-gain" : d === "down" ? "text-loss" : "text-ink-500";
  const arrow = d === "up" ? "▲" : d === "down" ? "▼" : "";
  return (
    <span className={`num whitespace-nowrap ${tone} ${className}`}>
      {showArrow && arrow && <span className="mr-1 text-[0.7em]" aria-hidden>{arrow}</span>}
      {formatPct(value)}
    </span>
  );
}

/** Coloured, signed money value (P&L). */
export function TrendMoney({ value, currency, className = "" }: { value: string | null | undefined; currency: Currency | string; className?: string }) {
  if (value === null || value === undefined) return <span className={`num text-ink-400 ${className}`}>—</span>;
  const d = direction(value);
  const tone = d === "up" ? "text-gain" : d === "down" ? "text-loss" : "text-ink-600";
  return <span className={`num whitespace-nowrap ${tone} ${className}`}>{formatMoney(value, currency, { signed: true })}</span>;
}

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "green" | "red" | "amber" | "dark"; className?: string }) {
  const tones = {
    neutral: "bg-ink-100 text-ink-700",
    green: "bg-money-100 text-money-800",
    red: "bg-loss-50 text-loss",
    amber: "bg-warn-50 text-warn",
    dark: "bg-ink-900 text-white",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]} ${className}`}>{children}</span>;
}

/** Circular currency glyph + code (and optionally name). */
export function CurrencyBadge({ currency, showName = false, size = "md" }: { currency: Pick<Currency, "currency_code" | "currency_symbol" | "currency_name">; showName?: boolean; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <span className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full bg-ink-900 font-bold text-money-400`} aria-hidden>
        {currency.currency_symbol.length <= 2 ? currency.currency_symbol : currency.currency_code.slice(0, 1)}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block font-bold text-ink-900">{currency.currency_code}</span>
        {showName && <span className="block truncate text-xs text-ink-500">{currency.currency_name}</span>}
      </span>
    </span>
  );
}

export function PairLabel({ base, quote, className = "" }: { base: string; quote: string; className?: string }) {
  return (
    <span className={`font-bold tracking-tight text-ink-900 ${className}`}>
      {base}
      <span className="mx-0.5 text-ink-300">/</span>
      {quote}
    </span>
  );
}

export function EmptyState({ icon = "layers", title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-500">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="font-semibold text-ink-800">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-loss-50 text-loss">
        <Icon name="alert" className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          <Icon name="refresh" className="h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Segmented control (range selectors, tabs within a card). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  dark = false,
}: {
  options: readonly T[] | { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  dark?: boolean;
}) {
  const opts = (options as (T | { value: T; label: ReactNode })[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const pad = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg p-0.5 ${dark ? "bg-white/[0.06]" : "bg-ink-100"}`}>
      {opts.map((o) => {
        const active = o.value === value;
        const cls = dark
          ? active
            ? "bg-white/15 text-white"
            : "text-ink-300 hover:text-white"
          : active
            ? "bg-white text-ink-900 shadow-card"
            : "text-ink-500 hover:text-ink-800";
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`${pad} inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors ${cls}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Key/value line for summaries (quote panel, trade detail). */
export function KV({ k, v, strong = false, className = "" }: { k: ReactNode; v: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${className}`}>
      <dt className="text-ink-500">{k}</dt>
      <dd className={`num text-right ${strong ? "font-semibold text-ink-900" : "text-ink-800"}`}>{v}</dd>
    </div>
  );
}

export { MINUS };
