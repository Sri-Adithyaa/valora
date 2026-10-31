# API Documentation

The interactive OpenAPI (Swagger) documentation is served by the backend at
**http://localhost:8000/docs** (ReDoc is at `/redoc`). A static copy of the spec is in
[openapi.json](openapi.json).

## Conventions

- **Base path:** `/api`. Requests and responses are JSON.
- **Authentication:** `POST /api/auth/login` or `/register` sets an httpOnly cookie, `valora_session`
  (SameSite=Lax). API clients may instead send the same signed token as
  `Authorization: Bearer <token>`. Every private endpoint checks that the session is unexpired and
  unrevoked, and scopes all data to the signed-in user.
- **Decimals are strings,** e.g. `"amount": "5000.00"`, to avoid floating-point rounding. The backend
  recalculates every amount; values sent by the client are never trusted.
- **Errors** always use the same shape:

  ```json
  { "error": { "code": "insufficient_balance", "message": "Insufficient INR balance: …", "details": {…} } }
  ```

  | Status | Typical codes |
  |---|---|
  | 401 | `not_authenticated`, `session_expired`, `invalid_credentials` |
  | 403 | `quote_wallet_mismatch`, `account_inactive` |
  | 404 | `wallet_required`, `quote_not_found`, `trade_not_found`, `currency_not_supported`, `pair_not_available` |
  | 409 | `email_taken`, `username_taken`, `wallet_exists`, `quote_not_pending`, `idempotency_key_reused` |
  | 410 | `quote_expired` |
  | 422 | `validation_error` (with per-field `details`), `insufficient_balance`, `below_minimum`, `invalid_precision`, `funding_limit`, `terms_not_accepted` |
  | 429 | `rate_limited` (login, register, password change, quote, execute, fund-demo) |
  | 503 | `market_data_unavailable` |

## Endpoints

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create an account (full name, username, email, phone, password + confirmation, country, base currency) and start a session |
| POST | `/api/auth/login` | `{identifier, password}`, where identifier is an email or username |
| POST | `/api/auth/logout` | Revoke the current session |
| GET | `/api/auth/me` | User, active wallet (or `null`) and unread notification count |
| PATCH | `/api/profile` | Edit full name, phone, country, preferred currency |
| POST | `/api/profile/password` | Change password; other sessions are revoked |

### Wallet
| Method | Path | Description |
|---|---|---|
| POST | `/api/wallet/create` | `{wallet_name, base_currency, country, accept_terms}` creates the single active wallet and credits the starting virtual balance (₹1,00,000 equivalent by default) |
| GET | `/api/wallet` | Wallet details, number of holdings and total value |
| GET | `/api/wallet/holdings` | Non-zero holdings with quantity, average cost, value, P&L and allocation |
| GET | `/api/wallet/summary` | Full valuation summary (same shape as `/api/portfolio`) |
| POST | `/api/wallet/fund-demo` | `{amount, currency?}` adds a **virtual** demo credit, limited per request and per day |
| GET | `/api/wallet/fundings` | Funding history |
| GET | `/api/wallet/ledger` | Paginated debit/credit audit trail (`?currency=&page=&page_size=`) |
| GET | `/api/wallet/activity` | Recent trades, funding and expired quotes |

### Market (public)
| Method | Path | Description |
|---|---|---|
| GET | `/api/market/currencies` | Supported currencies |
| GET | `/api/market/pairs` | Pairs; `?search=` matches code, name or country; `?featured=true`, `?currency=USD` |
| GET | `/api/market/pairs/lookup?from=EUR&to=USD` | The pair that trades FROM→TO, in either orientation |
| GET | `/api/market/rates` | Latest rate, the rate 24 h earlier, change and % change, timestamp, provider, freshness |
| GET | `/api/market/pairs/{pair_id}/history?range=1H\|6H\|1D\|1W\|1M\|3M\|1Y&invert=false` | Bucketed OHLC points; each carries `simulated: true/false` |
| GET | `/api/market/status` | `LIVE` / `DELAYED` / `STALE` / `UNAVAILABLE`, FX session (weekend closure), last update, provider |

### Trading
| Method | Path | Description |
|---|---|---|
| POST | `/api/trade/quote` | `{from_currency, to_currency, amount, amount_type}`. `SOURCE` = amount to spend (sell / exchange); `TARGET` = amount to receive (buy). Returns a quote locked for 30 s (configurable) |
| GET | `/api/trade/quote/{quote_id}` | Re-read a quote (status, countdown) |
| POST | `/api/trade/execute` | `{quote_id}` plus an optional `Idempotency-Key` header. **201** = executed; **200** with `replayed: true` = a safe repeat that returns the original trade |
| GET | `/api/trade/history` | `?currency=&side=BUY\|SELL&status=COMPLETED&date_from=&date_to=&page=&page_size=` |
| GET | `/api/trade/{trade_id}` | Trade detail with ledger entries and realized P&L |

### Portfolio
| Method | Path | Description |
|---|---|---|
| GET | `/api/portfolio` | Total value, funded amount, overall gain, realized/unrealized P&L, daily movement, holdings |
| GET | `/api/portfolio/performance?range=1D\|1W\|1M\|3M\|1Y\|ALL` | Value, invested amount and P&L over time |
| GET | `/api/portfolio/allocation` | Allocation by currency |

### Notifications and watchlist
| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | `?unread_only=&limit=`; returns `{unread, items}` |
| PATCH | `/api/notifications/{id}/read` | Mark one notification read |
| POST | `/api/notifications/read-all` | Mark all read |
| GET / POST / DELETE | `/api/watchlist`, `/api/watchlist/{pair_id}` | Favourite pairs |

## Worked example: quote and execute

```http
POST /api/trade/quote
{"from_currency": "INR", "to_currency": "USD", "amount": "10000", "amount_type": "SOURCE"}

201 Created
{ "quote_id": "4d0c…", "side": "BUY", "pair_symbol": "USD/INR",
  "from_amount": "10000.00", "to_amount": "105.24", "fee": "25.00", "total_debit": "10025.00",
  "mid_rate": "0.0105351875", "quoted_rate": "0.0105246523", "inverse_rate": "95.0149…",
  "expires_at": "…+30s", "available_balance": "100000.00", "sufficient_balance": true, … }

POST /api/trade/execute            Idempotency-Key: 6f1e…
{"quote_id": "4d0c…"}

201 Created
{ "replayed": false,
  "trade": { "trade_reference": "TRD-261101-6XLFTN", "executed_rate": "0.0105246523",
             "ledger_entries": [ TRADE_DEBIT 10000 INR, FEE_DEBIT 25 INR, TRADE_CREDIT 105.24 USD ],
             "pnl": { "profit_loss": "-25.0000", … }, … },
  "holdings": [ … updated balances … ] }
```

## How a trade executes

1. Authenticate the user and load their active wallet.
2. `SELECT … FOR UPDATE` the quote. Concurrent executions of the same quote queue here; the later
   ones find it `EXECUTED` and return the original trade.
3. Check ownership, that the quote is `PENDING`, and that it hasn't expired.
4. Lock both holdings in a fixed order (by currency id) to avoid deadlocks.
5. Check that the balance covers the amount plus the fee.
6. Mark the quote executed, then insert the order, the trade (exact rate and amounts), the ledger
   entries (the trigger moves the balances), the target holding's new average cost, and the P&L row.
7. COMMIT. Deferred triggers confirm the ledger balances the trade. Any failure rolls everything
   back, and the failure notification is written in a separate transaction.
