from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from app.services import rates as rates_svc
from market_worker import providers
from market_worker.rate_updater import run_update
from tests import conftest
from tests.conftest import create_wallet, register

D = Decimal


class FakeProvider(providers.Provider):
    name = "fake"

    def __init__(self, usd_rates=None, error=None, as_of=None):
        super().__init__(1)
        self.usd_rates, self.error, self.as_of = usd_rates, error, as_of

    def fetch(self, codes):
        if self.error:
            raise providers.ProviderError(self.error)
        return providers.ProviderResult(self.name, {c: v for c, v in self.usd_rates.items() if c in codes},
                                        self.as_of)


def _scaled(factor: str) -> dict[str, Decimal]:
    return {c: (v * D(factor) if c != "USD" else v) for c, v in conftest.REF.items()}


_tick = iter(range(1, 10_000))


def _soon():
    """A distinct future timestamp per update cycle (same-second cycles are deduplicated by design)."""
    return datetime.now(timezone.utc) + timedelta(seconds=next(_tick))


def _pair_id(db, symbol):
    return db.execute(text("SELECT pair_id FROM currency_pair WHERE symbol = :s"), {"s": symbol}).scalar_one()


def test_currency_catalogue_and_pairs(make_client):
    c = make_client()
    codes = [x["currency_code"] for x in c.get("/api/market/currencies").json()]
    assert {"INR", "USD", "EUR", "GBP", "JPY"} <= set(codes)
    pairs = c.get("/api/market/pairs").json()
    symbols = {p["symbol"] for p in pairs}
    assert {"USD/INR", "EUR/INR", "GBP/INR", "USD/EUR", "USD/GBP", "EUR/GBP", "USD/JPY", "GBP/JPY"} <= symbols
    assert not any(f"{p['quote']['currency_code']}/{p['base']['currency_code']}" in symbols for p in pairs)


def test_pair_search_by_code_name_and_country(make_client):
    c = make_client()
    by = lambda term: {p["symbol"] for p in c.get(f"/api/market/pairs?search={term}").json()}  # noqa: E731
    assert "USD/EUR" in by("euro") and all("EUR" in s for s in by("euro"))
    assert by("british pound") == by("GBP") and "GBP/INR" in by("British Pound")
    assert all("JPY" in s for s in by("japan")) and by("japan")
    assert by("usdinr") == {"USD/INR"}
    assert c.get("/api/market/pairs/lookup?from=EUR&to=USD").json()["symbol"] == "USD/EUR"


def test_latest_rates_and_status(make_client):
    c = make_client()
    rates = {r["symbol"]: r for r in c.get("/api/market/rates").json()}
    assert D(rates["USD/INR"]["rate"]) == D("94.92")
    assert rates["USD/INR"]["freshness"] == "LIVE"
    assert D(rates["USD/INR"]["change_pct"]) == D(0)
    st = c.get("/api/market/status").json()
    assert st["status"] in ("LIVE", "DELAYED") and st["update_interval_seconds"] == 120


def test_rate_update_appends_history_without_overwriting(db):
    pid = _pair_id(db, "USD/EUR")
    before = db.execute(text("SELECT count(*) FROM exchange_rate WHERE pair_id = :p"), {"p": pid}).scalar_one()
    res = run_update(db, now=_soon(), provider_override=FakeProvider(_scaled("1.01")))
    assert res["status"] == "SUCCESS" and res["inserted"] == 45
    after = db.execute(text("SELECT count(*) FROM exchange_rate WHERE pair_id = :p"), {"p": pid}).scalar_one()
    assert after == before + 1
    latest = rates_svc.latest_snapshot(db, pid)
    assert latest.provider == "fake" and latest.rate == D("0.8945") * D("1.01")
    # Same timestamp again → duplicate protection, nothing new stored.
    again = run_update(db, now=latest.recorded_at, provider_override=FakeProvider(_scaled("1.01")))
    assert again["inserted"] == 0
    log = db.execute(text("SELECT status, provider, pairs_updated FROM rate_provider_log ORDER BY log_id")).all()
    assert log[0] == ("SUCCESS", "fake", 45)


def test_invalid_and_jumping_rates_are_rejected(db):
    bad = dict(conftest.REF)
    bad["EUR"] = D("0")             # invalid value → rejected, EUR pairs keep their last rate
    bad["JPY"] = D("400")           # 150% jump → rejected by the jump guard
    res = run_update(db, now=_soon(), provider_override=FakeProvider(bad))
    assert res["status"] == "PARTIAL"
    assert any("USD/EUR" in r for r in res["rejected"]) and any("USD/JPY" in r for r in res["rejected"])
    assert rates_svc.latest_snapshot(db, _pair_id(db, "USD/JPY")).rate == D("157.59")
    assert rates_svc.latest_snapshot(db, _pair_id(db, "USD/INR")).provider == "fake"


def test_provider_failure_keeps_last_valid_rate_and_notifies(make_client, db):
    c = make_client()
    register(c, "alice")
    create_wallet(c)
    pid = _pair_id(db, "USD/INR")
    last = rates_svc.latest_snapshot(db, pid)
    res = run_update(db, now=_soon(), provider_override=FakeProvider(error="timeout"))
    assert res["status"] == "FAILED"
    assert rates_svc.latest_snapshot(db, pid).rate_id == last.rate_id
    st = c.get("/api/market/status").json()
    assert st["provider_available"] is False and st["status"] != "LIVE"
    assert "MARKET_DATA_UNAVAILABLE" in [n["type"] for n in c.get("/api/notifications").json()["items"]]
    run_update(db, now=_soon(), provider_override=FakeProvider(dict(conftest.REF)))
    assert "MARKET_DATA_RESTORED" in [n["type"] for n in c.get("/api/notifications").json()["items"]]


def test_freshness_thresholds():
    now = datetime.now(timezone.utc)
    assert rates_svc.freshness(now - timedelta(seconds=30), now) == "LIVE"
    assert rates_svc.freshness(now - timedelta(minutes=20), now) == "DELAYED"
    assert rates_svc.freshness(now - timedelta(hours=3), now) == "STALE"
    assert rates_svc.freshness(None, now) == "UNAVAILABLE"
    assert rates_svc.fx_session(datetime(2026, 10, 31, 12, tzinfo=timezone.utc)) == "CLOSED"   # Saturday
    assert rates_svc.fx_session(datetime(2026, 10, 28, 12, tzinfo=timezone.utc)) == "OPEN"     # Wednesday


def test_historical_rate_retrieval_and_inversion(make_client, db):
    c = make_client()
    pid = _pair_id(db, "USD/INR")
    h = c.get(f"/api/market/pairs/{pid}/history?range=1W").json()
    pts = h["points"]
    assert len(pts) >= 70 and h["display_symbol"] == "USD/INR"
    times = [p["time"] for p in pts]
    assert times == sorted(times)
    assert D(pts[-1]["close"]) == D("94.92")
    inv = c.get(f"/api/market/pairs/{pid}/history?range=1W&invert=true").json()
    assert inv["display_symbol"] == "INR/USD"
    assert abs(D(inv["points"][-1]["close"]) - D(1) / D("94.92")) < D("1e-9")
    assert c.get(f"/api/market/pairs/{pid}/history?range=5Y").status_code == 422


def test_stale_quotes_are_rejected(make_client, db, monkeypatch):
    c = make_client()
    register(c, "alice")
    create_wallet(c)
    from app.trading import engine
    real_now = engine._now
    monkeypatch.setattr(engine, "_now", lambda: real_now() + timedelta(days=10))  # 10 days without updates
    r = c.post("/api/trade/quote", json={"from_currency": "INR", "to_currency": "USD", "amount": "1000"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "market_data_unavailable"
