"""Test fixtures. Tests run against a real PostgreSQL database (TEST_DATABASE_URL, default `valora_test`),
because row locking, triggers and constraints are part of what is being tested.

The database is created and migrated once per session; user data is truncated between tests.
Rates are deterministic: every pair is priced from catalog.REFERENCE_USD_RATES.
"""
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import Settings

_test_url = os.environ.get("TEST_DATABASE_URL") or Settings().test_database_url
os.environ["DATABASE_URL"] = _test_url  # must happen before app.database.session is imported

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


def _create_database(url: str) -> None:
    u = make_url(url)
    admin = create_engine(u.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        exists = c.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": u.database}).scalar()
        if exists:
            c.execute(text(f'DROP DATABASE "{u.database}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{u.database}"'))
    admin.dispose()


def _migrate(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")


REF = None  # filled in by the session fixture: {code: Decimal USD→code}

USER_TABLES = ["notification", "watchlist_pair", "watchlist", "pnl_transaction", "ledger_entry", "trades", "orders",
               "trade_quote", "wallet_funding", "holding", "wallet", "user_session", "users", "rate_provider_log"]


@pytest.fixture(scope="session", autouse=True)
def database():
    global REF
    _create_database(_test_url)
    _migrate(_test_url)
    from app.core import ratelimit
    from app.database.session import SessionLocal
    from app.models import Currency, CurrencyPair
    from app.services import catalog

    ratelimit.set_enabled(False)
    REF = dict(catalog.REFERENCE_USD_RATES)
    db = SessionLocal()
    for i, (code, name, symbol, country, decimals) in enumerate(catalog.CURRENCIES):
        db.add(Currency(currency_code=code, currency_name=name, currency_symbol=symbol, country=country,
                        decimals=decimals, display_order=i))
    db.flush()
    ids = {c.currency_code: c.currency_id for c in db.query(Currency)}
    for spec in catalog.pair_specs():
        db.add(CurrencyPair(base_currency_id=ids[spec["base"]], quote_currency_id=ids[spec["quote"]],
                            symbol=spec["symbol"], spread=spec["spread"], min_trade_amount=spec["min_trade_amount"],
                            is_featured=spec["is_featured"], display_order=spec["display_order"]))
    db.commit()
    insert_reference_rates(db, datetime.now(timezone.utc) - timedelta(days=3), hours=72)
    db.close()
    yield
    from app.database.session import engine
    engine.dispose()


def insert_reference_rates(db, start: datetime, hours: int, provider: str = "test", rate_type: str = "LIVE"):
    """Hourly constant snapshots from `start` (plus one at now) using the reference USD rates."""
    from app.core.money import q_rate
    pairs = db.execute(text("""SELECT p.pair_id, b.currency_code, q.currency_code FROM currency_pair p
                               JOIN currency b ON b.currency_id = p.base_currency_id
                               JOIN currency q ON q.currency_id = p.quote_currency_id""")).all()
    rows = []
    newest = db.execute(text("SELECT max(recorded_at) FROM exchange_rate")).scalar()
    latest = datetime.now(timezone.utc)
    if newest is not None and newest >= latest:  # always become the newest snapshot
        latest = newest + timedelta(milliseconds=1)
    times = [start + timedelta(hours=h) for h in range(hours)] + [latest]
    for pair_id, b, q in pairs:
        r = q_rate(REF[q] / REF[b])
        rows += [{"p": pair_id, "r": r, "t": t, "pv": provider, "rt": rate_type} for t in times]
    db.execute(text("INSERT INTO exchange_rate (pair_id, rate, recorded_at, provider, rate_type) "
                    "VALUES (:p, :r, :t, :pv, :rt) ON CONFLICT DO NOTHING"), rows)
    db.commit()


@pytest.fixture(autouse=True)
def clean_users():
    from app.database.session import SessionLocal
    db = SessionLocal()
    db.execute(text(f"TRUNCATE {', '.join(USER_TABLES)} RESTART IDENTITY CASCADE"))
    db.commit()
    insert_reference_rates(db, datetime.now(timezone.utc), hours=0)  # fresh, known rates for every test
    db.close()
    yield


@pytest.fixture
def db():
    from app.database.session import SessionLocal
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def make_client():
    from fastapi.testclient import TestClient
    from app.main import app
    clients = []

    def _make() -> TestClient:
        c = TestClient(app)
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.close()


def register(client, username="alice", email=None, base="INR", password="Secret123", **extra):
    body = {"full_name": f"{username.title()} Tester", "username": username, "email": email or f"{username}@example.com",
            "phone": "+91 98765 43210", "password": password, "confirm_password": password, "country": "India",
            "base_currency": base, **extra}
    return client.post("/api/auth/register", json=body)


def create_wallet(client, base="INR"):
    return client.post("/api/wallet/create", json={"wallet_name": "Main Wallet", "base_currency": base,
                                                   "country": "India", "accept_terms": True})


@pytest.fixture
def trader(make_client):
    """A registered, logged-in user with an active INR wallet (₹1,00,000 virtual balance)."""
    c = make_client()
    assert register(c).status_code == 201
    assert create_wallet(c).status_code == 201
    return c


def holdings_map(client) -> dict[str, Decimal]:
    return {h["currency"]["currency_code"]: Decimal(h["quantity"]) for h in client.get("/api/wallet/holdings").json()}


def quote(client, frm, to, amount, amount_type="SOURCE"):
    return client.post("/api/trade/quote", json={"from_currency": frm, "to_currency": to, "amount": str(amount),
                                                 "amount_type": amount_type})


def trade(client, frm, to, amount, amount_type="SOURCE"):
    q = quote(client, frm, to, amount, amount_type)
    assert q.status_code == 201, q.json()
    r = client.post("/api/trade/execute", json={"quote_id": q.json()["quote_id"]})
    assert r.status_code == 201, r.json()
    return q.json(), r.json()
