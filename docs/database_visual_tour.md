# Viewing the Database Visually (pgAdmin)

pgAdmin ships with the project as a Docker service. It is already connected to the Valora database,
so there is nothing to configure.

## Start it

```bash
docker compose up -d db pgadmin
```

Open **<http://localhost:5050>**. There is no pgAdmin login in this local setup. In the left panel,
open **Valora → Valora Money (local)**. The database password is filled in automatically from `.env`.

> pgAdmin listens only on `127.0.0.1`, so other machines on the network can't reach it. It is meant
> for local demonstrations, not for a public server.

## Where to find things

| What to show | Where in pgAdmin |
|---|---|
| All 17 tables | Databases → **valora** → Schemas → **public** → **Tables** |
| A table's columns, types, constraints | Expand a table → *Columns*, *Constraints* (primary key, foreign key, unique, check) |
| The full `CREATE TABLE` statement | Select a table → **SQL** tab (top of the right panel) |
| Indexes | Expand a table → *Indexes* |
| Triggers on a table | Expand a table → *Triggers* (e.g. `ledger_entry`, `holding`, `trade_quote`) |
| Trigger functions (the PL/pgSQL code) | Schemas → public → **Trigger Functions** → select one → **SQL** tab |
| Table contents | Right-click a table → **View/Edit Data → First 100 Rows** |
| How tables relate | Select a table → **Dependencies** / **Dependents** tabs |

## Draw the ER diagram

Right-click the **valora** database and choose **ERD For Database**. pgAdmin draws every table with
its columns, primary keys and foreign-key links. Drag the tables to tidy the layout, then use the
toolbar's **Download image** button to save a PNG for slides or reports. A text version of the same
diagram (Mermaid) is in [database_schema.md](database_schema.md).

## A suggested walkthrough for a demonstration

1. **Structure.** Open the ERD. Point out that `wallet` is the account, `holding` holds one balance
   per currency (`UNIQUE (wallet_id, currency_id)`), and trades link `trade_quote → orders → trades
   → ledger_entry`.
2. **Data types.** Open `holding` → Columns: `quantity` is `numeric(24,8)`, and there is no float
   anywhere.
3. **Rules in the database.** Open `holding` → Constraints → Check: `quantity >= 0`. Then open
   `ledger_entry` → Triggers and show `trg_ledger_apply`.
4. **Live proof.** Open the **Query Tool** (right-click *valora* → Query Tool) and run the queries
   below.

### Queries that show off the design

```sql
-- One wallet, many currency holdings
SELECT u.username, w.wallet_reference, c.currency_code, h.quantity, h.average_cost
  FROM holding h
  JOIN wallet w   ON w.wallet_id = h.wallet_id
  JOIN users u    ON u.user_id = w.user_id
  JOIN currency c ON c.currency_id = h.currency_id
 WHERE u.username = 'demo' AND h.quantity > 0;

-- The ledger always reconciles with the holdings (should return zero rows)
SELECT h.wallet_id, h.currency_id, h.quantity,
       sum(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END) AS ledger_total
  FROM holding h JOIN ledger_entry l USING (wallet_id, currency_id)
 GROUP BY h.wallet_id, h.currency_id, h.quantity
HAVING h.quantity <> sum(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END);

-- One trade and its debit / fee / credit entries
SELECT t.trade_reference, l.entry_type, c.currency_code, l.amount, l.balance_after
  FROM trades t JOIN ledger_entry l ON l.trade_id = t.trade_id
  JOIN currency c ON c.currency_id = l.currency_id
 ORDER BY t.trade_id DESC, l.ledger_id LIMIT 6;

-- Rate history is appended, never overwritten
SELECT p.symbol, r.rate, r.recorded_at, r.provider, r.rate_type
  FROM exchange_rate r JOIN currency_pair p USING (pair_id)
 WHERE p.symbol = 'USD/INR' ORDER BY r.recorded_at DESC LIMIT 10;
```

### Showing that the database protects itself

Each of these is **rejected by PostgreSQL**, which demonstrates that the rules hold even when
someone bypasses the application. pgAdmin shows the error message.

```sql
UPDATE holding SET quantity = 999999 WHERE holding_id = 1;
-- ERROR: Holding quantities can only change through ledger entries

DELETE FROM ledger_entry WHERE ledger_id = 1;
-- ERROR: Rows in ledger_entry are immutable financial records (DELETE rejected)

UPDATE exchange_rate SET rate = 1 WHERE rate_id = 1;
-- ERROR: Rows in exchange_rate are immutable financial records (UPDATE rejected)
```

## Using a pgAdmin you installed yourself instead

If you prefer the desktop app from <https://www.pgadmin.org/download/>, register a server with
these details:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5433` |
| Maintenance database | `valora` |
| Username | `valora` |
| Password | the `POSTGRES_PASSWORD` value in your `.env` |

## Stopping it

```bash
docker compose stop pgadmin
```

pgAdmin's own settings are kept in the `valora_pgadmin` Docker volume. Your application data is in
`valora_pgdata` and is not affected.
