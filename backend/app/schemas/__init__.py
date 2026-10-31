"""Request/response schemas. Decimal values are serialised as JSON strings to avoid float rounding."""
import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,32}$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}[0-9]$")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _password_strength(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if len(v) > 128:
        raise ValueError("Password must be at most 128 characters long")
    if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
        raise ValueError("Password must contain at least one letter and one number")
    return v


# ── currencies / pairs ────────────────────────────────────────────────────────────────────

class CurrencyOut(ORM):
    currency_id: int
    currency_code: str
    currency_name: str
    currency_symbol: str
    country: str
    decimals: int
    status: str


class PairOut(BaseModel):
    pair_id: int
    symbol: str
    base: CurrencyOut
    quote: CurrencyOut
    status: str
    spread: Decimal
    min_trade_amount: Decimal
    is_featured: bool
    is_favourite: bool = False


class RateOut(PairOut):
    rate: Decimal | None
    previous_rate: Decimal | None
    change: Decimal | None
    change_pct: Decimal | None
    recorded_at: datetime | None
    provider: str | None
    rate_type: str | None
    freshness: str


class MarketStatusOut(BaseModel):
    status: str
    message: str
    fx_session: str
    last_updated_at: datetime | None
    data_as_of: datetime | None
    provider: str | None
    is_simulated: bool
    provider_available: bool
    last_successful_update_at: datetime | None
    update_interval_seconds: int
    server_time: datetime


class HistoryPoint(BaseModel):
    time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    simulated: bool


class HistoryOut(BaseModel):
    pair_id: int
    symbol: str
    display_symbol: str
    inverted: bool
    range: str
    includes_simulated: bool
    points: list[HistoryPoint]


# ── auth / profile ────────────────────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    username: str
    email: EmailStr
    phone: str
    password: str
    confirm_password: str
    country: str = Field(min_length=2, max_length=80)
    base_currency: str = Field(min_length=3, max_length=3)

    @field_validator("full_name", "country")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Must be at least 2 characters")
        return v

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3–32 characters: letters, numbers, '_' or '.'")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if not PHONE_RE.match(v):
            raise ValueError("Enter a valid phone number, e.g. +91 98765 43210")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _password_strength(v)

    @field_validator("base_currency")
    @classmethod
    def _cur(cls, v: str) -> str:
        return v.upper()

    @model_validator(mode="after")
    def _match(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=254, description="Email address or username")
    password: str = Field(min_length=1, max_length=128)


class WalletBrief(ORM):
    wallet_id: int
    wallet_reference: str
    wallet_name: str
    status: str
    created_at: datetime
    base_currency: CurrencyOut


class UserOut(ORM):
    user_id: int
    full_name: str
    username: str
    email: str
    phone: str
    country: str
    base_currency: CurrencyOut
    account_status: str
    is_demo: bool
    created_at: datetime


class MeOut(BaseModel):
    user: UserOut
    wallet: WalletBrief | None
    unread_notifications: int


class ProfileUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    country: str | None = Field(default=None, min_length=2, max_length=80)
    base_currency: str | None = Field(default=None, min_length=3, max_length=3)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is not None and not PHONE_RE.match(v.strip()):
            raise ValueError("Enter a valid phone number, e.g. +91 98765 43210")
        return v.strip() if v else v


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _password_strength(v)

    @model_validator(mode="after")
    def _match(self):
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


# ── wallet ────────────────────────────────────────────────────────────────────────────────

class WalletCreateIn(BaseModel):
    wallet_name: str = Field(min_length=2, max_length=60)
    base_currency: str = Field(min_length=3, max_length=3)
    country: str = Field(min_length=2, max_length=80)
    accept_terms: bool


class WalletOut(WalletBrief):
    country: str
    terms_accepted_at: datetime
    holdings_count: int
    total_value: Decimal


class HoldingOut(BaseModel):
    currency: CurrencyOut
    quantity: Decimal
    average_cost: Decimal
    cost_basis: Decimal
    latest_rate: Decimal | None
    current_value: Decimal | None
    unrealized_pnl: Decimal | None
    unrealized_pnl_pct: Decimal | None
    price_change_24h_pct: Decimal | None
    realized_pnl: Decimal
    allocation_pct: Decimal
    updated_at: datetime


class FundDemoIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=20, decimal_places=8)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class FundingOut(ORM):
    funding_id: int
    reference: str
    currency: CurrencyOut
    amount: Decimal
    funding_type: str
    base_value: Decimal
    rate_to_base: Decimal
    note: str | None
    created_at: datetime


class LedgerOut(ORM):
    ledger_id: int
    currency: CurrencyOut
    entry_type: str
    direction: str
    amount: Decimal
    balance_after: Decimal | None
    reference: str
    trade_id: int | None
    funding_id: int | None
    created_at: datetime


class ActivityOut(BaseModel):
    kind: Literal["TRADE", "FUNDING", "QUOTE"]
    id: str
    status: str
    title: str
    description: str
    amount: Decimal | None
    currency: str | None
    occurred_at: datetime
    link: str | None


# ── portfolio ─────────────────────────────────────────────────────────────────────────────

class PortfolioOut(BaseModel):
    base_currency: CurrencyOut
    total_value: Decimal
    total_cost_basis: Decimal
    total_funded: Decimal
    overall_gain: Decimal
    overall_gain_pct: Decimal | None
    realized_pnl: Decimal
    unrealized_pnl: Decimal
    daily_change: Decimal
    daily_change_pct: Decimal | None
    currencies_held: int
    holdings: list[HoldingOut]
    last_market_update: datetime | None
    market_status: str


class PerformancePoint(BaseModel):
    time: datetime
    value: Decimal
    invested: Decimal
    pnl: Decimal


class PerformanceOut(BaseModel):
    range: str
    base_currency: str
    points: list[PerformancePoint]


class AllocationSlice(BaseModel):
    currency: CurrencyOut
    value: Decimal | None
    allocation_pct: Decimal


class AllocationOut(BaseModel):
    base_currency: CurrencyOut
    total_value: Decimal
    slices: list[AllocationSlice]


# ── trading ───────────────────────────────────────────────────────────────────────────────

class QuoteIn(BaseModel):
    from_currency: str = Field(min_length=3, max_length=3)
    to_currency: str = Field(min_length=3, max_length=3)
    amount: Decimal = Field(gt=0, max_digits=20, decimal_places=8)
    amount_type: Literal["SOURCE", "TARGET"] = Field(
        default="SOURCE", description="SOURCE: amount to spend (sell/exchange). TARGET: amount to receive (buy).")


class QuoteOut(BaseModel):
    quote_id: uuid.UUID
    status: str
    side: str
    amount_type: str
    pair_id: int
    pair_symbol: str
    from_currency: CurrencyOut
    to_currency: CurrencyOut
    from_amount: Decimal
    to_amount: Decimal
    fee: Decimal
    fee_rate: Decimal
    fee_currency: str
    total_debit: Decimal
    mid_rate: Decimal
    quoted_rate: Decimal
    inverse_rate: Decimal
    spread: Decimal
    rate_recorded_at: datetime
    rate_freshness: str
    created_at: datetime
    expires_at: datetime
    validity_seconds: int
    available_balance: Decimal
    sufficient_balance: bool


class ExecuteIn(BaseModel):
    quote_id: uuid.UUID


class PnlOut(ORM):
    currency_id: int
    quantity_disposed: Decimal
    average_cost: Decimal
    cost_value: Decimal
    realized_value: Decimal
    profit_loss: Decimal


class TradeOut(BaseModel):
    trade_id: int
    trade_reference: str
    quote_id: uuid.UUID
    order_id: int
    status: str
    side: str
    pair_symbol: str
    from_currency: CurrencyOut
    to_currency: CurrencyOut
    from_amount: Decimal
    to_amount: Decimal
    executed_rate: Decimal
    mid_rate: Decimal
    fee: Decimal
    fee_currency: str
    trade_value_base: Decimal
    base_currency: str
    executed_at: datetime


class TradeDetailOut(TradeOut):
    ledger_entries: list[LedgerOut]
    pnl: PnlOut | None
    quote_created_at: datetime
    quote_expires_at: datetime
    rate_recorded_at: datetime


class ExecuteOut(BaseModel):
    trade: TradeDetailOut
    replayed: bool
    holdings: list[HoldingOut]


class Page(BaseModel):
    total: int
    page: int
    page_size: int


class TradePage(Page):
    items: list[TradeOut]


class LedgerPage(Page):
    items: list[LedgerOut]


# ── notifications / watchlist ─────────────────────────────────────────────────────────────

class NotificationOut(ORM):
    notification_id: int
    type: str
    severity: str
    title: str
    message: str
    link: str | None
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    unread: int
    items: list[NotificationOut]


class MessageOut(BaseModel):
    message: str
