"""Reading exchange rates: latest snapshots, conversions, history buckets and market status."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.money import q_rate
from app.models import Currency, CurrencyPair, RateProviderLog


class MarketDataUnavailable(AppError):
    status_code = 503
    code = "market_data_unavailable"


@dataclass(frozen=True)
class RateSnapshot:
    rate_id: int
    pair_id: int
    rate: Decimal
    recorded_at: datetime
    source_timestamp: datetime | None
    provider: str
    rate_type: str

    @property
    def as_of(self) -> datetime:
        """When the provider says the data is from (falls back to when we stored it)."""
        return self.source_timestamp or self.recorded_at


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


_SNAPSHOT_SQL = """
    SELECT DISTINCT ON (pair_id) rate_id, pair_id, rate, recorded_at, source_timestamp, provider, rate_type
      FROM exchange_rate
     WHERE recorded_at <= :at {pair_filter}
  ORDER BY pair_id, recorded_at DESC, rate_id DESC
"""


def snapshots_at(db: Session, at: datetime | None = None, pair_ids: list[int] | None = None
                 ) -> dict[int, RateSnapshot]:
    """Latest snapshot per pair as of `at` (default: now)."""
    params = {"at": at or utcnow() + timedelta(seconds=5)}
    pair_filter = ""
    if pair_ids is not None:
        if not pair_ids:
            return {}
        pair_filter = "AND pair_id = ANY(:ids)"
        params["ids"] = pair_ids
    rows = db.execute(text(_SNAPSHOT_SQL.format(pair_filter=pair_filter)), params).all()
    return {r.pair_id: RateSnapshot(*r) for r in rows}


def latest_snapshot(db: Session, pair_id: int) -> RateSnapshot | None:
    return snapshots_at(db, None, [pair_id]).get(pair_id)


class RateBook:
    """Converts between any two currencies using one consistent set of pair snapshots."""

    def __init__(self, pairs: list[CurrencyPair], snaps: dict[int, RateSnapshot]):
        self._direct: dict[tuple[int, int], Decimal] = {}
        self.snaps = snaps
        for p in pairs:
            s = snaps.get(p.pair_id)
            if s is None:
                continue
            self._direct[(p.base_currency_id, p.quote_currency_id)] = s.rate
            self._direct[(p.quote_currency_id, p.base_currency_id)] = Decimal(1) / s.rate
        self._ids = {c for k in self._direct for c in k}

    def rate(self, from_id: int, to_id: int) -> Decimal | None:
        if from_id == to_id:
            return Decimal(1)
        direct = self._direct.get((from_id, to_id))
        if direct is not None:
            return q_rate(direct)
        for via in self._ids:  # one-hop cross rate
            a = self._direct.get((from_id, via))
            b = self._direct.get((via, to_id))
            if a is not None and b is not None:
                return q_rate(a * b)
        return None

    def require(self, from_id: int, to_id: int) -> Decimal:
        r = self.rate(from_id, to_id)
        if r is None:
            raise MarketDataUnavailable("No exchange rate is available for this conversion yet.")
        return r


def active_pairs(db: Session) -> list[CurrencyPair]:
    return list(db.scalars(select(CurrencyPair).where(CurrencyPair.status == "ACTIVE")
                           .order_by(CurrencyPair.display_order, CurrencyPair.symbol)).unique())


def rate_book(db: Session, at: datetime | None = None) -> RateBook:
    pairs = list(db.scalars(select(CurrencyPair)).unique())
    return RateBook(pairs, snapshots_at(db, at))


def find_pair(db: Session, a_id: int, b_id: int) -> CurrencyPair | None:
    return db.scalars(select(CurrencyPair).where(
        ((CurrencyPair.base_currency_id == a_id) & (CurrencyPair.quote_currency_id == b_id))
        | ((CurrencyPair.base_currency_id == b_id) & (CurrencyPair.quote_currency_id == a_id))
    )).unique().one_or_none()


def currency_by_code(db: Session, code: str, *, active_only: bool = True) -> Currency:
    cur = db.scalars(select(Currency).where(Currency.currency_code == code.upper())).one_or_none()
    if cur is None or (active_only and cur.status != "ACTIVE"):
        raise NotFound(f"Currency {code.upper()} is not supported.", code="currency_not_supported")
    return cur


# ── market status ─────────────────────────────────────────────────────────────────────────

def fx_session(now: datetime | None = None) -> str:
    """Global FX trades 24/5: closed from Friday 21:00 UTC to Sunday 21:00 UTC."""
    now = now or utcnow()
    wd, h = now.weekday(), now.hour
    if (wd == 4 and h >= 21) or wd == 5 or (wd == 6 and h < 21):
        return "CLOSED"
    return "OPEN"


def freshness(as_of: datetime | None, now: datetime | None = None) -> str:
    if as_of is None:
        return "UNAVAILABLE"
    s = get_settings()
    age = ((now or utcnow()) - as_of).total_seconds()
    if age <= s.live_threshold_seconds:
        return "LIVE"
    if age <= s.delayed_threshold_seconds:
        return "DELAYED"
    return "STALE"


def market_status(db: Session) -> dict:
    s = get_settings()
    now = utcnow()
    row = db.execute(text(
        "SELECT max(recorded_at) AS recorded_at, "
        "       max(coalesce(source_timestamp, recorded_at)) AS as_of "
        "  FROM exchange_rate WHERE recorded_at > now() - interval '30 days'")).one()
    latest_type = db.execute(text(
        "SELECT rate_type, provider FROM exchange_rate ORDER BY recorded_at DESC, rate_id DESC LIMIT 1")).first()
    last_log = db.scalars(select(RateProviderLog).order_by(RateProviderLog.started_at.desc()).limit(1)).first()
    last_ok = db.scalars(select(RateProviderLog).where(RateProviderLog.status.in_(["SUCCESS", "PARTIAL"]))
                         .order_by(RateProviderLog.started_at.desc()).limit(1)).first()

    status = freshness(row.recorded_at, now)
    # A provider that answers but republishes old data is delayed, not live.
    if status == "LIVE" and row.as_of and freshness(row.as_of, now) != "LIVE":
        status = "DELAYED"
    provider_down = last_log is not None and last_log.status == "FAILED"
    if provider_down and status == "LIVE":
        status = "DELAYED"

    messages = {
        "LIVE": "Rates refreshed within the last few minutes.",
        "DELAYED": "Rates are delayed — the latest snapshot is older than usual.",
        "STALE": "Market data is stale. Showing the last valid rates; refresh is not currently succeeding.",
        "UNAVAILABLE": "No market data has been recorded yet.",
    }
    return {
        "status": status,
        "message": messages[status],
        "fx_session": fx_session(now),
        "last_updated_at": row.recorded_at,
        "data_as_of": row.as_of,
        "provider": latest_type.provider if latest_type else None,
        "is_simulated": bool(latest_type and latest_type.rate_type != "LIVE"),
        "provider_available": not provider_down,
        "last_successful_update_at": last_ok.finished_at if last_ok else None,
        "update_interval_seconds": s.rate_update_interval_seconds,
        "server_time": now,
    }


# ── history ───────────────────────────────────────────────────────────────────────────────

RANGES: dict[str, tuple[timedelta, str]] = {
    "1H": (timedelta(hours=1), "2 minutes"),
    "6H": (timedelta(hours=6), "5 minutes"),
    "1D": (timedelta(days=1), "15 minutes"),
    "1W": (timedelta(weeks=1), "1 hour"),
    "1M": (timedelta(days=30), "4 hours"),
    "3M": (timedelta(days=90), "12 hours"),
    "1Y": (timedelta(days=365), "1 day"),
}

_HISTORY_SQL = """
    SELECT date_bin(CAST(:bucket AS interval), recorded_at, TIMESTAMPTZ '2000-01-01') AS bucket,
           (array_agg(rate ORDER BY recorded_at ASC))[1]  AS open,
           max(rate)                                      AS high,
           min(rate)                                      AS low,
           (array_agg(rate ORDER BY recorded_at DESC))[1] AS close,
           bool_or(rate_type <> 'LIVE')                   AS simulated
      FROM exchange_rate
     WHERE pair_id = :pair_id AND recorded_at >= :start AND recorded_at <= :end
  GROUP BY 1
  ORDER BY 1
"""


def history(db: Session, pair_id: int, range_key: str, invert: bool = False) -> list[dict]:
    if range_key not in RANGES:
        raise AppError(f"Unsupported range. Use one of: {', '.join(RANGES)}", code="invalid_range")
    span, bucket = RANGES[range_key]
    end = utcnow()
    rows = db.execute(text(_HISTORY_SQL), {"bucket": bucket, "pair_id": pair_id,
                                           "start": end - span, "end": end}).all()
    points = []
    for r in rows:
        o, h, lo, c = r.open, r.high, r.low, r.close
        if invert:
            o, h, lo, c = Decimal(1) / o, Decimal(1) / lo, Decimal(1) / h, Decimal(1) / c
        points.append({"time": r.bucket, "open": q_rate(o), "high": q_rate(h), "low": q_rate(lo),
                       "close": q_rate(c), "simulated": r.simulated})
    return points


def bucket_closes(db: Session, pair_ids: list[int], start: datetime, end: datetime, bucket: str
                  ) -> dict[int, list[tuple[datetime, Decimal]]]:
    """Closing rate per time bucket for several pairs (used for portfolio history)."""
    if not pair_ids:
        return {}
    rows = db.execute(text("""
        SELECT pair_id,
               date_bin(CAST(:bucket AS interval), recorded_at, TIMESTAMPTZ '2000-01-01') AS bucket,
               (array_agg(rate ORDER BY recorded_at DESC))[1] AS close
          FROM exchange_rate
         WHERE pair_id = ANY(:ids) AND recorded_at >= :start AND recorded_at <= :end
      GROUP BY 1, 2 ORDER BY 1, 2"""), {"bucket": bucket, "ids": pair_ids, "start": start, "end": end}).all()
    out: dict[int, list[tuple[datetime, Decimal]]] = {}
    for r in rows:
        out.setdefault(r.pair_id, []).append((r.bucket, r.close))
    return out
