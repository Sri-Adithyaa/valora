"""Demonstration data for local use. Everything created here is SIMULATED and labelled as such.

    python -m app.seed             # seed an empty database (refuses if data exists)
    python -m app.seed --if-empty  # seed only when the catalogue is empty (used by docker compose)
    python -m app.seed --reset     # wipe ALL data (TRUNCATE) and re-seed — local development only

Creates the currency catalogue and pairs, ~1 year of simulated rate history (rate_type='SIMULATED_SEED',
anchored to the current live rate when reachable), three demo users with wallets, virtual funding and
trades that run through the real settlement engine, plus a live rate refresh when the network allows.
"""
import argparse
import math
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import q_rate
from app.core.security import hash_password
from app.database.session import SessionLocal, engine
from app.models import Currency, CurrencyPair, Notification, TradeQuote, User, Wallet, Watchlist, WatchlistPair
from app.services import catalog
from app.services import rates as rates_svc
from app.services.wallet import _fund, _reference
from app.trading import engine as trade_engine

DEMO_PASSWORD = "ValoraDemo123"

DEMO_USERS = [
    {"full_name": "Aarav Mehta", "username": "demo", "email": "demo@valora.money", "phone": "+91 98765 43210",
     "country": "India", "base": "INR", "wallet": "Aarav's Valora Wallet", "days_ago": 75,
     "topup": Decimal("150000"),
     "trades": [  # (days_ago, from, to, source amount)
         (72, "INR", "USD", "40000"), (66, "INR", "EUR", "25000"), (58, "USD", "EUR", "100"),
         (47, "INR", "GBP", "20000"), (38, "EUR", "GBP", "50"), (30, "INR", "JPY", "12000"),
         (21, "INR", "USD", "30000"), (14, "USD", "INR", "60"), (9, "GBP", "JPY", "25"),
         (4, "INR", "SGD", "8000"), (1.5, "EUR", "USD", "40"),
     ],
     "favourites": ["USD/INR", "USD/EUR", "GBP/INR", "USD/JPY"]},
    {"full_name": "Maya Chen", "username": "maya.chen", "email": "maya@valora.money", "phone": "+1 415 555 0142",
     "country": "United States", "base": "USD", "wallet": "Maya's Wallet", "days_ago": 50,
     "topup": None,
     "trades": [(48, "USD", "EUR", "300"), (40, "USD", "JPY", "200"), (31, "EUR", "GBP", "120"),
                (22, "USD", "CHF", "150"), (11, "JPY", "USD", "8000"), (3, "USD", "AUD", "100")],
     "favourites": ["USD/EUR", "USD/JPY", "EUR/GBP"]},
    {"full_name": "Oliver Bennett", "username": "oliver.b", "email": "oliver@valora.money",
     "phone": "+44 7700 900123", "country": "United Kingdom", "base": "GBP", "wallet": "Oliver's FX Book",
     "days_ago": 35, "topup": None,
     "trades": [(33, "GBP", "USD", "250"), (25, "GBP", "EUR", "180"), (16, "USD", "CAD", "120"),
                (6, "EUR", "GBP", "60")],
     "favourites": ["GBP/INR", "USD/GBP", "GBP/JPY"]},
]

# Daily volatility of each currency against USD for the simulated history.
DAILY_VOL = {"EUR": 0.0042, "GBP": 0.0048, "CHF": 0.0045, "AUD": 0.0062, "CAD": 0.0036, "SGD": 0.0025,
             "AED": 0.00004, "JPY": 0.0060, "INR": 0.0024}


def log(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


def seed_catalogue(db: Session) -> None:
    for i, (code, name, symbol, country, decimals) in enumerate(catalog.CURRENCIES):
        db.add(Currency(currency_code=code, currency_name=name, currency_symbol=symbol, country=country,
                        decimals=decimals, display_order=i))
    db.flush()
    ids = {c.currency_code: c.currency_id for c in db.scalars(select(Currency))}
    for spec in catalog.pair_specs():
        db.add(CurrencyPair(base_currency_id=ids[spec["base"]], quote_currency_id=ids[spec["quote"]],
                            symbol=spec["symbol"], spread=spec["spread"], min_trade_amount=spec["min_trade_amount"],
                            is_featured=spec["is_featured"], display_order=spec["display_order"]))
    db.commit()
    log(f"catalogue: {len(ids)} currencies, {len(catalog.pair_specs())} pairs")


def anchor_rates() -> tuple[dict[str, Decimal], str]:
    from market_worker.providers import CoinbaseProvider, OpenErApiProvider, ProviderError
    codes = [c[0] for c in catalog.CURRENCIES]
    for p in (CoinbaseProvider(8), OpenErApiProvider(8)):
        try:
            r = p.fetch(codes)
            if all(c in r.usd_rates for c in codes if c != "USD"):
                return {**r.usd_rates, "USD": Decimal(1)}, p.name
        except ProviderError as exc:
            log(f"anchor via {p.name} failed: {exc}")
    return dict(catalog.REFERENCE_USD_RATES), "built-in reference table"


def timeline(now: datetime) -> list[datetime]:
    """Dense recent history, sparser further back (keeps the table small but every chart range populated)."""
    pts: list[datetime] = []
    segments = [(timedelta(days=365), timedelta(days=90), timedelta(hours=6)),
                (timedelta(days=90), timedelta(days=7), timedelta(hours=1)),
                (timedelta(days=7), timedelta(days=1), timedelta(minutes=15)),
                (timedelta(days=1), timedelta(minutes=2), timedelta(minutes=2))]
    for start, end, step in segments:
        t = now - start
        while t < now - end:
            pts.append(t)
            t += step
    pts.append(now - timedelta(minutes=2))
    return sorted(set(pts))


def seed_history(db: Session, now: datetime) -> None:
    anchor, source = anchor_rates()
    log(f"anchoring simulated history to current rates from {source}")
    rng = random.Random(20261101)
    times = timeline(now)
    # Walk backwards from the anchor so the series ends exactly at today's rate.
    usd_paths: dict[str, list[Decimal]] = {"USD": [Decimal(1)] * len(times)}
    for code, *_ in catalog.CURRENCIES:
        if code == "USD":
            continue
        vol = DAILY_VOL.get(code, 0.004)
        log_rate = math.log(float(anchor[code]))
        path = [0.0] * len(times)
        path[-1] = log_rate
        for i in range(len(times) - 1, 0, -1):
            dt_days = (times[i] - times[i - 1]).total_seconds() / 86400
            path[i - 1] = path[i] - rng.gauss(0, vol * math.sqrt(dt_days))
        usd_paths[code] = [Decimal(repr(math.exp(v))) for v in path]
        usd_paths[code][-1] = anchor[code]

    pairs = db.execute(text("""SELECT p.pair_id, b.currency_code, q.currency_code FROM currency_pair p
                               JOIN currency b ON b.currency_id = p.base_currency_id
                               JOIN currency q ON q.currency_id = p.quote_currency_id""")).all()
    raw = db.connection().connection.driver_connection
    count = 0
    with raw.cursor() as cur:
        with cur.copy("COPY exchange_rate (pair_id, rate, recorded_at, provider, rate_type) FROM STDIN") as copy:
            for pair_id, b, q in pairs:
                bp, qp = usd_paths[b], usd_paths[q]
                for i, t in enumerate(times):
                    copy.write_row((pair_id, q_rate(qp[i] / bp[i]), t, "seed", "SIMULATED_SEED"))
                    count += 1
    db.commit()
    log(f"history: {count:,} simulated snapshots across {len(pairs)} pairs ({len(times)} points each)")


def seed_quote(db: Session, user: User, wallet: Wallet, frm: str, to: str, amount: Decimal, at: datetime,
               status: str) -> TradeQuote:
    """Build a quote exactly like the live engine, but priced from the snapshot in force at `at`."""
    s = get_settings()
    src = rates_svc.currency_by_code(db, frm)
    dst = rates_svc.currency_by_code(db, to)
    pair = rates_svc.find_pair(db, src.currency_id, dst.currency_id)
    snap = rates_svc.snapshots_at(db, at, [pair.pair_id])[pair.pair_id]
    mid = q_rate(snap.rate if src.currency_id == pair.base_currency_id else Decimal(1) / snap.rate)
    quoted = q_rate(mid * (Decimal(1) - pair.spread / 2))
    from_amount = amount.quantize(Decimal(1).scaleb(-src.decimals))
    to_amount = trade_engine.q_down(from_amount * quoted, dst.decimals)
    q = TradeQuote(quote_id=uuid.uuid4(), user_id=user.user_id, wallet_id=wallet.wallet_id, pair_id=pair.pair_id,
                   rate_id=snap.rate_id, side="BUY" if dst.currency_id == pair.base_currency_id else "SELL",
                   amount_type="SOURCE", from_currency_id=src.currency_id, to_currency_id=dst.currency_id,
                   from_amount=from_amount, to_amount=to_amount, pair_rate=snap.rate, mid_rate=mid,
                   quoted_rate=quoted, spread=pair.spread,
                   fee=trade_engine.q_up(from_amount * s.trading_fee_rate, src.decimals),
                   fee_rate=s.trading_fee_rate, fee_currency_id=src.currency_id, rate_recorded_at=snap.recorded_at,
                   created_at=at - timedelta(seconds=12), expires_at=at + timedelta(seconds=18), status=status,
                   executed_at=at if status == "EXECUTED" else None)
    db.add(q)
    db.flush()
    db.refresh(q)
    return q


def seed_users(db: Session, now: datetime) -> None:
    pwd_hash = hash_password(DEMO_PASSWORD)
    pairs = {p.symbol: p.pair_id for p in db.scalars(select(CurrencyPair)).unique()}
    for spec in DEMO_USERS:
        base = rates_svc.currency_by_code(db, spec["base"])
        created = now - timedelta(days=spec["days_ago"])
        user = User(full_name=spec["full_name"], username=spec["username"], email=spec["email"], phone=spec["phone"],
                    password_hash=pwd_hash, country=spec["country"], base_currency_id=base.currency_id, is_demo=True,
                    created_at=created, updated_at=created)
        db.add(user)
        db.flush()
        wl = Watchlist(user_id=user.user_id, name="Favourites")
        db.add(wl)
        db.flush()
        for sym in spec["favourites"]:
            db.add(WatchlistPair(watchlist_id=wl.watchlist_id, pair_id=pairs[sym]))

        wallet = Wallet(user_id=user.user_id, wallet_reference=_reference("VLM"), wallet_name=spec["wallet"],
                        base_currency_id=base.currency_id, country=spec["country"],
                        terms_accepted_at=created + timedelta(minutes=3), created_at=created + timedelta(minutes=3))
        db.add(wallet)
        db.flush()
        db.refresh(wallet)

        inr = rates_svc.currency_by_code(db, "INR")
        book = rates_svc.rate_book(db, at=wallet.created_at)
        initial = trade_engine.q_down(get_settings().initial_funding_inr * book.require(inr.currency_id, base.currency_id),
                                      base.decimals)
        _fund(db, wallet, base, initial, "INITIAL", "Initial virtual balance (demo seed)", book,
              at=wallet.created_at + timedelta(seconds=1))
        if spec["topup"]:
            at = created + timedelta(days=30)
            _fund(db, wallet, base, spec["topup"], "DEMO_CREDIT", "Demo credit (demo seed)",
                  rates_svc.rate_book(db, at=at), at=at)

        for days_ago, frm, to, amount in sorted(spec["trades"], key=lambda t: -t[0]):
            at = now - timedelta(days=days_ago, minutes=rng_minutes(days_ago))
            q = seed_quote(db, user, wallet, frm, to, Decimal(amount), at, "EXECUTED")
            trade_engine.settle(db, wallet, q, at)

        # One quote the user let lapse, so the activity feed shows expiries too.
        lapse_at = now - timedelta(days=2, hours=3)
        frm = spec["base"]
        to = "USD" if frm != "USD" else "EUR"
        seed_quote(db, user, wallet, frm, to, Decimal("1000") if frm == "INR" else Decimal("25"), lapse_at, "EXPIRED")

        db.add_all([
            Notification(user_id=user.user_id, type="WALLET_ACTIVATED", severity="SUCCESS",
                         title="Your Valora Wallet is active",
                         message=f"Wallet {wallet.wallet_reference} opened with a virtual starting balance.",
                         link="/dashboard", is_read=True, created_at=wallet.created_at),
            Notification(user_id=user.user_id, type="QUOTE_EXPIRED", severity="WARNING", title="Quote expired",
                         message="A quote lapsed before it was confirmed. Request a fresh quote to trade.",
                         link="/trade", created_at=lapse_at + timedelta(seconds=40)),
        ])
        db.commit()
        log(f"user {spec['username']:<10} ({spec['base']}) wallet {wallet.wallet_reference}: "
            f"{len(spec['trades'])} trades")


def rng_minutes(days_ago: float) -> int:
    return int((days_ago * 997) % 600)


def reset(db: Session) -> None:
    tables = ["notification", "watchlist_pair", "watchlist", "pnl_transaction", "ledger_entry", "trades", "orders",
              "trade_quote", "wallet_funding", "holding", "wallet", "user_session", "users", "exchange_rate",
              "rate_provider_log", "currency_pair", "currency"]
    db.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    db.commit()
    log("all tables truncated")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="TRUNCATE all data first (development only)")
    parser.add_argument("--if-empty", action="store_true", help="exit quietly when data already exists")
    parser.add_argument("--no-live", action="store_true", help="skip the live rate refresh at the end")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.reset:
            reset(db)
        if db.scalar(select(Currency.currency_id).limit(1)) is not None:
            if args.if_empty:
                log("data already present — skipping")
                return 0
            log("database already contains data; use --reset to rebuild it")
            return 1
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        seed_catalogue(db)
        seed_history(db, now)
        seed_users(db, now)
        if not args.no_live:
            from market_worker.rate_updater import run_update
            result = run_update(db)
            log(f"live refresh: {result.get('status')} via {result.get('provider', '-')}")
        log(f"done. Demo login: demo@valora.money (or 'demo') / {DEMO_PASSWORD}")
        return 0
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
