"""Builders that turn ORM rows into response schemas (keeps routers thin)."""
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import q_rate
from app.models import CurrencyPair, LedgerEntry, PnlTransaction, Trade, TradeQuote
from app.schemas import (
    CurrencyOut, HoldingOut, LedgerOut, PairOut, PnlOut, QuoteOut, TradeDetailOut, TradeOut,
)
from app.services import rates as rates_svc


def pair_out(p: CurrencyPair, favourites: set[int] | None = None) -> dict:
    return PairOut(pair_id=p.pair_id, symbol=p.symbol, base=CurrencyOut.model_validate(p.base_currency),
                   quote=CurrencyOut.model_validate(p.quote_currency), status=p.status, spread=p.spread,
                   min_trade_amount=p.min_trade_amount, is_featured=p.is_featured,
                   is_favourite=bool(favourites and p.pair_id in favourites)).model_dump()


def quote_out(q: TradeQuote, available: Decimal) -> QuoteOut:
    total = q.from_amount + q.fee
    return QuoteOut(
        quote_id=q.quote_id, status=q.status, side=q.side, amount_type=q.amount_type, pair_id=q.pair_id,
        pair_symbol=q.pair.symbol, from_currency=CurrencyOut.model_validate(q.from_currency),
        to_currency=CurrencyOut.model_validate(q.to_currency), from_amount=q.from_amount, to_amount=q.to_amount,
        fee=q.fee, fee_rate=q.fee_rate, fee_currency=q.from_currency.currency_code, total_debit=total,
        mid_rate=q.mid_rate, quoted_rate=q.quoted_rate, inverse_rate=q_rate(Decimal(1) / q.quoted_rate),
        spread=q.spread, rate_recorded_at=q.rate_recorded_at, rate_freshness=rates_svc.freshness(q.rate_recorded_at),
        created_at=q.created_at, expires_at=q.expires_at,
        validity_seconds=int((q.expires_at - q.created_at).total_seconds()),
        available_balance=available, sufficient_balance=available >= total,
    )


def trade_out(t: Trade, base_code: str | None = None) -> dict:
    return TradeOut(
        trade_id=t.trade_id, trade_reference=t.trade_reference, quote_id=t.quote_id, order_id=t.order_id,
        status=t.status, side=t.side, pair_symbol=t.pair.symbol,
        from_currency=CurrencyOut.model_validate(t.from_currency), to_currency=CurrencyOut.model_validate(t.to_currency),
        from_amount=t.from_amount, to_amount=t.to_amount, executed_rate=t.executed_rate, mid_rate=t.mid_rate,
        fee=t.fee, fee_currency=t.fee_currency.currency_code, trade_value_base=t.trade_value_base,
        base_currency=base_code or "", executed_at=t.executed_at,
    ).model_dump()


def trade_detail(db: Session, t: Trade) -> TradeDetailOut:
    from app.models import Currency, TradeQuote as TQ  # local to avoid cycles in type checkers
    base = db.get(Currency, t.base_currency_id)
    quote = db.get(TQ, t.quote_id)
    entries = db.scalars(select(LedgerEntry).where(LedgerEntry.trade_id == t.trade_id)
                         .order_by(LedgerEntry.ledger_id)).unique().all()
    pnl = db.scalars(select(PnlTransaction).where(PnlTransaction.trade_id == t.trade_id)).first()
    return TradeDetailOut(
        **trade_out(t, base.currency_code),
        ledger_entries=[LedgerOut.model_validate(e) for e in entries],
        pnl=PnlOut.model_validate(pnl) if pnl else None,
        quote_created_at=quote.created_at, quote_expires_at=quote.expires_at,
        rate_recorded_at=quote.rate_recorded_at,
    )


def holding_rows(rows: list[dict]) -> list[HoldingOut]:
    return [HoldingOut(**{**r, "currency": CurrencyOut.model_validate(r["currency"])}) for r in rows]
