"""Exchange-rate provider adapters.

Each provider returns USD-based rates (1 USD = x CCY) as Decimals plus the provider's own "as of"
timestamp when it publishes one. Documented JSON APIs only — no HTML scraping.

* coinbase     https://api.coinbase.com/v2/exchange-rates?currency=USD  (public, keyless, intraday)
* open_er_api  https://open.er-api.com/v6/latest/USD                   (public, keyless, ~daily; attribution:
               "Rates By Exchange Rate API" https://www.exchangerate-api.com)
* simulated    random walk from the last stored rates; rows are labelled rate_type='SIMULATED'.
               Opt-in only (RATE_PROVIDERS=simulated) for offline demos.
"""
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx


class ProviderError(Exception):
    pass


@dataclass
class ProviderResult:
    provider: str
    usd_rates: dict[str, Decimal]
    source_timestamp: datetime | None = None
    rate_type: str = "LIVE"
    notes: list[str] = field(default_factory=list)


def _decimal(value) -> Decimal | None:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not d.is_finite() or d <= 0:
        return None
    return d


class Provider:
    name = "base"
    rate_type = "LIVE"

    def __init__(self, timeout: float):
        self.timeout = timeout

    def fetch(self, codes: list[str]) -> ProviderResult:  # pragma: no cover - interface
        raise NotImplementedError

    def _get_json(self, url: str) -> dict:
        try:
            with httpx.Client(timeout=self.timeout, headers={"User-Agent": "ValoraMoney/1.0 (simulation)"}) as c:
                r = c.get(url)
                r.raise_for_status()
                return r.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"{self.name}: {exc}") from exc


class CoinbaseProvider(Provider):
    name = "coinbase"
    URL = "https://api.coinbase.com/v2/exchange-rates?currency=USD"

    def fetch(self, codes: list[str]) -> ProviderResult:
        data = self._get_json(self.URL)
        try:
            raw = data["data"]["rates"]
            if data["data"]["currency"] != "USD":
                raise ProviderError("coinbase: unexpected base currency")
        except (KeyError, TypeError) as exc:
            raise ProviderError(f"coinbase: malformed response ({exc})") from exc
        return ProviderResult(self.name, {c: d for c in codes if (d := _decimal(raw.get(c))) is not None})


class OpenErApiProvider(Provider):
    name = "open_er_api"
    URL = "https://open.er-api.com/v6/latest/USD"

    def fetch(self, codes: list[str]) -> ProviderResult:
        data = self._get_json(self.URL)
        if data.get("result") != "success" or data.get("base_code") != "USD":
            raise ProviderError(f"open_er_api: unsuccessful response ({data.get('error-type', 'unknown')})")
        raw = data.get("rates") or {}
        ts = data.get("time_last_update_unix")
        as_of = datetime.fromtimestamp(int(ts), tz=timezone.utc) if ts else None
        return ProviderResult(self.name, {c: d for c in codes if (d := _decimal(raw.get(c))) is not None}, as_of)


class SimulatedProvider(Provider):
    """Offline fallback: small random walk from the latest stored USD rates. Clearly labelled SIMULATED."""
    name = "simulated"
    rate_type = "SIMULATED"

    def __init__(self, timeout: float, last_usd_rates: dict[str, Decimal]):
        super().__init__(timeout)
        self.last = last_usd_rates

    def fetch(self, codes: list[str]) -> ProviderResult:
        out = {}
        for c in codes:
            prev = self.last.get(c)
            if prev is None:
                continue
            if c == "USD":
                out[c] = Decimal(1)
                continue
            shock = random.gauss(0, 0.00025)  # ~0.025% per tick
            out[c] = (prev * Decimal(str(math.exp(shock)))).quantize(Decimal("0.0000000001"))
        return ProviderResult(self.name, out, rate_type="SIMULATED", notes=["simulated random walk"])


def build(name: str, timeout: float, last_usd_rates: dict[str, Decimal]) -> Provider:
    if name == "coinbase":
        return CoinbaseProvider(timeout)
    if name == "open_er_api":
        return OpenErApiProvider(timeout)
    if name == "simulated":
        return SimulatedProvider(timeout, last_usd_rates)
    raise ValueError(f"Unknown rate provider '{name}'")
