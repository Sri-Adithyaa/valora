"""Portfolio valuation, performance history and allocation."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import current_wallet
from app.api.serializers import holding_rows
from app.database.session import get_db
from app.models import Wallet
from app.schemas import AllocationOut, CurrencyOut, PerformanceOut, PortfolioOut
from app.services import portfolio as portfolio_svc

router = APIRouter(prefix="/api/portfolio", tags=["Portfolio"])


@router.get("", response_model=PortfolioOut)
def get_portfolio(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    """Holdings with average cost, market value, realized and unrealized P&L (weighted-average cost)."""
    p = portfolio_svc.portfolio(db, wallet)
    return {**p, "base_currency": CurrencyOut.model_validate(p["base_currency"]), "holdings": holding_rows(p["holdings"])}


@router.get("/performance", response_model=PerformanceOut)
def performance(range: str = Query("1M", pattern="^(1D|1W|1M|3M|1Y|ALL)$"), wallet: Wallet = Depends(current_wallet),
                db: Session = Depends(get_db)):
    """Portfolio value over time, rebuilt from the ledger and stored rate history."""
    return portfolio_svc.performance(db, wallet, range)


@router.get("/allocation", response_model=AllocationOut)
def allocation(wallet: Wallet = Depends(current_wallet), db: Session = Depends(get_db)):
    a = portfolio_svc.allocation(db, wallet)
    return {**a, "base_currency": CurrencyOut.model_validate(a["base_currency"]),
            "slices": [{**s, "currency": CurrencyOut.model_validate(s["currency"])} for s in a["slices"]]}
