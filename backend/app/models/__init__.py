"""SQLAlchemy models for every Valora table.

Money columns are NUMERIC (never FLOAT), timestamps are TIMESTAMPTZ. The rules that must never be
broken (non-negative holdings, append-only rates, immutable ledger, one active wallet per user) are
enforced inside PostgreSQL by constraints and triggers — see migrations/versions/0001_initial.py.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger,
    String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

AMOUNT = Numeric(24, 8)
RATE = Numeric(24, 10)
COST = Numeric(28, 10)
BASEVAL = Numeric(24, 4)


def _now():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Currency(Base):
    __tablename__ = "currency"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','INACTIVE')", name="status_valid"),
        CheckConstraint("currency_code ~ '^[A-Z]{3}$'", name="code_format"),
        CheckConstraint("decimals BETWEEN 0 AND 8", name="decimals_range"),
    )

    currency_id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    currency_code: Mapped[str] = mapped_column(String(3), unique=True, nullable=False)
    currency_name: Mapped[str] = mapped_column(String(60), nullable=False)
    currency_symbol: Mapped[str] = mapped_column(String(8), nullable=False)
    country: Mapped[str] = mapped_column(String(80), nullable=False)
    decimals: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="2")
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="100")
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="ACTIVE")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("account_status IN ('ACTIVE','SUSPENDED','CLOSED')", name="status_valid"),
        Index("uq_users_email_lower", text("lower(email)"), unique=True),
        Index("uq_users_username_lower", text("lower(username)"), unique=True),
    )

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str] = mapped_column(String(80), nullable=False)
    base_currency_id: Mapped[int] = mapped_column(
        ForeignKey("currency.currency_id", ondelete="RESTRICT"), nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    account_status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="ACTIVE")

    base_currency: Mapped[Currency] = relationship(lazy="joined")


class UserSession(Base):
    __tablename__ = "user_session"

    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False,
                                         index=True)
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))


class Wallet(Base):
    __tablename__ = "wallet"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','FROZEN','CLOSED')", name="status_valid"),
        # One active primary wallet per user (initial version).
        Index("uq_wallet_one_active_per_user", "user_id", unique=True,
              postgresql_where=text("status = 'ACTIVE'")),
    )

    wallet_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    wallet_reference: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    wallet_name: Mapped[str] = mapped_column(String(60), nullable=False)
    base_currency_id: Mapped[int] = mapped_column(
        ForeignKey("currency.currency_id", ondelete="RESTRICT"), nullable=False)
    country: Mapped[str] = mapped_column(String(80), nullable=False)
    terms_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _now()
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="ACTIVE")

    base_currency: Mapped[Currency] = relationship(lazy="joined")


class Holding(Base):
    __tablename__ = "holding"
    __table_args__ = (
        UniqueConstraint("wallet_id", "currency_id", name="uq_holding_wallet_currency"),
        CheckConstraint("quantity >= 0", name="quantity_non_negative"),
        CheckConstraint("average_cost >= 0", name="average_cost_non_negative"),
    )

    holding_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                             nullable=False)
    quantity: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False, server_default="0")
    # Weighted-average acquisition cost per unit, expressed in the wallet's base currency.
    average_cost: Mapped[Decimal] = mapped_column(COST, nullable=False, server_default="0")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()

    currency: Mapped[Currency] = relationship(lazy="joined")


class CurrencyPair(Base):
    __tablename__ = "currency_pair"
    __table_args__ = (
        CheckConstraint("base_currency_id <> quote_currency_id", name="distinct_currencies"),
        CheckConstraint("status IN ('ACTIVE','INACTIVE')", name="status_valid"),
        CheckConstraint("spread >= 0 AND spread < 0.05", name="spread_range"),
        CheckConstraint("min_trade_amount > 0", name="min_trade_positive"),
        UniqueConstraint("base_currency_id", "quote_currency_id", name="uq_pair_base_quote"),
        # Reject USD/EUR and EUR/USD both existing.
        Index("uq_pair_unordered", text("LEAST(base_currency_id, quote_currency_id)"),
              text("GREATEST(base_currency_id, quote_currency_id)"), unique=True),
    )

    pair_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    base_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    quote_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                   nullable=False)
    symbol: Mapped[str] = mapped_column(String(7), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="ACTIVE")
    # Minimum trade, in units of the pair's base currency.
    min_trade_amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False, server_default="1")
    # Fractional spread applied around the mid rate (0.001 = 0.10%).
    spread: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False, server_default="0.001")
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="100")

    base_currency: Mapped[Currency] = relationship(foreign_keys=[base_currency_id], lazy="joined")
    quote_currency: Mapped[Currency] = relationship(foreign_keys=[quote_currency_id], lazy="joined")


class ExchangeRate(Base):
    """Append-only history of rate snapshots: 1 BASE = rate QUOTE."""
    __tablename__ = "exchange_rate"
    __table_args__ = (
        CheckConstraint("rate > 0", name="rate_positive"),
        CheckConstraint("rate_type IN ('LIVE','SIMULATED_SEED','SIMULATED')", name="rate_type_valid"),
        UniqueConstraint("pair_id", "recorded_at", "provider", name="uq_rate_pair_time_provider"),
        Index("ix_exchange_rate_pair_time", "pair_id", text("recorded_at DESC")),
    )

    rate_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("currency_pair.pair_id", ondelete="RESTRICT"),
                                         nullable=False)
    rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    rate_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="LIVE")


class RateProviderLog(Base):
    __tablename__ = "rate_provider_log"
    __table_args__ = (
        CheckConstraint("status IN ('SUCCESS','PARTIAL','FAILED','SKIPPED')", name="status_valid"),
        Index("ix_rate_provider_log_started", text("started_at DESC")),
    )

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider: Mapped[str | None] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    pairs_updated: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    pairs_rejected: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    source_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    message: Mapped[str | None] = mapped_column(Text)


class WalletFunding(Base):
    __tablename__ = "wallet_funding"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("funding_type IN ('INITIAL','DEMO_CREDIT','SEED')", name="type_valid"),
        Index("ix_wallet_funding_wallet_time", "wallet_id", text("created_at DESC")),
    )

    funding_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                             nullable=False)
    amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    funding_type: Mapped[str] = mapped_column(String(12), nullable=False)
    rate_to_base: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    base_value: Mapped[Decimal] = mapped_column(BASEVAL, nullable=False)
    reference: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _now()

    currency: Mapped[Currency] = relationship(lazy="joined")


class TradeQuote(Base):
    __tablename__ = "trade_quote"
    __table_args__ = (
        CheckConstraint("from_currency_id <> to_currency_id", name="distinct_currencies"),
        CheckConstraint("from_amount > 0 AND to_amount > 0 AND fee >= 0", name="amounts_valid"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        CheckConstraint("status IN ('PENDING','EXECUTED','EXPIRED','CANCELLED')", name="status_valid"),
        CheckConstraint("side IN ('BUY','SELL')", name="side_valid"),
        CheckConstraint("amount_type IN ('SOURCE','TARGET')", name="amount_type_valid"),
        Index("ix_trade_quote_user_time", "user_id", text("created_at DESC")),
        Index("ix_trade_quote_pending_expiry", "expires_at", postgresql_where=text("status = 'PENDING'")),
    )

    quote_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    pair_id: Mapped[int] = mapped_column(ForeignKey("currency_pair.pair_id", ondelete="RESTRICT"),
                                         nullable=False)
    rate_id: Mapped[int] = mapped_column(ForeignKey("exchange_rate.rate_id", ondelete="RESTRICT"),
                                         nullable=False)
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    amount_type: Mapped[str] = mapped_column(String(6), nullable=False)
    from_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    to_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                nullable=False)
    from_amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    to_amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    pair_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)      # snapshot, pair orientation
    mid_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)       # 1 FROM = mid TO
    quoted_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)    # 1 FROM = quoted TO (after spread)
    spread: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False)
    fee: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    fee_rate: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False)
    fee_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                 nullable=False)
    rate_recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="PENDING")
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    pair: Mapped[CurrencyPair] = relationship(lazy="joined")
    from_currency: Mapped[Currency] = relationship(foreign_keys=[from_currency_id], lazy="joined")
    to_currency: Mapped[Currency] = relationship(foreign_keys=[to_currency_id], lazy="joined")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("order_type IN ('MARKET','LIMIT')", name="type_valid"),
        CheckConstraint("side IN ('BUY','SELL')", name="side_valid"),
        CheckConstraint("status IN ('PENDING','FILLED','CANCELLED','REJECTED')", name="status_valid"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        Index("ix_orders_user_time", "user_id", text("created_at DESC")),
    )

    order_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    pair_id: Mapped[int] = mapped_column(ForeignKey("currency_pair.pair_id", ondelete="RESTRICT"),
                                         nullable=False)
    quote_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("trade_quote.quote_id", ondelete="RESTRICT"), unique=True)
    order_type: Mapped[str] = mapped_column(String(6), nullable=False, server_default="MARKET")
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    from_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    to_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                nullable=False)
    quantity: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)  # source amount
    target_rate: Mapped[Decimal | None] = mapped_column(RATE)          # reserved for future limit orders
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = _now()


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        CheckConstraint("from_currency_id <> to_currency_id", name="distinct_currencies"),
        CheckConstraint("from_amount > 0 AND to_amount > 0 AND fee >= 0", name="amounts_valid"),
        CheckConstraint("executed_rate > 0", name="rate_positive"),
        CheckConstraint("side IN ('BUY','SELL')", name="side_valid"),
        CheckConstraint("status IN ('COMPLETED')", name="status_valid"),
        UniqueConstraint("user_id", "idempotency_key", name="uq_trades_user_idempotency"),
        Index("ix_trades_user_time", "user_id", text("executed_at DESC")),
        Index("ix_trades_wallet_time", "wallet_id", text("executed_at DESC")),
    )

    trade_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trade_reference: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.order_id", ondelete="RESTRICT"), unique=True,
                                          nullable=False)
    # UNIQUE: a quote can settle at most once (double-execution guard).
    quote_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trade_quote.quote_id", ondelete="RESTRICT"),
                                                unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    pair_id: Mapped[int] = mapped_column(ForeignKey("currency_pair.pair_id", ondelete="RESTRICT"),
                                         nullable=False)
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    from_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    to_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                nullable=False)
    from_amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    to_amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    executed_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)  # 1 FROM = executed TO
    mid_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    fee: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    fee_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                 nullable=False)
    base_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    trade_value_base: Mapped[Decimal] = mapped_column(BASEVAL, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    executed_at: Mapped[datetime] = _now()
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="COMPLETED")

    pair: Mapped[CurrencyPair] = relationship(lazy="joined")
    from_currency: Mapped[Currency] = relationship(foreign_keys=[from_currency_id], lazy="joined")
    to_currency: Mapped[Currency] = relationship(foreign_keys=[to_currency_id], lazy="joined")
    fee_currency: Mapped[Currency] = relationship(foreign_keys=[fee_currency_id], lazy="joined")


class LedgerEntry(Base):
    """Immutable audit trail. Inserting an entry moves the holding balance (via trigger)."""
    __tablename__ = "ledger_entry"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("direction IN ('DEBIT','CREDIT')", name="direction_valid"),
        CheckConstraint(
            "entry_type IN ('FUNDING_CREDIT','TRADE_DEBIT','TRADE_CREDIT','FEE_DEBIT')", name="type_valid"),
        CheckConstraint("num_nonnulls(trade_id, funding_id) = 1", name="single_source"),
        CheckConstraint(
            "(entry_type IN ('FUNDING_CREDIT','TRADE_CREDIT') AND direction = 'CREDIT') OR "
            "(entry_type IN ('TRADE_DEBIT','FEE_DEBIT') AND direction = 'DEBIT')", name="type_direction"),
        Index("ix_ledger_entry_wallet_time", "wallet_id", text("created_at DESC")),
        Index("ix_ledger_entry_trade", "trade_id"),
        Index("ix_ledger_entry_funding", "funding_id"),
    )

    ledger_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                             nullable=False)
    holding_id: Mapped[int | None] = mapped_column(ForeignKey("holding.holding_id", ondelete="RESTRICT"))
    trade_id: Mapped[int | None] = mapped_column(ForeignKey("trades.trade_id", ondelete="RESTRICT"))
    funding_id: Mapped[int | None] = mapped_column(ForeignKey("wallet_funding.funding_id", ondelete="RESTRICT"))
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    direction: Mapped[str] = mapped_column(String(6), nullable=False)
    amount: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)
    balance_after: Mapped[Decimal | None] = mapped_column(AMOUNT)  # set by trigger
    reference: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = _now()

    currency: Mapped[Currency] = relationship(lazy="joined")


class PnlTransaction(Base):
    """Realized P&L booked when a currency is sold/exchanged (weighted-average cost method)."""
    __tablename__ = "pnl_transaction"
    __table_args__ = (
        CheckConstraint("quantity_disposed > 0", name="quantity_positive"),
        Index("ix_pnl_wallet_time", "wallet_id", text("calculated_at DESC")),
    )

    pnl_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trade_id: Mapped[int] = mapped_column(ForeignKey("trades.trade_id", ondelete="RESTRICT"), unique=True,
                                          nullable=False)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallet.wallet_id", ondelete="RESTRICT"), nullable=False)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                             nullable=False)
    base_currency_id: Mapped[int] = mapped_column(ForeignKey("currency.currency_id", ondelete="RESTRICT"),
                                                  nullable=False)
    quantity_disposed: Mapped[Decimal] = mapped_column(AMOUNT, nullable=False)   # amount + fee
    average_cost: Mapped[Decimal] = mapped_column(COST, nullable=False)
    cost_value: Mapped[Decimal] = mapped_column(BASEVAL, nullable=False)          # qty × avg cost
    realized_value: Mapped[Decimal] = mapped_column(BASEVAL, nullable=False)      # proceeds in base
    profit_loss: Mapped[Decimal] = mapped_column(BASEVAL, nullable=False)
    calculated_at: Mapped[datetime] = _now()


class Watchlist(Base):
    __tablename__ = "watchlist"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_watchlist_user_name"),)

    watchlist_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False, server_default="Favourites")
    created_at: Mapped[datetime] = _now()


class WatchlistPair(Base):
    __tablename__ = "watchlist_pair"

    watchlist_id: Mapped[int] = mapped_column(ForeignKey("watchlist.watchlist_id", ondelete="CASCADE"),
                                              primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("currency_pair.pair_id", ondelete="CASCADE"),
                                         primary_key=True)
    added_at: Mapped[datetime] = _now()


class Notification(Base):
    __tablename__ = "notification"
    __table_args__ = (
        CheckConstraint(
            "type IN ('TRADE_SUCCESS','TRADE_FAILED','QUOTE_EXPIRED','INSUFFICIENT_BALANCE',"
            "'WALLET_ACTIVATED','FUNDING','MARKET_DATA_UNAVAILABLE','MARKET_DATA_RESTORED','SECURITY')",
            name="type_valid"),
        CheckConstraint("severity IN ('INFO','SUCCESS','WARNING','ERROR')", name="severity_valid"),
        Index("ix_notification_user_time", "user_id", text("created_at DESC")),
    )

    notification_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), nullable=False, server_default="INFO")
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    link: Mapped[str | None] = mapped_column(String(200))
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = _now()
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
