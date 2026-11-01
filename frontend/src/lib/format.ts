/**
 * Display formatting for decimal strings coming from the API.
 *
 * These helpers only *format* — they never add, subtract or multiply amounts. Intl.NumberFormat is fed the
 * decimal string itself (exact-decimal formatting, ES2023), so no binary floating-point rounding is introduced.
 */
import type { Currency } from "../services/types";

export const MINUS = "−";

type CurrencyLike = Pick<Currency, "currency_code" | "currency_symbol" | "decimals"> | string;

const KNOWN: Record<string, { symbol: string; decimals: number }> = {
  INR: { symbol: "₹", decimals: 2 },
  USD: { symbol: "$", decimals: 2 },
  EUR: { symbol: "€", decimals: 2 },
  GBP: { symbol: "£", decimals: 2 },
  JPY: { symbol: "¥", decimals: 0 },
};

function resolveCurrency(c: CurrencyLike): { code: string; symbol: string; decimals: number } {
  if (typeof c === "string") {
    const k = KNOWN[c.toUpperCase()];
    return { code: c.toUpperCase(), symbol: k?.symbol ?? "", decimals: k?.decimals ?? 2 };
  }
  return { code: c.currency_code, symbol: c.currency_symbol, decimals: c.decimals };
}

/** INR uses Indian digit grouping (1,00,000); everything else uses Western grouping. */
export function localeFor(code: string): string {
  return code.toUpperCase() === "INR" ? "en-IN" : "en-US";
}

const ZERO_RE = /^[+-]?0*(\.0*)?$/;

export function isZero(v: string | null | undefined): boolean {
  if (v === null || v === undefined || v.trim() === "") return true;
  return ZERO_RE.test(v.trim());
}

export type Direction = "up" | "down" | "flat";

/** Sign of a decimal string, read from the string itself. */
export function direction(v: string | null | undefined): Direction {
  if (v === null || v === undefined || isZero(v)) return "flat";
  return v.trim().startsWith("-") ? "down" : "up";
}

function stripSign(v: string): string {
  const t = v.trim();
  return t.startsWith("-") || t.startsWith("+") ? t.slice(1) : t;
}

/** Format an unsigned decimal string with a fixed number of decimals. */
function fmtNumber(abs: string, decimals: number, locale: string): string {
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    roundingMode: "halfExpand",
  } as Intl.NumberFormatOptions);
  return nf.format(abs as unknown as number);
}

/** Has the value been rounded to all-zero digits (so we don't print "-₹0.00")? */
function roundsToZero(formatted: string): boolean {
  return !/[1-9]/.test(formatted);
}

export interface MoneyOptions {
  /** Prefix "+" for positive values (P&L, movements). */
  signed?: boolean;
  /** Append the ISO code instead of the symbol, e.g. "1,234.00 USD". */
  code?: boolean;
  /** Override decimals (defaults to the currency's own). */
  decimals?: number;
}

/**
 * formatMoney("100000", INR) → "₹1,00,000.00"; formatMoney("5280", JPY) → "¥5,280".
 * Returns "—" for null/empty input.
 */
export function formatMoney(amount: string | null | undefined, currency: CurrencyLike, opts: MoneyOptions = {}): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const c = resolveCurrency(currency);
  const decimals = opts.decimals ?? c.decimals;
  const neg = amount.trim().startsWith("-");
  const body = fmtNumber(stripSign(amount), decimals, localeFor(c.code));
  const zero = roundsToZero(body);
  const sign = zero ? "" : neg ? MINUS : opts.signed ? "+" : "";
  if (opts.code || !c.symbol) return `${sign}${body} ${c.code}`;
  return `${sign}${c.symbol}${body}`;
}

/** Quantity of a currency: "674.29 USD", "5,280 JPY". */
export function formatQuantity(amount: string | null | undefined, currency: CurrencyLike): string {
  return formatMoney(amount, currency, { code: true });
}

/** Plain number with the given decimals and the currency's grouping locale. */
export function formatNumber(v: string | null | undefined, decimals = 2, code = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const neg = v.trim().startsWith("-");
  const body = fmtNumber(stripSign(v), decimals, localeFor(code));
  return `${neg && !roundsToZero(body) ? MINUS : ""}${body}`;
}

/**
 * Exchange rates: values ≥ 1 get 4 decimals ("94.9242"); values < 1 get 5 significant digits ("0.010524").
 */
export function formatRate(rate: string | null | undefined, opts: { decimals?: number } = {}): string {
  if (rate === null || rate === undefined || rate === "") return "—";
  const abs = stripSign(rate);
  const neg = rate.trim().startsWith("-");
  let out: string;
  if (opts.decimals !== undefined) {
    out = fmtNumber(abs, opts.decimals, "en-US");
  } else {
    const intPart = abs.split(".")[0].replace(/^0+/, "");
    if (intPart.length > 0) {
      out = fmtNumber(abs, 4, "en-US");
    } else {
      const nf = new Intl.NumberFormat("en-US", {
        minimumSignificantDigits: 5,
        maximumSignificantDigits: 5,
        roundingMode: "halfExpand",
      } as Intl.NumberFormatOptions);
      out = nf.format(abs as unknown as number);
    }
  }
  return `${neg && !roundsToZero(out) ? MINUS : ""}${out}`;
}

/** formatPct("1.234") → "+1.23%", formatPct("-0.198") → "−0.20%", formatPct("0") → "0.00%". */
export function formatPct(pct: string | null | undefined, opts: { signed?: boolean; decimals?: number } = {}): string {
  if (pct === null || pct === undefined || pct === "") return "—";
  const decimals = opts.decimals ?? 2;
  const signed = opts.signed ?? true;
  const neg = pct.trim().startsWith("-");
  const body = fmtNumber(stripSign(pct), decimals, "en-US");
  const zero = roundsToZero(body);
  const sign = zero ? "" : neg ? MINUS : signed ? "+" : "";
  return `${sign}${body}%`;
}

// ── dates ───────────────────────────────────────────────────────────────────

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffSec = Math.round((now.getTime() - t) / 1000);
  if (diffSec < 0) return diffSec > -60 ? "just now" : `in ${Math.ceil(-diffSec / 60)} min`;
  if (diffSec < 45) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d} days ago`;
  return formatDate(iso);
}

export function formatDateTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Seconds left until `iso` (never negative). Pure time arithmetic — no money involved. */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

/** Convert a decimal string to a Number — ONLY for feeding chart libraries. */
export function chartNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(v);
}

/** Text colour class for a signed value. */
export function trendClass(v: string | null | undefined): string {
  const d = direction(v);
  return d === "up" ? "text-gain" : d === "down" ? "text-loss" : "text-ink-500";
}

/** Validate a user-typed amount for a currency's precision (string check, no arithmetic). */
export function validateAmountInput(raw: string, decimals: number): string | null {
  const v = raw.trim();
  if (!v) return "Enter an amount.";
  if (!/^\d+(\.\d+)?$/.test(v)) return "Enter a positive number, e.g. 1000 or 25.50.";
  if (isZero(v)) return "Amount must be greater than zero.";
  const frac = v.split(".")[1] ?? "";
  if (frac.length > decimals) {
    return decimals === 0 ? "This currency has no decimal places." : `Use at most ${decimals} decimal places.`;
  }
  return null;
}
