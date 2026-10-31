import threading
import time
import uuid
from decimal import ROUND_DOWN, Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from tests.conftest import create_wallet, holdings_map, quote, register, trade

D = Decimal


def test_quote_amounts_are_computed_server_side(trader):
    r = quote(trader, "INR", "USD", "10000")
    assert r.status_code == 201
    q = r.json()
    # USD/INR = 94.92 → 1 INR = 1/94.92 USD (10 dp), customer pays half the 0.20% spread (INR is not a major).
    mid = (D(1) / D("94.92")).quantize(D("1e-10"))
    quoted = (mid * (D(1) - D("0.001"))).quantize(D("1e-10"))
    assert D(q["mid_rate"]) == mid
    assert D(q["quoted_rate"]) == quoted
    assert D(q["to_amount"]) == (D(10000) * quoted).quantize(D("0.01"), rounding=ROUND_DOWN) == D("105.24")
    assert D(q["fee"]) == D("25.00")                       # 0.25% of the source amount, shown up front
    assert D(q["total_debit"]) == D("10025.00")
    assert q["side"] == "BUY" and q["pair_symbol"] == "USD/INR"
    assert q["sufficient_balance"] is True and D(q["available_balance"]) == D("100000")
    assert q["validity_seconds"] == get_settings().quote_validity_seconds


def test_quote_by_target_amount(trader):
    q = quote(trader, "INR", "EUR", "50", amount_type="TARGET").json()
    assert D(q["to_amount"]) == D("50")
    assert D(q["from_amount"]) * D(q["quoted_rate"]) >= D("50")  # rounded up so the target is covered


def test_quote_validation(trader):
    assert quote(trader, "INR", "INR", "10").json()["error"]["code"] == "same_currency"
    assert quote(trader, "INR", "XYZ", "10").status_code == 404
    assert quote(trader, "INR", "JPY", "10.001").json()["error"]["code"] == "invalid_precision"
    assert quote(trader, "INR", "USD", "5").json()["error"]["code"] == "below_minimum"   # < 1 USD
    assert quote(trader, "INR", "USD", "-5").status_code == 422


def test_successful_trade_updates_both_holdings(trader):
    q, r = trade(trader, "INR", "USD", "10000")
    t = r["trade"]
    assert t["status"] == "COMPLETED" and t["trade_reference"].startswith("TRD-")
    assert D(t["executed_rate"]) == D(q["quoted_rate"])
    h = holdings_map(trader)
    assert h["INR"] == D("100000") - D("10000") - D("25.00")
    assert h["USD"] == D(q["to_amount"])
    types = [n["type"] for n in trader.get("/api/notifications").json()["items"]]
    assert "TRADE_SUCCESS" in types


def test_chain_trade_uses_held_currency_without_returning_to_base(trader):
    trade(trader, "INR", "USD", "20000")
    usd_before = holdings_map(trader)["USD"]
    q, _ = trade(trader, "USD", "EUR", "100")
    h = holdings_map(trader)
    assert h["USD"] == usd_before - D("100") - D(q["fee"])
    assert h["EUR"] == D(q["to_amount"])
    q2, _ = trade(trader, "EUR", "GBP", "50")  # INR → USD → EUR → GBP
    assert holdings_map(trader)["GBP"] == D(q2["to_amount"])


def test_insufficient_balance_rejected_and_nothing_changes(trader):
    before = holdings_map(trader)
    q = quote(trader, "INR", "USD", "99990").json()  # amount fits, amount + fee does not
    assert q["sufficient_balance"] is False
    r = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_balance"
    assert holdings_map(trader) == before
    assert trader.get("/api/trade/history").json()["total"] == 0
    types = [n["type"] for n in trader.get("/api/notifications").json()["items"]]
    assert "INSUFFICIENT_BALANCE" in types


def test_cannot_spend_currency_not_held(trader):
    q = quote(trader, "GBP", "USD", "10").json()
    r = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_balance"


def test_expired_quote_is_not_executed(trader, monkeypatch):
    monkeypatch.setattr(get_settings(), "quote_validity_seconds", 1)
    q = quote(trader, "INR", "USD", "1000").json()
    time.sleep(1.3)
    r = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]})
    assert r.status_code == 410 and r.json()["error"]["code"] == "quote_expired"
    assert trader.get(f"/api/trade/quote/{q['quote_id']}").json()["status"] == "EXPIRED"
    assert holdings_map(trader) == {"INR": D("100000")}
    again = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]})
    assert again.status_code == 409


def test_quote_rate_is_locked_even_if_market_moves(trader, db):
    q = quote(trader, "INR", "USD", "10000").json()
    # A new market snapshot 10% higher arrives before confirmation.
    db.execute(text("""INSERT INTO exchange_rate (pair_id, rate, recorded_at, provider, rate_type)
                       SELECT pair_id, rate * 1.1, now(), 'test-move', 'LIVE' FROM exchange_rate
                        WHERE pair_id = :p ORDER BY recorded_at DESC LIMIT 1"""), {"p": q["pair_id"]})
    db.commit()
    r = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]}).json()
    assert D(r["trade"]["executed_rate"]) == D(q["quoted_rate"])
    assert D(r["trade"]["to_amount"]) == D(q["to_amount"])


def test_double_execution_is_idempotent(trader):
    q = quote(trader, "INR", "USD", "5000").json()
    first = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]}, headers={"Idempotency-Key": "k-1"})
    second = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]})
    third = trader.post("/api/trade/execute", json={"quote_id": q["quote_id"]}, headers={"Idempotency-Key": "k-1"})
    assert first.status_code == 201
    assert second.status_code == 200 and second.json()["replayed"] is True
    assert third.status_code == 200 and third.json()["trade"]["trade_id"] == first.json()["trade"]["trade_id"]
    assert trader.get("/api/trade/history").json()["total"] == 1
    assert holdings_map(trader)["INR"] == D("100000") - D("5000") - D("12.50")
    other = quote(trader, "INR", "USD", "500").json()
    reused = trader.post("/api/trade/execute", json={"quote_id": other["quote_id"]}, headers={"Idempotency-Key": "k-1"})
    assert reused.status_code == 409 and reused.json()["error"]["code"] == "idempotency_key_reused"


def test_ledger_has_debit_fee_and_credit_entries(trader):
    q, r = trade(trader, "INR", "USD", "10000")
    entries = {e["entry_type"]: e for e in r["trade"]["ledger_entries"]}
    assert set(entries) == {"TRADE_DEBIT", "FEE_DEBIT", "TRADE_CREDIT"}
    assert (entries["TRADE_DEBIT"]["currency"]["currency_code"], D(entries["TRADE_DEBIT"]["amount"])) == ("INR", D("10000"))
    assert (entries["FEE_DEBIT"]["currency"]["currency_code"], D(entries["FEE_DEBIT"]["amount"])) == ("INR", D("25.00"))
    assert entries["TRADE_CREDIT"]["currency"]["currency_code"] == "USD"
    assert D(entries["TRADE_CREDIT"]["amount"]) == D(q["to_amount"])
    assert D(entries["FEE_DEBIT"]["balance_after"]) == D("89975.00")
    assert D(entries["TRADE_CREDIT"]["balance_after"]) == D(q["to_amount"])


def test_ledger_always_reconciles_with_holdings(trader, db):
    trade(trader, "INR", "USD", "15000")
    trade(trader, "USD", "EUR", "40")
    trade(trader, "EUR", "INR", "10")
    trader.post("/api/wallet/fund-demo", json={"amount": "5000"})
    rows = db.execute(text("""
        SELECT h.currency_id, h.quantity,
               coalesce(sum(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0) AS ledger
          FROM holding h LEFT JOIN ledger_entry l ON l.wallet_id = h.wallet_id AND l.currency_id = h.currency_id
      GROUP BY h.currency_id, h.quantity""")).all()
    assert rows and all(r.quantity == r.ledger for r in rows)


def test_portfolio_values_and_pnl(trader):
    q, _ = trade(trader, "INR", "USD", "10000")
    p = trader.get("/api/portfolio").json()
    h = {x["currency"]["currency_code"]: x for x in p["holdings"]}
    usd_qty = D(q["to_amount"])
    assert D(h["USD"]["current_value"]) == (usd_qty * D("94.92")).quantize(D("0.01"))
    # USD cost basis = INR actually exchanged (10,000); value is lower by the spread → small unrealized loss.
    assert D(h["USD"]["cost_basis"]) == D("10000.00")
    assert D(h["USD"]["unrealized_pnl"]) == D(h["USD"]["current_value"]) - D("10000.00")
    # The fee is a realized cost.
    assert D(p["realized_pnl"]) == D("-25.00")
    expected_total = (D("89975.00") + usd_qty * D("94.92")).quantize(D("0.01"))
    assert D(p["total_value"]) == expected_total
    assert D(p["overall_gain"]) == expected_total - D("100000")
    assert D(p["realized_pnl"]) + D(p["unrealized_pnl"]) == D(p["overall_gain"])
    assert p["currencies_held"] == 2
    alloc = trader.get("/api/portfolio/allocation").json()
    assert sum(D(s["allocation_pct"]) for s in alloc["slices"]) == pytest.approx(D(100), abs=D("0.02"))


def test_selling_back_books_realized_pnl(trader):
    q1, _ = trade(trader, "INR", "USD", "10000")
    q2, r2 = trade(trader, "USD", "INR", "50")
    pnl = r2["trade"]["pnl"]
    avg = D(10000) / D(q1["to_amount"])  # INR per USD paid
    disposed = D("50") + D(q2["fee"])
    assert D(pnl["quantity_disposed"]) == disposed
    assert D(pnl["realized_value"]) == D(q2["to_amount"])
    assert abs(D(pnl["cost_value"]) - disposed * avg) < D("0.01")
    assert D(pnl["profit_loss"]) == D(pnl["realized_value"]) - D(pnl["cost_value"])


def test_performance_history(trader):
    trade(trader, "INR", "USD", "10000")
    perf = trader.get("/api/portfolio/performance?range=1D").json()
    assert perf["points"] and D(perf["points"][-1]["invested"]) == D("100000.00")
    assert abs(D(perf["points"][-1]["value"]) - D(trader.get("/api/portfolio").json()["total_value"])) < D("1")


def test_users_cannot_see_or_use_each_others_data(make_client, trader):
    _, r = trade(trader, "INR", "USD", "10000")
    trade_id = r["trade"]["trade_id"]
    alice_quote = quote(trader, "INR", "USD", "1000").json()

    bob = make_client()
    register(bob, "bob")
    create_wallet(bob)
    assert bob.get(f"/api/trade/{trade_id}").status_code == 404
    assert bob.get(f"/api/trade/quote/{alice_quote['quote_id']}").status_code == 404
    stolen = bob.post("/api/trade/execute", json={"quote_id": alice_quote["quote_id"]})
    assert stolen.status_code == 404
    assert bob.get("/api/trade/history").json()["total"] == 0
    assert holdings_map(bob) == {"INR": D("100000")}
    assert all(e["reference"].startswith("FND") for e in bob.get("/api/wallet/ledger").json()["items"])
    assert trader.post("/api/trade/execute", json={"quote_id": alice_quote["quote_id"]}).status_code == 201


def test_trade_history_filters(trader):
    trade(trader, "INR", "USD", "10000")
    trade(trader, "USD", "INR", "20")
    trade(trader, "INR", "EUR", "5000")
    assert trader.get("/api/trade/history").json()["total"] == 3
    assert trader.get("/api/trade/history?side=SELL").json()["total"] == 1
    assert trader.get("/api/trade/history?currency=EUR").json()["total"] == 1
    assert trader.get("/api/trade/history?status=COMPLETED&date_from=2000-01-01").json()["total"] == 3
    assert trader.get("/api/trade/history?date_to=2000-01-01").json()["total"] == 0


# ── database-level guarantees ─────────────────────────────────────────────────────────────

def test_negative_holdings_impossible_even_via_sql(trader, db):
    wallet_id, inr = db.execute(text("SELECT wallet_id, currency_id FROM holding")).one()
    trade_like = db.execute(text("SELECT funding_id FROM wallet_funding LIMIT 1")).scalar_one()
    with pytest.raises(DBAPIError, match="quantity_non_negative"):
        db.execute(text("""INSERT INTO ledger_entry (wallet_id, currency_id, funding_id, entry_type, direction,
                           amount, reference) VALUES (:w, :c, :f, 'TRADE_DEBIT', 'DEBIT', 1000000, 'X')"""),
                   {"w": wallet_id, "c": inr, "f": trade_like})
    db.rollback()
    with pytest.raises(DBAPIError, match="only change through ledger"):
        db.execute(text("UPDATE holding SET quantity = quantity + 1 WHERE wallet_id = :w"), {"w": wallet_id})
    db.rollback()


def test_financial_records_are_immutable(trader, db):
    trade(trader, "INR", "USD", "10000")
    for stmt in ("UPDATE ledger_entry SET amount = 1", "DELETE FROM ledger_entry", "DELETE FROM trades",
                 "UPDATE trades SET to_amount = 999", "DELETE FROM exchange_rate", "UPDATE exchange_rate SET rate = 1",
                 "DELETE FROM wallet_funding", "DELETE FROM pnl_transaction", "DELETE FROM wallet"):
        with pytest.raises(DBAPIError):
            db.execute(text(stmt))
        db.rollback()


def test_quote_terms_cannot_be_altered(trader, db):
    q = quote(trader, "INR", "USD", "1000").json()
    with pytest.raises(DBAPIError, match="terms of a quote are fixed"):
        db.execute(text("UPDATE trade_quote SET to_amount = to_amount * 2 WHERE quote_id = :q"), {"q": q["quote_id"]})
    db.rollback()


# ── concurrency ───────────────────────────────────────────────────────────────────────────

def _run_parallel(fns):
    results = [None] * len(fns)
    barrier = threading.Barrier(len(fns))

    def runner(i, fn):
        barrier.wait()
        try:
            results[i] = fn()
        except Exception as exc:  # noqa: BLE001
            results[i] = exc

    threads = [threading.Thread(target=runner, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


def _executor(user_id, quote_id):
    from app.database.session import SessionLocal
    from app.models import User
    from app.trading.engine import execute_quote

    def run():
        s = SessionLocal()
        try:
            user = s.get(User, user_id)
            trade_, replayed = execute_quote(s, user, uuid.UUID(quote_id))
            return ("ok", trade_.trade_id, replayed)
        finally:
            s.close()
    return run


def test_concurrent_trades_cannot_double_spend(trader, db):
    user_id = db.execute(text("SELECT user_id FROM users")).scalar_one()
    # Each quote alone is affordable (60,000 + fee); together they exceed ₹1,00,000.
    quotes = [quote(trader, "INR", cur, "60000").json()["quote_id"] for cur in ("USD", "EUR", "GBP", "JPY")]
    results = _run_parallel([_executor(user_id, q) for q in quotes])
    ok = [r for r in results if isinstance(r, tuple)]
    failed = [r for r in results if not isinstance(r, tuple)]
    assert len(ok) == 1, results
    assert all(getattr(e, "code", None) == "insufficient_balance" for e in failed), failed
    assert holdings_map(trader)["INR"] == D("100000") - D("60000") - D("150.00")
    assert db.execute(text("SELECT count(*) FROM trades")).scalar_one() == 1


def test_same_quote_executed_concurrently_settles_once(trader, db):
    user_id = db.execute(text("SELECT user_id FROM users")).scalar_one()
    q = quote(trader, "INR", "USD", "20000").json()["quote_id"]
    results = _run_parallel([_executor(user_id, q) for _ in range(6)])
    assert all(isinstance(r, tuple) for r in results), results
    assert len({r[1] for r in results}) == 1               # one trade id
    assert sum(1 for r in results if not r[2]) == 1         # exactly one non-replayed settlement
    assert db.execute(text("SELECT count(*) FROM trades")).scalar_one() == 1
    assert db.execute(text("SELECT count(*) FROM ledger_entry WHERE trade_id IS NOT NULL")).scalar_one() == 3
    assert holdings_map(trader)["INR"] == D("100000") - D("20000") - D("50.00")
