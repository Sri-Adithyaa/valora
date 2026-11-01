/**
 * Types mirroring the backend Pydantic schemas (backend/app/schemas/__init__.py).
 * Every Decimal arrives as a JSON string and stays a string: the browser never does money arithmetic.
 */

export type DecimalString = string;
export type ISODateTime = string;

export interface Currency {
  currency_id: number;
  currency_code: string;
  currency_name: string;
  currency_symbol: string;
  country: string;
  decimals: number;
  status: string;
}

export interface Pair {
  pair_id: number;
  symbol: string;
  base: Currency;
  quote: Currency;
  status: string;
  spread: DecimalString;
  min_trade_amount: DecimalString;
  is_featured: boolean;
  is_favourite: boolean;
}

export type Freshness = "LIVE" | "DELAYED" | "STALE" | "UNAVAILABLE" | string;

export interface Rate extends Pair {
  rate: DecimalString | null;
  previous_rate: DecimalString | null;
  change: DecimalString | null;
  change_pct: DecimalString | null;
  recorded_at: ISODateTime | null;
  provider: string | null;
  rate_type: string | null;
  freshness: Freshness;
}

export type MarketStatusKind = "LIVE" | "DELAYED" | "STALE" | "UNAVAILABLE";

export interface MarketStatus {
  status: MarketStatusKind | string;
  message: string;
  fx_session: "OPEN" | "CLOSED" | string;
  last_updated_at: ISODateTime | null;
  data_as_of: ISODateTime | null;
  provider: string | null;
  is_simulated: boolean;
  provider_available: boolean;
  last_successful_update_at: ISODateTime | null;
  update_interval_seconds: number;
  server_time: ISODateTime;
}

export type HistoryRange = "1H" | "6H" | "1D" | "1W" | "1M" | "3M" | "1Y";
export const HISTORY_RANGES: HistoryRange[] = ["1H", "6H", "1D", "1W", "1M", "3M", "1Y"];

export interface HistoryPoint {
  time: ISODateTime;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  simulated: boolean;
}

export interface History {
  pair_id: number;
  symbol: string;
  display_symbol: string;
  inverted: boolean;
  range: string;
  includes_simulated: boolean;
  points: HistoryPoint[];
}

// ── auth / profile ──────────────────────────────────────────────────────────

export interface RegisterInput {
  full_name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirm_password: string;
  country: string;
  base_currency: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface WalletBrief {
  wallet_id: number;
  wallet_reference: string;
  wallet_name: string;
  status: string;
  created_at: ISODateTime;
  base_currency: Currency;
}

export interface User {
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  country: string;
  base_currency: Currency;
  account_status: string;
  is_demo: boolean;
  created_at: ISODateTime;
}

export interface Me {
  user: User;
  wallet: WalletBrief | null;
  unread_notifications: number;
}

export interface ProfileUpdateInput {
  full_name?: string;
  phone?: string;
  country?: string;
  base_currency?: string;
}

export interface PasswordChangeInput {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

// ── wallet ──────────────────────────────────────────────────────────────────

export interface WalletCreateInput {
  wallet_name: string;
  base_currency: string;
  country: string;
  accept_terms: boolean;
}

export interface Wallet extends WalletBrief {
  country: string;
  terms_accepted_at: ISODateTime;
  holdings_count: number;
  total_value: DecimalString;
}

export interface Holding {
  currency: Currency;
  quantity: DecimalString;
  average_cost: DecimalString;
  cost_basis: DecimalString;
  latest_rate: DecimalString | null;
  current_value: DecimalString | null;
  unrealized_pnl: DecimalString | null;
  unrealized_pnl_pct: DecimalString | null;
  price_change_24h_pct: DecimalString | null;
  realized_pnl: DecimalString;
  allocation_pct: DecimalString;
  updated_at: ISODateTime;
}

export interface FundDemoInput {
  amount: string;
  currency?: string;
}

export interface Funding {
  funding_id: number;
  reference: string;
  currency: Currency;
  amount: DecimalString;
  funding_type: string;
  base_value: DecimalString;
  rate_to_base: DecimalString;
  note: string | null;
  created_at: ISODateTime;
}

export interface LedgerEntry {
  ledger_id: number;
  currency: Currency;
  entry_type: string;
  direction: "DEBIT" | "CREDIT" | string;
  amount: DecimalString;
  balance_after: DecimalString | null;
  reference: string;
  trade_id: number | null;
  funding_id: number | null;
  created_at: ISODateTime;
}

export interface Activity {
  kind: "TRADE" | "FUNDING" | "QUOTE";
  id: string;
  status: string;
  title: string;
  description: string;
  amount: DecimalString | null;
  currency: string | null;
  occurred_at: ISODateTime;
  link: string | null;
}

// ── portfolio ───────────────────────────────────────────────────────────────

export interface Portfolio {
  base_currency: Currency;
  total_value: DecimalString;
  total_cost_basis: DecimalString;
  total_funded: DecimalString;
  overall_gain: DecimalString;
  overall_gain_pct: DecimalString | null;
  realized_pnl: DecimalString;
  unrealized_pnl: DecimalString;
  daily_change: DecimalString;
  daily_change_pct: DecimalString | null;
  currencies_held: number;
  holdings: Holding[];
  last_market_update: ISODateTime | null;
  market_status: string;
}

export type PerformanceRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
export const PERFORMANCE_RANGES: PerformanceRange[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"];

export interface PerformancePoint {
  time: ISODateTime;
  value: DecimalString;
  invested: DecimalString;
  pnl: DecimalString;
}

export interface Performance {
  range: string;
  base_currency: string;
  points: PerformancePoint[];
}

export interface AllocationSlice {
  currency: Currency;
  value: DecimalString | null;
  allocation_pct: DecimalString;
}

export interface Allocation {
  base_currency: Currency;
  total_value: DecimalString;
  slices: AllocationSlice[];
}

// ── trading ─────────────────────────────────────────────────────────────────

export type AmountType = "SOURCE" | "TARGET";

export interface QuoteInput {
  from_currency: string;
  to_currency: string;
  amount: string;
  amount_type: AmountType;
}

export interface Quote {
  quote_id: string;
  status: string;
  side: string;
  amount_type: AmountType | string;
  pair_id: number;
  pair_symbol: string;
  from_currency: Currency;
  to_currency: Currency;
  from_amount: DecimalString;
  to_amount: DecimalString;
  fee: DecimalString;
  fee_rate: DecimalString;
  fee_currency: string;
  total_debit: DecimalString;
  mid_rate: DecimalString;
  quoted_rate: DecimalString;
  inverse_rate: DecimalString;
  spread: DecimalString;
  rate_recorded_at: ISODateTime;
  rate_freshness: Freshness;
  created_at: ISODateTime;
  expires_at: ISODateTime;
  validity_seconds: number;
  available_balance: DecimalString;
  sufficient_balance: boolean;
}

export interface Pnl {
  currency_id: number;
  quantity_disposed: DecimalString;
  average_cost: DecimalString;
  cost_value: DecimalString;
  realized_value: DecimalString;
  profit_loss: DecimalString;
}

export interface Trade {
  trade_id: number;
  trade_reference: string;
  quote_id: string;
  order_id: number;
  status: string;
  side: "BUY" | "SELL" | string;
  pair_symbol: string;
  from_currency: Currency;
  to_currency: Currency;
  from_amount: DecimalString;
  to_amount: DecimalString;
  executed_rate: DecimalString;
  mid_rate: DecimalString;
  fee: DecimalString;
  fee_currency: string;
  trade_value_base: DecimalString;
  base_currency: string;
  executed_at: ISODateTime;
}

export interface TradeDetail extends Trade {
  ledger_entries: LedgerEntry[];
  pnl: Pnl | null;
  quote_created_at: ISODateTime;
  quote_expires_at: ISODateTime;
  rate_recorded_at: ISODateTime;
}

export interface ExecuteResult {
  trade: TradeDetail;
  replayed: boolean;
  holdings: Holding[];
}

export interface PageOf<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface TradeFilters {
  page?: number;
  page_size?: number;
  currency?: string;
  side?: "BUY" | "SELL" | "";
  status?: "COMPLETED" | "";
  date_from?: string;
  date_to?: string;
}

// ── notifications ───────────────────────────────────────────────────────────

export interface Notification {
  notification_id: number;
  type: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: ISODateTime;
}

export interface NotificationList {
  unread: number;
  items: Notification[];
}

export interface Message {
  message: string;
}

// ── errors ──────────────────────────────────────────────────────────────────

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: unknown };
}
