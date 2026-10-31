"""One market-rate update cycle.

1. Fetch USD-based rates from the first provider in the chain that succeeds (timeout + retries/backoff).
2. Validate: every supported currency present, finite and positive.
3. Normalise to each pair's orientation (1 BASE = rate QUOTE) via USD cross rates.
4. Reject per-pair jumps above RATE_MAX_JUMP_PCT versus the last valid rate (keeps the last valid one).
5. Append a timestamped snapshot per pair — history is never overwritten.
6. Log the run in rate_provider_log; notify users when market data becomes unavailable / is restored.

A failed cycle writes nothing to exchange_rate, so the last valid rate stays in force and the API
reports it as Delayed/Stale with its timestamp.
"""
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.money import q_rate
from app.models import Currency, CurrencyPair, ExchangeRate, RateProviderLog
from app.services import rates as rates_svc
from app.services.notifications import notify_all_wallet_holders
from app.trading.engine import expire_stale_quotes
from market_worker import providers

log = logging.getLogger("valora.rates")

ADVISORY_LOCK_KEY = 74_2026_001  # one updater at a time across processes


def _last_usd_rates(db: Session, pairs: list[CurrencyPair], codes: dict[int, str]) -> dict[str, Decimal]:
    book = rates_svc.RateBook(pairs, rates_svc.snapshots_at(db))
    usd_id = next((cid for cid, code in codes.items() if code == "USD"), None)
    if usd_id is None:
        return {}
    return {code: r for cid, code in codes.items() if (r := book.rate(usd_id, cid)) is not None}


def fetch_with_retries(provider: providers.Provider, codes: list[str], retries: int) -> tuple[providers.ProviderResult, int]:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return provider.fetch(codes), attempt
        except providers.ProviderError as exc:
            last_exc = exc
            log.warning("provider %s attempt %d/%d failed: %s", provider.name, attempt, retries, exc)
            if attempt < retries:
                time.sleep(min(2 ** (attempt - 1), 8))
    raise providers.ProviderError(str(last_exc)) from last_exc


def run_update(db: Session, now: datetime | None = None, provider_override: providers.Provider | None = None) -> dict:
    s = get_settings()
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    started = datetime.now(timezone.utc)

    if not db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": ADVISORY_LOCK_KEY}).scalar():
        db.rollback()
        return {"status": "SKIPPED", "reason": "another updater is running"}

    currencies = db.scalars(select(Currency).where(Currency.status == "ACTIVE")).all()
    codes = {c.currency_id: c.currency_code for c in currencies}
    pairs = rates_svc.active_pairs(db)
    if not pairs:
        db.rollback()
        return {"status": "SKIPPED", "reason": "no active pairs"}
    last_snaps = rates_svc.snapshots_at(db)
    needed = sorted(set(codes.values()))

    chain = [provider_override] if provider_override else [
        providers.build(name, s.rate_provider_timeout_seconds, _last_usd_rates(db, pairs, codes))
        for name in s.provider_chain]

    result = None
    attempts = 0
    errors: list[str] = []
    for provider in chain:
        try:
            result, n = fetch_with_retries(provider, needed, s.rate_provider_retries)
            attempts += n
            missing = [c for c in needed if c not in result.usd_rates and c != "USD"]
            if len(missing) == len(needed) - 1:
                raise providers.ProviderError(f"{provider.name}: no supported currencies in response")
            break
        except providers.ProviderError as exc:
            attempts += s.rate_provider_retries
            errors.append(str(exc))
            result = None

    prev_log = db.scalars(select(RateProviderLog).where(RateProviderLog.status != "SKIPPED")
                          .order_by(RateProviderLog.started_at.desc()).limit(1)).first()

    if result is None:
        db.add(RateProviderLog(provider=",".join(s.provider_chain), started_at=started,
                               finished_at=datetime.now(timezone.utc), status="FAILED", attempts=attempts,
                               message="; ".join(errors)[:2000]))
        if prev_log is None or prev_log.status != "FAILED":
            notify_all_wallet_holders(
                db, "MARKET_DATA_UNAVAILABLE", "Market data unavailable",
                "We could not refresh exchange rates. The last valid rates remain in use and are marked stale.",
                "WARNING")
        db.commit()
        log.error("rate update failed: %s", errors)
        return {"status": "FAILED", "errors": errors}

    usd = dict(result.usd_rates)
    usd["USD"] = Decimal(1)
    rows, rejected = [], []
    max_jump = s.rate_max_jump_pct / 100
    for p in pairs:
        b, q = codes.get(p.base_currency_id), codes.get(p.quote_currency_id)
        if b not in usd or q not in usd:
            rejected.append(f"{p.symbol}: missing from provider")
            continue
        rate = q_rate(usd[q] / usd[b])
        if rate <= 0:
            rejected.append(f"{p.symbol}: non-positive")
            continue
        prev = last_snaps.get(p.pair_id)
        if prev is not None and abs(rate / prev.rate - 1) > max_jump:
            rejected.append(f"{p.symbol}: jump {rate} vs {prev.rate} exceeds {s.rate_max_jump_pct}%")
            continue
        rows.append({"pair_id": p.pair_id, "rate": rate, "recorded_at": now,
                     "source_timestamp": result.source_timestamp, "provider": result.provider,
                     "rate_type": result.rate_type})

    inserted = 0
    if rows:
        res = db.execute(pg_insert(ExchangeRate).values(rows).on_conflict_do_nothing(
            constraint="uq_rate_pair_time_provider").returning(ExchangeRate.rate_id))
        inserted = len(res.all())
    status = "SUCCESS" if not rejected else ("PARTIAL" if inserted else "FAILED")
    db.add(RateProviderLog(provider=result.provider, started_at=started, finished_at=datetime.now(timezone.utc),
                           status=status, attempts=attempts, pairs_updated=inserted, pairs_rejected=len(rejected),
                           source_timestamp=result.source_timestamp,
                           message="; ".join(errors + rejected)[:2000] or None))
    if status != "FAILED" and prev_log is not None and prev_log.status == "FAILED":
        notify_all_wallet_holders(db, "MARKET_DATA_RESTORED", "Market data restored",
                                  f"Exchange rates are updating again (source: {result.provider}).", "SUCCESS")
    db.commit()
    expired = expire_stale_quotes(db)
    log.info("rate update %s via %s: %d pairs stored, %d rejected, %d quotes expired",
             status, result.provider, inserted, len(rejected), expired)
    return {"status": status, "provider": result.provider, "inserted": inserted, "rejected": rejected,
            "expired_quotes": expired}
