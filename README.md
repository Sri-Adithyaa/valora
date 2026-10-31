# Valora Money — The Money Market

**Where Money Becomes an Asset.**

Valora Money is a simulated trading platform that treats currencies as tradable assets. Each user
has one **Valora Wallet** that holds several currencies at once. Any currency you hold can be used to
buy any other directly (INR → USD → EUR → GBP), with no need to convert back to your home currency
in between. The app tracks the value, cost basis and profit/loss of every holding, the way a
brokerage app tracks shares.

> **SIMULATION MODE.** All balances and transactions are virtual. No real money is transferred, and
> there are no bank, payment-gateway or settlement integrations.

## Features

- **Accounts:** registration with validation, login by email or username, Argon2 password hashing,
  revocable httpOnly-cookie sessions, profile editing and password change.
- **Wallet:** one active wallet per user with a reference number (`VLM-xxxx-xxxx-xxxx`) and a
  starting virtual balance equal to ₹1,00,000 (configurable). It holds many currencies, one holding
  row per currency. Demo credits are limited and recorded in the ledger.
- **Markets:** 10 currencies and all 45 pairs, configurable in the database. Search by code, name
  or country. Shows the latest rate, the rate 24 h earlier, the change, and a
  Live / Delayed / Stale indicator.
- **Live rate engine:** a Python worker on APScheduler refreshes rates every 120 s (configurable)
  from documented public APIs (Coinbase, with open.er-api as fallback). It retries with timeouts,
  validates every value, guards against sudden jumps, and logs each run. History is append-only.
  If the providers fail, the last valid rate is kept and clearly marked stale.
- **Quotes:** a quote locks the rate for 30 s, shows the fee before you confirm, and can't be
  executed after it expires.
- **Atomic trading engine:** each trade runs as one PostgreSQL transaction with row-level locks, so
  balances can't go negative and money can't be spent twice. Repeated requests return the original
  trade instead of executing again.
- **Ledger:** every trade writes debit, fee and credit entries, and **database triggers** keep
  holdings consistent with the ledger and make financial records immutable.
- **Portfolio:** weighted-average cost basis, realized and unrealized P&L, allocation, and portfolio
  value over time (rebuilt from the ledger and rate history).
- **Trading UI:** a trading-terminal layout with an interactive TradingView Lightweight Charts price
  chart (1H to 1Y, line or candles), a watchlist, buy and sell/exchange panels, a quote countdown
  and a confirmation step.
- **History and notifications:** a filterable transaction history, trade detail with ledger entries,
  and in-app notifications.

## Architecture

```text
Browser ── React + TypeScript + Tailwind (Vite) ──/api──► FastAPI (REST, Pydantic, SQLAlchemy)
                                                              │  trading engine · P&L · auth
                                                              ▼
Coinbase / open.er-api ──► market_worker (APScheduler) ──► PostgreSQL 16
                           validate · normalise · store     constraints + triggers + Alembic
```

The frontend never calculates or changes balances. Every financial operation goes through the
backend and a database transaction.

## Quick start

```bash
cp .env.example .env                       # then set POSTGRES_PASSWORD (in all 3 places) and JWT_SECRET
docker compose --profile app up -d --build
```

Open **<http://localhost:8080>**, or <http://localhost:8000/docs> for the API. Log in as `demo` with
the password `ValoraDemo123`. This is a local demo account.

For hot-reload development (Postgres in Docker; API, worker and frontend run natively), see
[docs/setup_guide.md](docs/setup_guide.md).

## Project structure

```text
valora/
├── backend/
│   ├── app/
│   │   ├── api/            # REST routers: auth, wallet, market, trade, portfolio, notifications
│   │   ├── core/           # settings, security, errors, rate limiting, Decimal helpers
│   │   ├── database/       # engine/session, declarative base
│   │   ├── models/         # SQLAlchemy models (17 tables)
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── services/       # rates, wallet, portfolio, notifications, catalogue
│   │   ├── trading/        # quote + atomic execution engine
│   │   ├── seed.py         # demonstration data
│   │   └── main.py
│   ├── market_worker/      # providers.py, rate_updater.py, scheduler.py
│   ├── migrations/         # Alembic: schema + financial-integrity triggers
│   └── tests/              # pytest suite (real PostgreSQL)
├── frontend/               # React + TypeScript + Tailwind app
├── docs/                   # setup, schema, API, P&L methodology, openapi.json
├── docker-compose.yml
└── .env.example
```

## Documentation

- [Setup guide](docs/setup_guide.md): installation, running, tests, production build,
  configuration
- [Database schema](docs/database_schema.md): tables, constraints, triggers, ER diagram
- [Visual database tour](docs/database_visual_tour.md): pgAdmin at <http://localhost:5050>, ERD, demo queries
- [API documentation](docs/api_documentation.md): endpoints, error model, trade execution
- [P&L methodology](docs/pnl_methodology.md): weighted-average cost, realized vs unrealized

## Tests

```bash
cd backend && pytest -q        # 49 tests against a real PostgreSQL test database
cd frontend && npm test        # component and helper tests (Vitest + Testing Library)
```

## Data honesty

- **Seeded chart history is simulated.** It is stored as `rate_type = SIMULATED_SEED`, and the
  charts label it. Live snapshots come from the providers.
- **Rates refresh every ~2 minutes,** never tick by tick. The status indicator and timestamps always
  show how old the data is.
- **Free FX data has limits.** Free sources move slowly or not at all at weekends, when FX markets
  are closed, and the UI says so.

## Not in this version

- Real deposits, withdrawals, bank or payment-gateway integration. The design keeps the funding
  path separate, so one could be added later.
- Limit orders. The `orders` table already has `order_type` and `target_rate` for them.
- Multiple wallets per user, email verification and password reset by email.

## Licence

MIT. See [LICENSE](LICENSE).
