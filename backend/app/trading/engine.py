"""Trade quotes and atomic trade execution.

Quote → a fixed offer built from one stored rate snapshot, valid for QUOTE_VALIDITY_SECONDS.
Execute → one database transaction that locks the quote and both holdings, re-validates everything,
moves balances through ledger entries, records order/trade/P&L, and commits — or rolls back entirely.

P&L uses the weighted-average-cost method in the wallet's base currency (see docs/pnl_methodology.md).
"""
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, Conflict, Forbidden, NotFound, Unprocessable
from app.core.money import q_amount, q_base, q_down, q_rate, q_up
from app.models import (
    Holding, LedgerEntry, Order, PnlTransaction, Trade, TradeQuote, User, Wallet,
)
from app.services import rates as rates_svc
from app.services.notifications import notify
from app.services.wallet import ensure_holding, weighted_average


class InsufficientBalance(AppError):
    status_code = 422
    code = "insufficient_balance"


class QuoteExpired(AppError):
    status_code = 410
    code = "quote_expired"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trade_reference(at: datetime | None = None) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return f"TRD-{(at or _now()):%y%m%d}-" + "".join(secrets.choice(alphabet) for _ in range(6))


# ── quotes ────────────────────────────────────────────────────────────────────────────────

def create_quote(db: Session, user: User, wallet: Wallet, *, from_code: str, to_code: str, amount: Decimal,
                 amount_type: str = "SOURCE") -> TradeQuote:
    settings = get_settings()
    src = rates_svc.currency_by_code(db, from_code)
    dst = rates_svc.currency_by_code(db, to_code)
    if src.currency_id == dst.currency_id:
        raise Unprocessable("Choose two different currencies.", code="same_currency")
    if amount <= 0:
        raise Unprocessable("Amount must be greater than zero.", code="invalid_amount")

    pair = rates_svc.find_pair(db, src.currency_id, dst.currency_id)
    if pair is None or pair.status != "ACTIVE":
        raise NotFound(f"{src.currency_code}/{dst.currency_code} is not available for trading.",
                       code="pair_not_available")

    snap = rates_svc.latest_snapshot(db, pair.pair_id)
    if snap is None:
        raise rates_svc.MarketDataUnavailable(f"No market rate is available for {pair.symbol} yet.")
    if _now() - snap.as_of > timedelta(hours=settings.max_quote_rate_age_hours):
        raise rates_svc.MarketDataUnavailable(
            f"The latest {pair.symbol} rate is too old to trade on. Trading resumes when market data refreshes.")

    # Orient the stored pair rate to FROM → TO, then apply half the spread against the customer.
    mid = snap.rate if src.currency_id == pair.base_currency_id else Decimal(1) / snap.rate
    mid = q_rate(mid)
    quoted = q_rate(mid * (Decimal(1) - pair.spread / 2))
    side = "BUY" if dst.currency_id == pair.base_currency_id else "SELL"

    if amount_type == "SOURCE":
        if amount != q_amount(amount, src.decimals):
            raise Unprocessable(f"{src.currency_code} supports at most {src.decimals} decimal places.",
                                code="invalid_precision")
        from_amount = amount
        to_amount = q_down(from_amount * quoted, dst.decimals)
    elif amount_type == "TARGET":
        if amount != q_amount(amount, dst.decimals):
            raise Unprocessable(f"{dst.currency_code} supports at most {dst.decimals} decimal places.",
                                code="invalid_precision")
        to_amount = amount
        from_amount = q_up(to_amount / quoted, src.decimals)
    else:
        raise Unprocessable("amount_type must be SOURCE or TARGET.", code="invalid_amount_type")

    if to_amount <= 0 or from_amount <= 0:
        raise Unprocessable("Amount is too small to exchange.", code="amount_too_small")
    base_leg = from_amount if src.currency_id == pair.base_currency_id else to_amount
    if base_leg < pair.min_trade_amount:
        base_code = pair.base_currency.currency_code
        raise Unprocessable(f"Minimum trade for {pair.symbol} is {pair.min_trade_amount.normalize():,} {base_code}.",
                            code="below_minimum")

    fee = q_up(from_amount * settings.trading_fee_rate, src.decimals)
    now = _now()
    quote = TradeQuote(
        quote_id=uuid.uuid4(), user_id=user.user_id, wallet_id=wallet.wallet_id, pair_id=pair.pair_id,
        rate_id=snap.rate_id, side=side, amount_type=amount_type,
        from_currency_id=src.currency_id, to_currency_id=dst.currency_id,
        from_amount=from_amount, to_amount=to_amount, pair_rate=snap.rate, mid_rate=mid, quoted_rate=quoted,
        spread=pair.spread, fee=fee, fee_rate=settings.trading_fee_rate, fee_currency_id=src.currency_id,
        rate_recorded_at=snap.recorded_at, created_at=now,
        expires_at=now + timedelta(seconds=settings.quote_validity_seconds),
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return quote


def available_balance(db: Session, wallet_id: int, currency_id: int) -> Decimal:
    qty = db.scalar(select(Holding.quantity).where(Holding.wallet_id == wallet_id,
                                                   Holding.currency_id == currency_id))
    return qty if qty is not None else Decimal(0)


def expire_stale_quotes(db: Session) -> int:
    """Housekeeping used by the market worker: mark PENDING quotes past expiry as EXPIRED."""
    res = db.execute(update(TradeQuote).where(TradeQuote.status == "PENDING",
                                              TradeQuote.expires_at < _now() - timedelta(seconds=5))
                     .values(status="EXPIRED"))
    db.commit()
    return res.rowcount or 0


# ── execution ─────────────────────────────────────────────────────────────────────────────

def _fail(db: Session, user_id: int, error: AppError, *, notif_type: str, title: str) -> AppError:
    """Roll back the trade transaction, then record the failure notification in its own transaction."""
    db.rollback()
    notify(db, user_id, notif_type, title, error.message, severity="ERROR" if notif_type != "QUOTE_EXPIRED"
           else "WARNING", link="/trade")
    db.commit()
    return error


def execute_quote(db: Session, user: User, quote_id: uuid.UUID, idempotency_key: str | None = None
                  ) -> tuple[Trade, bool]:
    """Settle a quote. Returns (trade, replayed); replayed=True when this request was a safe repeat."""
    # Idempotent replay by key: the same key always maps to the same trade.
    if idempotency_key:
        prior = db.scalars(select(Trade).where(Trade.user_id == user.user_id,
                                               Trade.idempotency_key == idempotency_key)).unique().first()
        if prior is not None:
            if prior.quote_id != quote_id:
                raise Conflict("This Idempotency-Key was already used for a different trade.",
                               code="idempotency_key_reused")
            return prior, True

    try:
        return _execute_locked(db, user, quote_id, idempotency_key)
    except AppError:
        raise
    except DBAPIError as exc:  # constraint/trigger rejected the transaction — nothing was applied
        db.rollback()
        msg = str(exc.orig) if exc.orig else str(exc)
        existing = db.scalars(select(Trade).where(Trade.quote_id == quote_id)).unique().first()
        if existing is not None and existing.user_id == user.user_id:
            return existing, True
        if "quantity_non_negative" in msg:
            raise _fail(db, user.user_id, InsufficientBalance("Insufficient balance for this trade."),
                        notif_type="INSUFFICIENT_BALANCE", title="Trade rejected: insufficient balance") from None
        raise _fail(db, user.user_id, Conflict("The trade could not be settled and was rolled back.",
                                               code="trade_rejected"),
                    notif_type="TRADE_FAILED", title="Trade failed") from None


def _execute_locked(db: Session, user: User, quote_id: uuid.UUID, idempotency_key: str | None
                    ) -> tuple[Trade, bool]:
    # 1–2. Authenticated user (dependency) → their active wallet.
    wallet = db.scalars(select(Wallet).where(Wallet.user_id == user.user_id, Wallet.status == "ACTIVE")
                        ).unique().first()
    if wallet is None:
        raise NotFound("Create your Valora Wallet first.", code="wallet_required")

    # Lock the quote row: concurrent executions of one quote serialise here.
    quote = db.scalars(select(TradeQuote).where(TradeQuote.quote_id == quote_id)
                       .with_for_update(of=TradeQuote)).unique().one_or_none()
    if quote is None or quote.user_id != user.user_id:
        db.rollback()
        raise NotFound("Quote not found.", code="quote_not_found")
    if quote.wallet_id != wallet.wallet_id:
        db.rollback()
        raise Forbidden("This quote belongs to a different wallet.", code="quote_wallet_mismatch")
    if quote.status == "EXECUTED":
        db.rollback()
        trade = db.scalars(select(Trade).where(Trade.quote_id == quote.quote_id)).unique().one()
        return trade, True
    if quote.status != "PENDING":
        db.rollback()
        raise Conflict(f"This quote is {quote.status.lower()}. Request a new quote.", code="quote_not_pending")
    if _now() > quote.expires_at:
        quote.status = "EXPIRED"
        db.commit()
        raise _fail(db, user.user_id, QuoteExpired("Your quote expired before it was confirmed. Request a fresh quote."),
                    notif_type="QUOTE_EXPIRED", title="Quote expired")

    now = _now()
    # 12 (first, so the trade trigger sees an executed quote). The quote trigger re-checks expiry.
    quote.status = "EXECUTED"
    quote.executed_at = now
    db.flush()
    try:
        trade = settle(db, wallet, quote, now, idempotency_key)
    except InsufficientBalance as exc:
        raise _fail(db, user.user_id, exc, notif_type="INSUFFICIENT_BALANCE",
                    title="Trade rejected: insufficient balance") from None

    src, dst = quote.from_currency, quote.to_currency
    notify(db, user.user_id, "TRADE_SUCCESS", f"Trade {trade.trade_reference} completed",
           f"Exchanged {quote.from_amount:,.{src.decimals}f} {src.currency_code} for "
           f"{quote.to_amount:,.{dst.decimals}f} {dst.currency_code} at 1 {src.currency_code} = "
           f"{quote.quoted_rate.normalize()} {dst.currency_code}.", severity="SUCCESS",
           link=f"/transactions/{trade.trade_id}")
    db.commit()  # 13. Deferred triggers verify the ledger balances the trade at this point.
    db.refresh(trade)
    return trade, False


def settle(db: Session, wallet: Wallet, quote: TradeQuote, now: datetime, idempotency_key: str | None = None
           ) -> Trade:
    """Move the money for an EXECUTED quote inside the caller's transaction (no commit).

    Shared by live execution and the seed script, so demo history follows exactly the same rules.
    """
    src_id, dst_id = quote.from_currency_id, quote.to_currency_id
    src = quote.from_currency

    # 3. Lock both holdings in a fixed order (by currency id) so concurrent trades cannot deadlock.
    ensure_holding(db, wallet.wallet_id, dst_id)
    locked = {
        h.currency_id: h for h in db.execute(
            select(Holding.holding_id, Holding.currency_id, Holding.quantity, Holding.average_cost)
            .where(Holding.wallet_id == wallet.wallet_id, Holding.currency_id.in_([src_id, dst_id]))
            .order_by(Holding.currency_id).with_for_update()).all()
    }
    source, target = locked.get(src_id), locked[dst_id]

    # 6–7. Sufficient balance for amount + fee.
    need = quote.from_amount + quote.fee
    have = source.quantity if source else Decimal(0)
    if have < need:
        raise InsufficientBalance(
            f"Insufficient {src.currency_code} balance: this trade needs {need:,.{src.decimals}f} "
            f"(including fee) but {have:,.{src.decimals}f} is available.",
            details={"required": str(need), "available": str(have), "currency": src.currency_code})

    # Value the exchange in the wallet's base currency (weighted-average-cost P&L).
    base_id = wallet.base_currency_id
    if src_id == base_id:
        value_base = quote.from_amount
    elif dst_id == base_id:
        value_base = quote.to_amount
    else:
        book = rates_svc.rate_book(db, at=quote.rate_recorded_at)
        value_base = quote.from_amount * book.require(src_id, base_id)
    value_base = q_base(value_base)
    cost_released = q_base(need * source.average_cost)
    realized = value_base - cost_released
    new_target_avg = (Decimal(1) if dst_id == base_id
                      else weighted_average(target.quantity, target.average_cost, quote.to_amount, value_base))

    order = Order(user_id=quote.user_id, wallet_id=wallet.wallet_id, pair_id=quote.pair_id, quote_id=quote.quote_id,
                  order_type="MARKET", side=quote.side, from_currency_id=src_id, to_currency_id=dst_id,
                  quantity=quote.from_amount, status="FILLED", created_at=now)
    db.add(order)
    db.flush()

    # 10. Trade record with the exact executed rate and amounts.
    trade = Trade(trade_reference=_trade_reference(now), order_id=order.order_id, quote_id=quote.quote_id,
                  user_id=quote.user_id, wallet_id=wallet.wallet_id, pair_id=quote.pair_id, side=quote.side,
                  from_currency_id=src_id, to_currency_id=dst_id, from_amount=quote.from_amount,
                  to_amount=quote.to_amount, executed_rate=quote.quoted_rate, mid_rate=quote.mid_rate,
                  fee=quote.fee, fee_currency_id=quote.fee_currency_id, base_currency_id=base_id,
                  trade_value_base=value_base, idempotency_key=idempotency_key, executed_at=now)
    db.add(trade)
    db.flush()

    # 8–9, 11. Ledger entries; the ledger trigger debits/credits the holdings.
    ref = trade.trade_reference
    common = {"wallet_id": wallet.wallet_id, "trade_id": trade.trade_id, "reference": ref, "created_at": now}
    entries = [LedgerEntry(currency_id=src_id, entry_type="TRADE_DEBIT", direction="DEBIT",
                           amount=quote.from_amount, **common)]
    if quote.fee > 0:
        entries.append(LedgerEntry(currency_id=quote.fee_currency_id, entry_type="FEE_DEBIT", direction="DEBIT",
                                   amount=quote.fee, **common))
    entries.append(LedgerEntry(currency_id=dst_id, entry_type="TRADE_CREDIT", direction="CREDIT",
                               amount=quote.to_amount, **common))
    db.add_all(entries)
    db.flush()

    db.execute(update(Holding).where(Holding.holding_id == target.holding_id).values(average_cost=new_target_avg))
    db.add(PnlTransaction(trade_id=trade.trade_id, wallet_id=wallet.wallet_id, currency_id=src_id,
                          base_currency_id=base_id, quantity_disposed=need, average_cost=source.average_cost,
                          cost_value=cost_released, realized_value=value_base, profit_loss=realized,
                          calculated_at=now))
    db.flush()
    return trade
