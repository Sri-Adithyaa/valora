import re
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import create_wallet, holdings_map, register, trade


def test_wallet_creation_funds_initial_virtual_balance(make_client, db):
    c = make_client()
    register(c, "alice")
    r = create_wallet(c)
    assert r.status_code == 201
    w = r.json()
    assert re.fullmatch(r"VLM-\d{4}-\d{4}-\d{4}", w["wallet_reference"])
    assert w["status"] == "ACTIVE" and w["base_currency"]["currency_code"] == "INR"
    assert holdings_map(c) == {"INR": Decimal("100000")}
    # Funding is recorded in the ledger and flagged as initial (not trading gains).
    fundings = c.get("/api/wallet/fundings").json()
    assert len(fundings) == 1 and fundings[0]["funding_type"] == "INITIAL"
    ledger = c.get("/api/wallet/ledger").json()["items"]
    assert [(e["entry_type"], Decimal(e["amount"])) for e in ledger] == [("FUNDING_CREDIT", Decimal("100000"))]
    assert c.get("/api/auth/me").json()["wallet"]["wallet_reference"] == w["wallet_reference"]
    types = [n["type"] for n in c.get("/api/notifications").json()["items"]]
    assert "WALLET_ACTIVATED" in types


def test_wallet_in_other_base_currency_gets_converted_initial_balance(make_client):
    c = make_client()
    register(c, "maya", base="USD")
    assert create_wallet(c, base="USD").status_code == 201
    usd = holdings_map(c)["USD"]
    assert Decimal("1000") < usd < Decimal("1100")  # ₹1,00,000 at ~94.92 INR per USD


def test_duplicate_wallet_prevented(trader):
    r = create_wallet(trader)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "wallet_exists"


def test_wallet_requires_terms(make_client):
    c = make_client()
    register(c, "alice")
    r = c.post("/api/wallet/create", json={"wallet_name": "W", "base_currency": "INR", "country": "India",
                                           "accept_terms": False})
    assert r.status_code in (422,)
    assert c.get("/api/wallet").json()["error"]["code"] == "wallet_required"


def test_trading_requires_wallet(make_client):
    c = make_client()
    register(c, "alice")
    r = c.post("/api/trade/quote", json={"from_currency": "INR", "to_currency": "USD", "amount": "100"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "wallet_required"


def test_demo_funding_is_recorded_and_limited(trader):
    r = trader.post("/api/wallet/fund-demo", json={"amount": "25000"})
    assert r.status_code == 201
    assert r.json()["funding_type"] == "DEMO_CREDIT"
    assert holdings_map(trader)["INR"] == Decimal("125000")
    assert len(trader.get("/api/wallet/fundings").json()) == 2
    too_big = trader.post("/api/wallet/fund-demo", json={"amount": "600000"})
    assert too_big.status_code == 422 and too_big.json()["error"]["code"] == "funding_limit"
    for _ in range(2):
        assert trader.post("/api/wallet/fund-demo", json={"amount": "450000"}).status_code == 201
    daily = trader.post("/api/wallet/fund-demo", json={"amount": "100000"})
    assert daily.status_code == 422 and "Daily" in daily.json()["error"]["message"]
    assert trader.post("/api/wallet/fund-demo", json={"amount": "10.001"}).status_code == 422


def test_multiple_currency_holdings_in_one_wallet(trader):
    trade(trader, "INR", "USD", "10000")
    trade(trader, "INR", "EUR", "10000")
    trade(trader, "USD", "GBP", "20")
    h = holdings_map(trader)
    assert set(h) == {"INR", "USD", "EUR", "GBP"}
    assert trader.get("/api/wallet").json()["holdings_count"] == 4


def test_one_holding_row_per_wallet_currency(trader, db):
    wallet_id, inr = db.execute(text("SELECT wallet_id, currency_id FROM holding LIMIT 1")).one()
    with pytest.raises(DBAPIError):
        db.execute(text("INSERT INTO holding (wallet_id, currency_id) VALUES (:w, :c)"), {"w": wallet_id, "c": inr})
    db.rollback()


def test_one_active_wallet_per_user_enforced_by_database(trader, db):
    user_id, base = db.execute(text("SELECT user_id, base_currency_id FROM wallet")).one()
    with pytest.raises(DBAPIError):
        db.execute(text("INSERT INTO wallet (user_id, wallet_reference, wallet_name, base_currency_id, country, "
                        "terms_accepted_at) VALUES (:u, 'VLM-X', 'Second', :b, 'India', now())"),
                   {"u": user_id, "b": base})
    db.rollback()
