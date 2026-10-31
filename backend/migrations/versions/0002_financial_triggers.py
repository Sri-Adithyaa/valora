"""Financial integrity triggers.

These rules hold no matter which code path (API, worker, seed script, psql session) touches the data:

* Holdings move only through ledger entries. Inserting a ledger entry upserts the holding and
  applies the signed amount; any direct UPDATE of a holding's quantity is rejected. The holding's
  CHECK (quantity >= 0) makes overdrafts impossible.
* Ledger entries, trades, orders, P&L rows, funding records and exchange-rate snapshots are
  append-only: UPDATE and DELETE are rejected.
* A trade quote is a fixed offer: its terms cannot change, it can leave PENDING exactly once, and it
  cannot be marked EXECUTED after it has expired.
* Every trade and every funding record must be balanced by ledger entries when the transaction
  commits (deferred constraint triggers).

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

APPEND_ONLY = ["ledger_entry", "trades", "orders", "pnl_transaction", "wallet_funding", "exchange_rate",
               "rate_provider_log"]

UPGRADE_SQL = r"""
-- ── updated_at maintenance ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION valora_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION valora_touch_updated_at();

-- ── append-only tables ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION valora_forbid_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Rows in % are immutable financial records (% rejected)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;

-- ── ledger → holding ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION valora_ledger_apply() RETURNS trigger AS $$
DECLARE
    v_delta    numeric;
    v_qty      numeric;
    v_hid      bigint;
    v_status   text;
BEGIN
    SELECT status INTO v_status FROM wallet WHERE wallet_id = NEW.wallet_id;
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Wallet % is not active', NEW.wallet_id USING ERRCODE = 'check_violation';
    END IF;

    v_delta := CASE WHEN NEW.direction = 'CREDIT' THEN NEW.amount ELSE -NEW.amount END;

    PERFORM set_config('valora.ledger_apply', 'on', true);
    INSERT INTO holding (wallet_id, currency_id, quantity, average_cost)
        VALUES (NEW.wallet_id, NEW.currency_id, 0, 0)
        ON CONFLICT (wallet_id, currency_id) DO NOTHING;
    UPDATE holding
       SET quantity = quantity + v_delta, updated_at = now()
     WHERE wallet_id = NEW.wallet_id AND currency_id = NEW.currency_id
    RETURNING holding_id, quantity INTO v_hid, v_qty;
    PERFORM set_config('valora.ledger_apply', 'off', true);

    NEW.holding_id    := v_hid;
    NEW.balance_after := v_qty;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_apply BEFORE INSERT ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION valora_ledger_apply();

-- ── holding guard: quantities only change via the ledger trigger ───────────────────────
CREATE OR REPLACE FUNCTION valora_holding_guard() RETURNS trigger AS $$
DECLARE
    v_via_ledger boolean := coalesce(current_setting('valora.ledger_apply', true), 'off') = 'on';
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.quantity <> 0 AND NOT v_via_ledger THEN
            RAISE EXCEPTION 'Holdings must be opened with zero quantity; balances move via ledger entries'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.wallet_id <> OLD.wallet_id OR NEW.currency_id <> OLD.currency_id THEN
            RAISE EXCEPTION 'A holding cannot move to another wallet or currency'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW.quantity IS DISTINCT FROM OLD.quantity AND NOT v_via_ledger THEN
            RAISE EXCEPTION 'Holding quantities can only change through ledger entries'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        NEW.updated_at := now();
        RETURN NEW;
    ELSE  -- DELETE
        IF OLD.quantity <> 0 THEN
            RAISE EXCEPTION 'Cannot delete a holding with a non-zero balance'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN OLD;
    END IF;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_holding_guard BEFORE INSERT OR UPDATE OR DELETE ON holding
    FOR EACH ROW EXECUTE FUNCTION valora_holding_guard();

-- ── wallet guard ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION valora_wallet_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Wallets cannot be deleted; close them instead'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.user_id <> OLD.user_id OR NEW.base_currency_id <> OLD.base_currency_id
       OR NEW.wallet_reference <> OLD.wallet_reference THEN
        RAISE EXCEPTION 'Wallet owner, base currency and reference are fixed after creation'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_guard BEFORE UPDATE OR DELETE ON wallet
    FOR EACH ROW EXECUTE FUNCTION valora_wallet_guard();

-- ── trade-quote guard: fixed terms, single transition, no execution after expiry ───────
CREATE OR REPLACE FUNCTION valora_quote_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Trade quotes cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Quote % is already % and cannot change', OLD.quote_id, OLD.status
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (NEW.user_id, NEW.wallet_id, NEW.pair_id, NEW.rate_id, NEW.side, NEW.from_currency_id,
        NEW.to_currency_id, NEW.from_amount, NEW.to_amount, NEW.quoted_rate, NEW.mid_rate, NEW.fee,
        NEW.fee_currency_id, NEW.created_at, NEW.expires_at)
       IS DISTINCT FROM
       (OLD.user_id, OLD.wallet_id, OLD.pair_id, OLD.rate_id, OLD.side, OLD.from_currency_id,
        OLD.to_currency_id, OLD.from_amount, OLD.to_amount, OLD.quoted_rate, OLD.mid_rate, OLD.fee,
        OLD.fee_currency_id, OLD.created_at, OLD.expires_at) THEN
        RAISE EXCEPTION 'The terms of a quote are fixed once issued'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'EXECUTED' AND clock_timestamp() > OLD.expires_at THEN
        RAISE EXCEPTION 'Quote % expired at %', OLD.quote_id, OLD.expires_at
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quote_guard BEFORE UPDATE OR DELETE ON trade_quote
    FOR EACH ROW EXECUTE FUNCTION valora_quote_guard();

-- ── a trade must settle an executed quote with identical terms ─────────────────────────
CREATE OR REPLACE FUNCTION valora_trade_matches_quote() RETURNS trigger AS $$
DECLARE
    q trade_quote%ROWTYPE;
BEGIN
    SELECT * INTO q FROM trade_quote WHERE quote_id = NEW.quote_id;
    IF NOT FOUND OR q.status <> 'EXECUTED' THEN
        RAISE EXCEPTION 'Trade must reference an executed quote' USING ERRCODE = 'check_violation';
    END IF;
    IF (q.user_id, q.wallet_id, q.from_currency_id, q.to_currency_id, q.from_amount, q.to_amount,
        q.quoted_rate, q.fee) IS DISTINCT FROM
       (NEW.user_id, NEW.wallet_id, NEW.from_currency_id, NEW.to_currency_id, NEW.from_amount,
        NEW.to_amount, NEW.executed_rate, NEW.fee) THEN
        RAISE EXCEPTION 'Trade terms do not match quote %', q.quote_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_trade_matches_quote BEFORE INSERT ON trades
    FOR EACH ROW EXECUTE FUNCTION valora_trade_matches_quote();

-- ── deferred: every trade is balanced by its ledger entries at commit ──────────────────
CREATE OR REPLACE FUNCTION valora_trade_balanced() RETURNS trigger AS $$
DECLARE
    v_debit  numeric;
    v_fee    numeric;
    v_credit numeric;
BEGIN
    SELECT coalesce(sum(amount) FILTER (WHERE entry_type = 'TRADE_DEBIT'
                                          AND currency_id = NEW.from_currency_id), 0),
           coalesce(sum(amount) FILTER (WHERE entry_type = 'FEE_DEBIT'
                                          AND currency_id = NEW.fee_currency_id), 0),
           coalesce(sum(amount) FILTER (WHERE entry_type = 'TRADE_CREDIT'
                                          AND currency_id = NEW.to_currency_id), 0)
      INTO v_debit, v_fee, v_credit
      FROM ledger_entry WHERE trade_id = NEW.trade_id;
    IF v_debit <> NEW.from_amount OR v_fee <> NEW.fee OR v_credit <> NEW.to_amount THEN
        RAISE EXCEPTION 'Trade % is not balanced by ledger entries (debit %, fee %, credit %)',
            NEW.trade_reference, v_debit, v_fee, v_credit USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_trade_balanced AFTER INSERT ON trades
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION valora_trade_balanced();

CREATE OR REPLACE FUNCTION valora_funding_balanced() RETURNS trigger AS $$
DECLARE
    v_credit numeric;
BEGIN
    SELECT coalesce(sum(amount), 0) INTO v_credit FROM ledger_entry
     WHERE funding_id = NEW.funding_id AND entry_type = 'FUNDING_CREDIT' AND currency_id = NEW.currency_id;
    IF v_credit <> NEW.amount THEN
        RAISE EXCEPTION 'Funding % is not balanced by a ledger credit', NEW.reference
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_funding_balanced AFTER INSERT ON wallet_funding
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION valora_funding_balanced();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER trg_{table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION valora_forbid_change();"
        )


def downgrade() -> None:
    for table in APPEND_ONLY:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_immutable ON {table};")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_funding_balanced ON wallet_funding;
        DROP TRIGGER IF EXISTS trg_trade_balanced ON trades;
        DROP TRIGGER IF EXISTS trg_trade_matches_quote ON trades;
        DROP TRIGGER IF EXISTS trg_quote_guard ON trade_quote;
        DROP TRIGGER IF EXISTS trg_wallet_guard ON wallet;
        DROP TRIGGER IF EXISTS trg_holding_guard ON holding;
        DROP TRIGGER IF EXISTS trg_ledger_apply ON ledger_entry;
        DROP TRIGGER IF EXISTS trg_users_touch ON users;
        DROP FUNCTION IF EXISTS valora_funding_balanced, valora_trade_balanced, valora_trade_matches_quote,
            valora_quote_guard, valora_wallet_guard, valora_holding_guard, valora_ledger_apply,
            valora_forbid_change, valora_touch_updated_at;
    """)
