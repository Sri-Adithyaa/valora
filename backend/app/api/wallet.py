"""Wallet creation, holdings, summary, virtual funding, ledger and activity feed."""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, current_wallet
from app.api.serializers import holding_rows
from app.core.ratelimit import limiter
from app.database.session import get_db
from app.models import LedgerEntry, Trade, TradeQuote, User, Wallet, WalletFunding
from app.schemas import (
    ActivityOut, CurrencyOut, FundDemoIn, FundingOut, HoldingOut, LedgerOut, LedgerPage, PortfolioOut, WalletCreateIn,
    WalletOut,
)
from app.services import portfolio as portfolio_svc
from app.services import wallet as wallet_svc

router = APIRouter(prefix="/api/wallet", tags=["Wallet"])


def _wallet_out(db: Session, wallet: Wallet) -> WalletOut:
    p = portfolio_svc.portfolio(db, wallet)
    return WalletOut(wallet_id=wallet.wallet_id, wallet_reference=wallet.wallet_reference,
                     wallet_name=wallet.wallet_name, status=wallet.status, created_at=wallet.created_at,
                     base_currency=CurrencyOut.model_validate(wallet.base_currency), country=wallet.country,
                     terms_accepted_at=wallet.terms_accepted_at, holdings_count=p["currencies_held"],
                     total_value=p["total_value"])


@router.post("/create", response_model=WalletOut, status_code=status.HTTP_201_CREATED)
def create_wallet(body: WalletCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Open the user's single active Valora Wallet and credit the configured virtual starting balance."""
    wallet = wallet_svc.create_wallet(db, user, wallet_name=body.wallet_name, base_currency=body.base_currency,
                                      country=body.country, accept_terms=body.accept_terms)
    db.refresh(wallet)
    return _wallet_out(db, wallet)


@router.get("", response_model=WalletOut)
def get_wallet(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    return _wallet_out(db, wallet)


@router.get("/holdings", response_model=list[HoldingOut])
def get_holdings(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    """Every non-zero currency holding in the wallet, valued in the wallet's base currency."""
    return holding_rows(portfolio_svc.portfolio(db, wallet)["holdings"])


@router.get("/summary", response_model=PortfolioOut)
def get_summary(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    p = portfolio_svc.portfolio(db, wallet)
    return {**p, "base_currency": CurrencyOut.model_validate(p["base_currency"]), "holdings": holding_rows(p["holdings"])}


@router.post("/fund-demo", response_model=FundingOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(limiter("fund", "trade_rate_limit"))])
def fund_demo(body: FundDemoIn, user: User = Depends(current_user), wallet: Wallet = Depends(current_wallet),
              db: Session = Depends(get_db)):
    """Add **virtual** demo credit (no real money). Limited per request and per day; recorded in the ledger."""
    funding = wallet_svc.fund_demo(db, user, wallet, body.amount, body.currency)
    db.refresh(funding)
    return FundingOut.model_validate(funding)


@router.get("/fundings", response_model=list[FundingOut])
def list_fundings(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    rows = db.scalars(select(WalletFunding).where(WalletFunding.wallet_id == wallet.wallet_id)
                      .order_by(WalletFunding.created_at.desc())).unique().all()
    return [FundingOut.model_validate(r) for r in rows]


@router.get("/ledger", response_model=LedgerPage)
def ledger(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
           currency: str | None = Query(None, min_length=3, max_length=3),
           wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    """The wallet's immutable debit/credit audit trail."""
    cond = [LedgerEntry.wallet_id == wallet.wallet_id]
    if currency:
        from app.services.rates import currency_by_code
        cond.append(LedgerEntry.currency_id == currency_by_code(db, currency, active_only=False).currency_id)
    total = db.scalar(select(func.count()).select_from(LedgerEntry).where(*cond))
    rows = db.scalars(select(LedgerEntry).where(*cond).order_by(LedgerEntry.created_at.desc(),
                                                               LedgerEntry.ledger_id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).unique().all()
    return LedgerPage(total=total, page=page, page_size=page_size, items=[LedgerOut.model_validate(r) for r in rows])


@router.get("/activity", response_model=list[ActivityOut])
def activity(limit: int = Query(15, ge=1, le=50), wallet: Wallet = Depends(current_wallet),
             db: Session = Depends(get_db)):
    """Recent trades, virtual funding and expired/cancelled quotes, newest first."""
    items: list[ActivityOut] = []
    for t in db.scalars(select(Trade).where(Trade.wallet_id == wallet.wallet_id)
                        .order_by(Trade.executed_at.desc()).limit(limit)).unique():
        verb = "Bought" if t.side == "BUY" else "Sold"
        held = t.to_currency if t.side == "BUY" else t.from_currency
        items.append(ActivityOut(
            kind="TRADE", id=t.trade_reference, status=t.status,
            title=f"{verb} {held.currency_code} · {t.pair.symbol}",
            description=f"{t.from_amount:,.{t.from_currency.decimals}f} {t.from_currency.currency_code} → "
                        f"{t.to_amount:,.{t.to_currency.decimals}f} {t.to_currency.currency_code}",
            amount=t.to_amount, currency=t.to_currency.currency_code, occurred_at=t.executed_at,
            link=f"/transactions/{t.trade_id}"))
    for f in db.scalars(select(WalletFunding).where(WalletFunding.wallet_id == wallet.wallet_id)
                        .order_by(WalletFunding.created_at.desc()).limit(limit)).unique():
        label = "Initial virtual balance" if f.funding_type == "INITIAL" else "Demo credit"
        items.append(ActivityOut(
            kind="FUNDING", id=f.reference, status="COMPLETED", title=label,
            description=f"Virtual funds credited · {f.reference}", amount=f.amount,
            currency=f.currency.currency_code, occurred_at=f.created_at, link=None))
    for q in db.scalars(select(TradeQuote).where(TradeQuote.wallet_id == wallet.wallet_id,
                                                 TradeQuote.status.in_(["EXPIRED", "CANCELLED"]))
                        .order_by(TradeQuote.created_at.desc()).limit(limit)).unique():
        items.append(ActivityOut(
            kind="QUOTE", id=str(q.quote_id)[:8].upper(), status=q.status,
            title=f"Quote {q.status.lower()} · {q.from_currency.currency_code} → {q.to_currency.currency_code}",
            description=f"{q.from_amount:,.{q.from_currency.decimals}f} {q.from_currency.currency_code} "
                        f"at {q.quoted_rate.normalize()} — not executed",
            amount=q.from_amount, currency=q.from_currency.currency_code, occurred_at=q.expires_at, link="/trade"))
    items.sort(key=lambda a: a.occurred_at, reverse=True)
    return items[:limit]
