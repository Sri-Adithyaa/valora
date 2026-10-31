"""Application settings, loaded from environment variables (and the repo-root `.env` for local runs)."""
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT_ENV, ".env"), extra="ignore")

    app_name: str = "Valora Money"
    environment: str = "development"

    database_url: str = "postgresql+psycopg://valora:change-me-locally@localhost:5433/valora"
    test_database_url: str = "postgresql+psycopg://valora:change-me-locally@localhost:5433/valora_test"

    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 720
    cookie_name: str = "valora_session"
    cookie_secure: bool = False

    cors_origins: str = "http://localhost:5173"

    # Simulation economics (expressed in INR, converted to the wallet's base currency)
    initial_funding_inr: Decimal = Decimal("100000")
    demo_funding_max_per_request_inr: Decimal = Decimal("500000")
    demo_funding_daily_limit_inr: Decimal = Decimal("1000000")
    trading_fee_rate: Decimal = Decimal("0.0025")
    quote_validity_seconds: int = 30
    max_quote_rate_age_hours: int = 72

    # Market-rate worker
    rate_update_interval_seconds: int = 120
    rate_providers: str = "coinbase,open_er_api"
    rate_provider_timeout_seconds: float = 10.0
    rate_provider_retries: int = 3
    rate_max_jump_pct: Decimal = Decimal("15")

    # Rate limiting for sensitive endpoints (requests per window per client)
    auth_rate_limit: int = 10
    trade_rate_limit: int = 30
    rate_limit_window_seconds: int = 60

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def provider_chain(self) -> list[str]:
        return [p.strip() for p in self.rate_providers.split(",") if p.strip()]

    # Market-status thresholds derived from the update interval.
    @property
    def live_threshold_seconds(self) -> int:
        return int(self.rate_update_interval_seconds * 2.5)

    @property
    def delayed_threshold_seconds(self) -> int:
        return max(self.rate_update_interval_seconds * 15, 1800)


@lru_cache
def get_settings() -> Settings:
    return Settings()
