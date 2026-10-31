"""Market data: currencies, pairs, latest rates, history and data-freshness status (public endpoints)."""
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import _token_from
from app.api.serializers import pair_out
from app.core.errors import NotFound
from app.core.money import q_rate
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import Currency, CurrencyPair, Watchlist, WatchlistPair
from app.schemas import CurrencyOut, HistoryOut, MarketStatusOut, PairOut, RateOut
from app.services import rates as rates_svc

router = APIRouter(prefix="/api/market", tags=["Market"])


def _favourites(request: Request, db: Session) -> set[int]:
    """Favourite pair ids for the caller, if logged in (market endpoints are otherwise public)."""
    token = _token_from(request)
    claims = decode_access_token(token) if token else None
    if not claims:
        return set()
    return set(db.scalars(select(WatchlistPair.pair_id).join(Watchlist)
                          .where(Watchlist.user_id == int(claims["sub"]))).all())


def _matches(p: CurrencyPair, term: str) -> bool:
    term = term.strip().lower().replace(" ", "")
    if not term:
        return True
    hay = [p.symbol.lower(), p.symbol.replace("/", "").lower()]
    for c in (p.base_currency, p.quote_currency):
        hay += [c.currency_code.lower(), c.currency_name.lower().replace(" ", ""), c.country.lower().replace(" ", "")]
    return any(term in h for h in hay)


@router.get("/currencies", response_model=list[CurrencyOut])
def currencies(include_inactive: bool = False, db: Session = Depends(get_db)):
    stmt = select(Currency).order_by(Currency.display_order, Currency.currency_code)
    if not include_inactive:
        stmt = stmt.where(Currency.status == "ACTIVE")
    return [CurrencyOut.model_validate(c) for c in db.scalars(stmt)]


@router.get("/pairs", response_model=list[PairOut])
def pairs(request: Request, search: str | None = Query(None, max_length=40,
                                                       description="Code, currency name or country (e.g. 'euro')"),
          featured: bool = False, currency: str | None = Query(None, min_length=3, max_length=3),
          db: Session = Depends(get_db)):
    fav = _favourites(request, db)
    out = []
    for p in rates_svc.active_pairs(db):
        if featured and not p.is_featured:
            continue
        if currency and currency.upper() not in (p.base_currency.currency_code, p.quote_currency.currency_code):
            continue
        if search and not _matches(p, search):
            continue
        out.append(pair_out(p, fav))
    return out


@router.get("/rates", response_model=list[RateOut])
def rates(request: Request, search: str | None = Query(None, max_length=40), featured: bool = False,
          db: Session = Depends(get_db)):
    """Latest stored rate per pair with the change versus 24 hours earlier."""
    fav = _favourites(request, db)
    now_snaps = rates_svc.snapshots_at(db)
    prev_snaps = rates_svc.snapshots_at(db, rates_svc.utcnow() - timedelta(hours=24))
    out = []
    for p in rates_svc.active_pairs(db):
        if featured and not p.is_featured:
            continue
        if search and not _matches(p, search):
            continue
        s = now_snaps.get(p.pair_id)
        prev = prev_snaps.get(p.pair_id)
        change = change_pct = None
        if s and prev:
            change = q_rate(s.rate - prev.rate)
            change_pct = ((s.rate - prev.rate) / prev.rate * 100).quantize(Decimal("0.001"))
        out.append(RateOut(**pair_out(p, fav), rate=s.rate if s else None, previous_rate=prev.rate if prev else None,
                           change=change, change_pct=change_pct, recorded_at=s.recorded_at if s else None,
                           provider=s.provider if s else None, rate_type=s.rate_type if s else None,
                           freshness=rates_svc.freshness(s.as_of if s else None)))
    return out


@router.get("/pairs/lookup", response_model=PairOut)
def lookup(request: Request, from_currency: str = Query(..., alias="from", min_length=3, max_length=3),
           to_currency: str = Query(..., alias="to", min_length=3, max_length=3), db: Session = Depends(get_db)):
    """Find the pair that trades FROM → TO, regardless of which side is the pair's base."""
    a = rates_svc.currency_by_code(db, from_currency)
    b = rates_svc.currency_by_code(db, to_currency)
    p = rates_svc.find_pair(db, a.currency_id, b.currency_id)
    if p is None or p.status != "ACTIVE":
        raise NotFound(f"{a.currency_code}/{b.currency_code} is not available.", code="pair_not_available")
    return pair_out(p, _favourites(request, db))


@router.get("/pairs/{pair_id}/history", response_model=HistoryOut)
def pair_history(pair_id: int, range: str = Query("1D", pattern="^(1H|6H|1D|1W|1M|3M|1Y)$"),
                 invert: bool = Query(False, description="Return QUOTE/BASE instead of BASE/QUOTE"),
                 db: Session = Depends(get_db)):
    """Bucketed OHLC history from stored snapshots. `simulated` marks buckets containing demo data."""
    p = db.get(CurrencyPair, pair_id)
    if p is None:
        raise NotFound("Currency pair not found.", code="pair_not_found")
    points = rates_svc.history(db, pair_id, range, invert)
    display = (f"{p.quote_currency.currency_code}/{p.base_currency.currency_code}" if invert else p.symbol)
    return HistoryOut(pair_id=pair_id, symbol=p.symbol, display_symbol=display, inverted=invert, range=range,
                      includes_simulated=any(pt["simulated"] for pt in points), points=points)


@router.get("/status", response_model=MarketStatusOut)
def status(db: Session = Depends(get_db)):
    """Is market data Live, Delayed or Stale? Rates refresh every 1–2 minutes, never tick-by-tick."""
    return rates_svc.market_status(db)
