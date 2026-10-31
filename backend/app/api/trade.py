"""Quotes, execution and trade history."""
import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, current_wallet
from app.api.serializers import holding_rows, quote_out, trade_detail, trade_out
from app.core.errors import NotFound
from app.core.ratelimit import limiter
from app.database.session import get_db
from app.models import Currency, Trade, TradeQuote, User, Wallet
from app.schemas import ExecuteIn, ExecuteOut, QuoteIn, QuoteOut, TradeDetailOut, TradePage
from app.services import portfolio as portfolio_svc
from app.services.rates import currency_by_code
from app.trading import engine

router = APIRouter(prefix="/api/trade", tags=["Trading"])


@router.post("/quote", response_model=QuoteOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(limiter("quote", "trade_rate_limit"))])
def create_quote(body: QuoteIn, user: User = Depends(current_user), wallet: Wallet = Depends(current_wallet),
                 db: Session = Depends(get_db)):
    """Lock a rate for QUOTE_VALIDITY_SECONDS. All amounts are computed server-side."""
    q = engine.create_quote(db, user, wallet, from_code=body.from_currency, to_code=body.to_currency,
                            amount=body.amount, amount_type=body.amount_type)
    return quote_out(q, engine.available_balance(db, wallet.wallet_id, q.from_currency_id))


@router.get("/quote/{quote_id}", response_model=QuoteOut)
def get_quote(quote_id: uuid.UUID, user: User = Depends(current_user), wallet: Wallet = Depends(current_wallet),
              db: Session = Depends(get_db)):
    q = db.get(TradeQuote, quote_id)
    if q is None or q.user_id != user.user_id:
        raise NotFound("Quote not found.", code="quote_not_found")
    return quote_out(q, engine.available_balance(db, wallet.wallet_id, q.from_currency_id))


@router.post("/execute", response_model=ExecuteOut,
             dependencies=[Depends(limiter("execute", "trade_rate_limit"))],
             responses={200: {"description": "Idempotent replay of an already-settled quote"},
                        201: {"description": "Trade executed"}})
def execute(body: ExecuteIn, response: Response, user: User = Depends(current_user),
            wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db),
            idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=64)):
    """Settle a quote atomically. Repeating the request (same quote or same Idempotency-Key) never
    executes twice — it returns the original trade with `replayed: true`."""
    trade, replayed = engine.execute_quote(db, user, body.quote_id, idempotency_key)
    response.status_code = status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
    holdings = holding_rows(portfolio_svc.portfolio(db, wallet)["holdings"])
    return ExecuteOut(trade=trade_detail(db, trade), replayed=replayed, holdings=holdings)


@router.get("/history", response_model=TradePage)
def history(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
            currency: str | None = Query(None, min_length=3, max_length=3),
            side: str | None = Query(None, pattern="^(BUY|SELL)$"),
            status_: str | None = Query(None, alias="status", pattern="^(COMPLETED)$"),
            date_from: date | None = None, date_to: date | None = None,
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The caller's executed trades, newest first, with filters."""
    cond = [Trade.user_id == user.user_id]
    if currency:
        cid = currency_by_code(db, currency, active_only=False).currency_id
        cond.append(or_(Trade.from_currency_id == cid, Trade.to_currency_id == cid))
    if side:
        cond.append(Trade.side == side)
    if status_:
        cond.append(Trade.status == status_)
    if date_from:
        cond.append(Trade.executed_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        cond.append(Trade.executed_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))
    total = db.scalar(select(func.count()).select_from(Trade).where(*cond))
    rows = db.scalars(select(Trade).where(*cond).order_by(Trade.executed_at.desc(), Trade.trade_id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).unique().all()
    codes = dict(db.execute(select(Currency.currency_id, Currency.currency_code)).all())
    return TradePage(total=total, page=page, page_size=page_size,
                     items=[trade_out(t, codes.get(t.base_currency_id)) for t in rows])


@router.get("/{trade_id}", response_model=TradeDetailOut)
def get_trade(trade_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Full trade detail with its ledger entries and realized P&L."""
    t = db.get(Trade, trade_id)
    if t is None or t.user_id != user.user_id:  # never reveal other users' trades
        raise NotFound("Trade not found.", code="trade_not_found")
    return trade_detail(db, t)
