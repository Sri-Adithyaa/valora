/**
 * Typed fetch client for the Valora Money API.
 *
 * - Same-origin `/api` (Vite dev proxy in development, nginx in production), always with credentials,
 *   because auth is an httpOnly cookie. No token ever touches JavaScript.
 * - Every non-2xx response is turned into an ApiError carrying the backend's {code, message, details}.
 */
import type {
  Activity, Allocation, ApiErrorBody, Currency, ExecuteResult, FieldError, Funding, FundDemoInput, History,
  HistoryRange, Holding, LedgerEntry, LoginInput, MarketStatus, Me, Message, NotificationList, Notification,
  PageOf, PasswordChangeInput, Pair, Performance, PerformanceRange, Portfolio, ProfileUpdateInput, Quote,
  QuoteInput, Rate, RegisterInput, Trade, TradeDetail, TradeFilters, Wallet, WalletCreateInput,
} from "./types";

export const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level validation errors (FastAPI 422 → [{field, message}]). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as FieldError[]) {
        if (d && typeof d.field === "string" && typeof d.message === "string") {
          const key = d.field || "_form";
          if (!out[key]) out[key] = d.message;
        }
      }
    }
    return out;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** A human message for any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "Cannot reach the Valora Money server. Check your connection and try again.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (res.status >= 500 ? "The server ran into a problem. Please try again shortly." : `Request failed (${res.status}).`),
      err?.details ?? null,
    );
  }
  return data as T;
}

/** RFC4122 v4 UUID for Idempotency-Key headers. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── endpoints ───────────────────────────────────────────────────────────────

export const api = {
  auth: {
    me: () => request<Me>("/auth/me"),
    login: (body: LoginInput) => request<Me>("/auth/login", { method: "POST", body }),
    register: (body: RegisterInput) => request<Me>("/auth/register", { method: "POST", body }),
    logout: () => request<Message>("/auth/logout", { method: "POST" }),
  },
  profile: {
    update: (body: ProfileUpdateInput) => request<Me>("/profile", { method: "PATCH", body }),
    changePassword: (body: PasswordChangeInput) => request<Message>("/profile/password", { method: "POST", body }),
  },
  wallet: {
    create: (body: WalletCreateInput) => request<Wallet>("/wallet/create", { method: "POST", body }),
    get: () => request<Wallet>("/wallet"),
    holdings: () => request<Holding[]>("/wallet/holdings"),
    summary: () => request<Portfolio>("/wallet/summary"),
    fundDemo: (body: FundDemoInput) => request<Funding>("/wallet/fund-demo", { method: "POST", body }),
    fundings: () => request<Funding[]>("/wallet/fundings"),
    ledger: (q: { page?: number; page_size?: number; currency?: string }) =>
      request<PageOf<LedgerEntry>>("/wallet/ledger", { query: q }),
    activity: (limit = 15) => request<Activity[]>("/wallet/activity", { query: { limit } }),
  },
  market: {
    currencies: () => request<Currency[]>("/market/currencies"),
    pairs: (q: { search?: string; featured?: boolean; currency?: string } = {}) =>
      request<Pair[]>("/market/pairs", { query: q }),
    rates: (q: { search?: string; featured?: boolean } = {}) => request<Rate[]>("/market/rates", { query: q }),
    lookup: (from: string, to: string) => request<Pair>("/market/pairs/lookup", { query: { from, to } }),
    history: (pairId: number, range: HistoryRange, invert: boolean) =>
      request<History>(`/market/pairs/${pairId}/history`, { query: { range, invert } }),
    status: () => request<MarketStatus>("/market/status"),
  },
  trade: {
    quote: (body: QuoteInput) => request<Quote>("/trade/quote", { method: "POST", body }),
    getQuote: (id: string) => request<Quote>(`/trade/quote/${encodeURIComponent(id)}`),
    execute: (quoteId: string, idempotencyKey: string) =>
      request<ExecuteResult>("/trade/execute", {
        method: "POST",
        body: { quote_id: quoteId },
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    history: (f: TradeFilters) => request<PageOf<Trade>>("/trade/history", { query: { ...f } }),
    get: (id: number | string) => request<TradeDetail>(`/trade/${encodeURIComponent(String(id))}`),
  },
  portfolio: {
    get: () => request<Portfolio>("/portfolio"),
    performance: (range: PerformanceRange) => request<Performance>("/portfolio/performance", { query: { range } }),
    allocation: () => request<Allocation>("/portfolio/allocation"),
  },
  notifications: {
    list: (limit = 30) => request<NotificationList>("/notifications", { query: { limit } }),
    markRead: (id: number) => request<Notification>(`/notifications/${id}/read`, { method: "PATCH" }),
    markAllRead: () => request<Message>("/notifications/read-all", { method: "POST" }),
  },
  watchlist: {
    list: () => request<Pair[]>("/watchlist"),
    add: (pairId: number) => request<Message>(`/watchlist/${pairId}`, { method: "POST" }),
    remove: (pairId: number) => request<Message>(`/watchlist/${pairId}`, { method: "DELETE" }),
  },
};
