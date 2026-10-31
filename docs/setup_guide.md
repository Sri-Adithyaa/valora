# Setup Guide

There are two ways to run Valora Money locally:

- **[Option A: native dev setup](#option-a-native-development-setup).** PostgreSQL runs in Docker;
  the API, the worker and the frontend run from your shell with hot reload. Use this for development.
- **[Option B: everything in Docker](#option-b-everything-in-docker).** A single command, no
  Python or Node needed.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Docker Desktop | 24+ | PostgreSQL (both options); the full stack (option B) |
| Python | 3.11+ | Backend and worker (option A) |
| Node.js | 20+ (npm 10+) | Frontend (option A) |
| Git, VS Code, pgAdmin (optional) | any | Development and database browsing |

## 1. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

- Set `POSTGRES_PASSWORD`, and use the same password inside `DATABASE_URL` and `TEST_DATABASE_URL`.
- Set `JWT_SECRET` to a long random string:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`

`.env` is git-ignored. Never commit it.

## Option A: native development setup

### 2. Start PostgreSQL

```bash
docker compose up -d db          # PostgreSQL 16 on localhost:5433
```

To browse the database visually, run `docker compose up -d pgadmin` and open <http://localhost:5050>.
It comes pre-connected. See [database_visual_tour.md](database_visual_tour.md).

### 3. Backend: dependencies, migrations, seed data

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate        macOS/Linux:  source .venv/bin/activate
pip install -r requirements-dev.txt

alembic upgrade head              # creates all tables and the financial-integrity triggers
python -m app.seed                # demo data (use --reset to wipe and rebuild)
```

The seed script creates:

- 10 currencies and all 45 pairs
- about a year of **simulated** rate history (labelled `SIMULATED_SEED`, anchored to today's live
  rate when the network is reachable)
- three demo users, each with a wallet, virtual funding and trades
- one live rate refresh at the end

### 4. Run the API

```bash
uvicorn app.main:app --reload --port 8000
```

Swagger UI is at http://localhost:8000/docs and the health check at http://localhost:8000/api/health.

### 5. Run the market-rate worker (second terminal)

```bash
cd backend && .venv\Scripts\activate
python -m market_worker.scheduler          # refreshes every RATE_UPDATE_INTERVAL_SECONDS (default 120)
python -m market_worker.scheduler --once   # a single refresh, then exit
```

Providers are tried in the order given by `RATE_PROVIDERS` (default `coinbase,open_er_api`). If none
can be reached, the last valid rates stay in force and the UI shows them as **Delayed** or **Stale**.
For a fully offline demo, set `RATE_PROVIDERS=simulated`; those rows are labelled `SIMULATED`.

FX markets close at weekends (Friday 21:00 UTC to Sunday 21:00 UTC). Providers republish the Friday
close during that time, and the UI shows **FX market closed**.

### 6. Run the frontend (third terminal)

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173 (proxies /api to http://localhost:8000)
```

### 7. Log in

| Username | Email | Password | Base currency |
|---|---|---|---|
| `demo` | demo@valora.money | `ValoraDemo123` | INR |
| `maya.chen` | maya@valora.money | `ValoraDemo123` | USD |
| `oliver.b` | oliver@valora.money | `ValoraDemo123` | GBP |

These are local demonstration accounts only. You can also register a new user and walk through
wallet setup.

## Option B: everything in Docker

```bash
cp .env.example .env              # then edit secrets as in step 1
docker compose --profile app up -d --build
```

| Service | URL |
|---|---|
| Web app (nginx serving the built frontend; proxies `/api`) | http://localhost:8080 |
| API + Swagger | http://localhost:8000/docs |
| PostgreSQL | localhost:5433 |

The `api` container runs the migrations and seeds the database the first time it starts
(`--if-empty`). The `worker` container refreshes rates every 2 minutes.

To stop everything, run `docker compose --profile app down`. Add `-v` to also delete the database
volume.

## Running the tests

### Backend
The backend tests use a separate database (`TEST_DATABASE_URL`, default `valora_test`), which is
created and migrated automatically. PostgreSQL must be running.

```bash
cd backend
pytest -q
```

The 49 tests cover:

- auth, wallets and funding limits
- search, rate updates and history
- quotes, expiry, trades, the ledger and P&L
- isolation between users
- database immutability
- concurrent double-spend and double-execution attempts

### Frontend
```bash
cd frontend
npm test
```

## Production build

```bash
cd frontend && npm run build     # static files in frontend/dist
```

For a production deployment:

- Serve `dist` behind a reverse proxy that forwards `/api` to the API (see `frontend/nginx.conf`).
- Set `COOKIE_SECURE=true`, a real `JWT_SECRET` and `CORS_ORIGINS`, and run more than one uvicorn
  worker behind it.
- The built-in rate limiter works per process. With several workers or replicas, replace it with a
  shared store such as Redis.
- Run exactly **one** market worker. A PostgreSQL advisory lock also stops two workers from writing
  the same cycle.
- Give the application database role no `TRUNCATE` privilege. The integrity triggers guard against
  row-level updates and deletes.

## Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `INITIAL_FUNDING_INR` | 100000 | Starting virtual balance, converted to the wallet's base currency |
| `DEMO_FUNDING_MAX_PER_REQUEST_INR` / `DEMO_FUNDING_DAILY_LIMIT_INR` | 500000 / 1000000 | Limits on demo credits |
| `TRADING_FEE_RATE` | 0.0025 | Simulated fee (0.25% of the source amount), shown before confirmation |
| `QUOTE_VALIDITY_SECONDS` | 30 | How long a quote's rate stays locked |
| `MAX_QUOTE_RATE_AGE_HOURS` | 72 | Refuse new quotes if the latest stored rate is older than this |
| `RATE_UPDATE_INTERVAL_SECONDS` | 120 | Worker interval |
| `RATE_PROVIDERS` | coinbase,open_er_api | Provider fallback chain (`simulated` is available for offline demos) |
| `RATE_PROVIDER_TIMEOUT_SECONDS` / `RATE_PROVIDER_RETRIES` | 10 / 3 | Per-provider timeout and retries (exponential backoff) |
| `RATE_MAX_JUMP_PCT` | 15 | Reject a pair whose rate jumps more than this between updates |
| `ACCESS_TOKEN_MINUTES` | 720 | Session lifetime |
| `COOKIE_SECURE` | false | Set to true when serving over HTTPS |
| `CORS_ORIGINS` | http://localhost:5173 | Allowed browser origins |

## Troubleshooting

- **`connection refused` on port 5433.** Run `docker compose up -d db` and wait for it to report
  healthy.
- **The market status shows Stale.** Start the worker, or run
  `python -m market_worker.scheduler --once`.
- **You want to rebuild the demo data.** Run `python -m app.seed --reset`. This truncates every table.
