"""Portfolio valuation, performance history and P&L (weighted-average cost, in the wallet's base currency)."""
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Currency, LedgerEntry, PnlTransaction, Wallet, WalletFunding
from app.services import rates as rates_svc
from app.services.wallet import holdings as wallet_holdings
from app.services.wallet import total_funded_base

TWO = Decimal("0.01")


def _pct(num: Decimal, den: Decimal) -> Decimal | None:
    if den == 0:
        return None
    return (num / den * 100).quantize(TWO)


def realized_by_currency(db: Session, wallet_id: int) -> dict[int, Decimal]:
    rows = db.execute(select(PnlTransaction.currency_id, func.sum(PnlTransaction.profit_loss))
                      .where(PnlTransaction.wallet_id == wallet_id).group_by(PnlTransaction.currency_id)).all()
    return {cid: total for cid, total in rows}


def portfolio(db: Session, wallet: Wallet) -> dict:
    base = wallet.base_currency
    now_book = rates_svc.rate_book(db)
    day_book = rates_svc.rate_book(db, at=rates_svc.utcnow() - timedelta(hours=24))
    realized = realized_by_currency(db, wallet.wallet_id)

    rows = []
    total_value = total_cost = daily_move = Decimal(0)
    for h in wallet_holdings(db, wallet):
        cur = h.currency
        price = now_book.rate(cur.currency_id, base.currency_id)
        price_24h = day_book.rate(cur.currency_id, base.currency_id)
        value = h.quantity * price if price is not None else None
        cost = h.quantity * h.average_cost
        unrealized = value - cost if value is not None else None
        if value is not None:
            total_value += value
            total_cost += cost
            if price_24h is not None:
                daily_move += h.quantity * (price - price_24h)
        rows.append({
            "currency": cur,
            "quantity": h.quantity,
            "average_cost": h.average_cost,
            "cost_basis": cost.quantize(TWO),
            "latest_rate": price,
            "current_value": value.quantize(TWO) if value is not None else None,
            "unrealized_pnl": unrealized.quantize(TWO) if unrealized is not None else None,
            "unrealized_pnl_pct": _pct(unrealized, cost) if unrealized is not None else None,
            "price_change_24h_pct": (_pct(price - price_24h, price_24h)
                                     if price is not None and price_24h is not None and cur.currency_id != base.currency_id
                                     else Decimal("0.00")),
            "realized_pnl": realized.get(cur.currency_id, Decimal(0)).quantize(TWO),
            "updated_at": h.updated_at,
        })

    for r in rows:
        r["allocation_pct"] = _pct(r["current_value"] or Decimal(0), total_value) or Decimal("0.00")
    rows.sort(key=lambda r: r["current_value"] or Decimal(0), reverse=True)

    funded = total_funded_base(db, wallet.wallet_id)
    realized_total = sum(realized.values(), Decimal(0))
    unrealized_total = total_value - total_cost
    opening_value = total_value - daily_move
    status = rates_svc.market_status(db)
    return {
        "base_currency": base,
        "total_value": total_value.quantize(TWO),
        "total_cost_basis": total_cost.quantize(TWO),
        "total_funded": Decimal(funded).quantize(TWO),
        "overall_gain": (total_value - funded).quantize(TWO),
        "overall_gain_pct": _pct(total_value - funded, Decimal(funded)),
        "realized_pnl": realized_total.quantize(TWO),
        "unrealized_pnl": unrealized_total.quantize(TWO),
        "daily_change": daily_move.quantize(TWO),
        "daily_change_pct": _pct(daily_move, opening_value),
        "currencies_held": len(rows),
        "holdings": rows,
        "last_market_update": status["last_updated_at"],
        "market_status": status["status"],
    }


PERF_RANGES: dict[str, tuple[timedelta | None, str]] = {
    "1D": (timedelta(days=1), "30 minutes"),
    "1W": (timedelta(weeks=1), "3 hours"),
    "1M": (timedelta(days=30), "12 hours"),
    "3M": (timedelta(days=90), "1 day"),
    "1Y": (timedelta(days=365), "3 days"),
    "ALL": (None, "1 day"),
}


def performance(db: Session, wallet: Wallet, range_key: str) -> dict:
    """Portfolio value over time, rebuilt from the ledger and stored rate history.

    For each time bucket: balances = cumulative ledger movements up to the bucket end; value = Σ balance ×
    (currency → base) closing rate in that bucket (forward-filled). `invested` is cumulative virtual funding.
    """
    if range_key not in PERF_RANGES:
        raise rates_svc.AppError(f"Unsupported range. Use one of: {', '.join(PERF_RANGES)}", code="invalid_range")
    span, bucket = PERF_RANGES[range_key]
    end = rates_svc.utcnow()
    start = max(wallet.created_at, end - span) if span else wallet.created_at
    if end - start < timedelta(hours=1):
        start = end - timedelta(hours=1)
        bucket = "5 minutes"
    base_id = wallet.base_currency_id

    ledger = db.execute(select(LedgerEntry.created_at, LedgerEntry.currency_id, LedgerEntry.direction,
                               LedgerEntry.amount).where(LedgerEntry.wallet_id == wallet.wallet_id)
                        .order_by(LedgerEntry.created_at, LedgerEntry.ledger_id)).all()
    fundings = db.execute(select(WalletFunding.created_at, WalletFunding.base_value)
                          .where(WalletFunding.wallet_id == wallet.wallet_id)
                          .order_by(WalletFunding.created_at)).all()
    currency_ids = sorted({row.currency_id for row in ledger} - {base_id})

    # Pair + orientation for each currency → base; closing rates per bucket.
    pair_for: dict[int, tuple[int, bool]] = {}
    for cid in currency_ids:
        p = rates_svc.find_pair(db, cid, base_id)
        if p is not None:
            pair_for[cid] = (p.pair_id, p.base_currency_id == cid)
    closes = rates_svc.bucket_closes(db, [p for p, _ in pair_for.values()], start - timedelta(days=7), end, bucket)
    start_book = rates_svc.rate_book(db, at=start)

    # Bucket grid aligned with the SQL date_bin origin.
    step = _parse_interval(bucket)
    origin = datetime(2000, 1, 1, tzinfo=end.tzinfo)
    t = origin + ((start - origin) // step) * step
    grid: list[datetime] = []
    while t <= end:
        grid.append(t)
        t += step

    balances: dict[int, Decimal] = defaultdict(Decimal)
    last_rate: dict[int, Decimal | None] = {cid: start_book.rate(cid, base_id) for cid in currency_ids}
    rate_iters = {cid: iter(closes.get(pair_for[cid][0], [])) if cid in pair_for else iter(()) for cid in currency_ids}
    pending = {cid: next(rate_iters[cid], None) for cid in currency_ids}
    li = fi = 0
    invested = Decimal(0)
    points = []
    for bucket_start in grid:
        bucket_end = bucket_start + step
        while li < len(ledger) and ledger[li].created_at < bucket_end:
            row = ledger[li]
            balances[row.currency_id] += row.amount if row.direction == "CREDIT" else -row.amount
            li += 1
        while fi < len(fundings) and fundings[fi].created_at < bucket_end:
            invested += fundings[fi].base_value
            fi += 1
        for cid in currency_ids:
            nxt = pending[cid]
            while nxt is not None and nxt[0] <= bucket_start:
                pair_id, is_base = pair_for[cid]
                last_rate[cid] = nxt[1] if is_base else Decimal(1) / nxt[1]
                nxt = next(rate_iters[cid], None)
            pending[cid] = nxt
        value = balances.get(base_id, Decimal(0))
        for cid in currency_ids:
            r = last_rate.get(cid)
            if r is not None:
                value += balances[cid] * r
        if bucket_start >= wallet.created_at - step:
            points.append({"time": min(bucket_end, end), "value": value.quantize(TWO),
                           "invested": invested.quantize(TWO), "pnl": (value - invested).quantize(TWO)})
    return {"range": range_key, "base_currency": wallet.base_currency.currency_code, "points": points}


def _parse_interval(s: str) -> timedelta:
    n, unit = s.split()
    n = int(n)
    return {"minutes": timedelta(minutes=n), "hours": timedelta(hours=n), "hour": timedelta(hours=n),
            "day": timedelta(days=n), "days": timedelta(days=n)}[unit]


def allocation(db: Session, wallet: Wallet) -> dict:
    p = portfolio(db, wallet)
    return {
        "base_currency": p["base_currency"],
        "total_value": p["total_value"],
        "slices": [{"currency": h["currency"], "value": h["current_value"], "allocation_pct": h["allocation_pct"]}
                   for h in p["holdings"]],
    }


def currency_of(db: Session, currency_id: int) -> Currency:
    return db.get(Currency, currency_id)
