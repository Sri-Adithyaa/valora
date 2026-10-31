"""Wallet lifecycle and simulated (virtual) funding."""
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, Unprocessable
from app.core.money import q_amount, q_base, q_cost, q_down
from app.models import Currency, Holding, LedgerEntry, User, Wallet, WalletFunding
from app.services import rates as rates_svc
from app.services.notifications import notify


def _reference(prefix: str) -> str:
    digits = "".join(secrets.choice("0123456789") for _ in range(12))
    return f"{prefix}-{digits[:4]}-{digits[4:8]}-{digits[8:]}"


def active_wallet(db: Session, user_id: int) -> Wallet | None:
    return db.scalars(select(Wallet).where(Wallet.user_id == user_id, Wallet.status == "ACTIVE")).first()


def create_wallet(db: Session, user: User, *, wallet_name: str, base_currency: str, country: str,
                  accept_terms: bool) -> Wallet:
    if not accept_terms:
        raise Unprocessable("You must accept the simulated-trading terms to open a wallet.",
                            code="terms_not_accepted")
    if active_wallet(db, user.user_id):
        raise Conflict("You already have an active Valora Wallet.", code="wallet_exists")
    base = rates_svc.currency_by_code(db, base_currency)

    wallet = Wallet(user_id=user.user_id, wallet_reference=_reference("VLM"), wallet_name=wallet_name.strip(),
                    base_currency_id=base.currency_id, country=country.strip(),
                    terms_accepted_at=datetime.now(timezone.utc))
    db.add(wallet)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("You already have an active Valora Wallet.", code="wallet_exists") from None

    settings = get_settings()
    inr = rates_svc.currency_by_code(db, "INR")
    book = rates_svc.rate_book(db)
    amount = q_down(settings.initial_funding_inr * book.require(inr.currency_id, base.currency_id), base.decimals)
    if amount > 0:
        _fund(db, wallet, base, amount, "INITIAL", "Initial virtual balance", book)
    notify(db, user.user_id, "WALLET_ACTIVATED", "Your Valora Wallet is active",
           f"Wallet {wallet.wallet_reference} is ready with a virtual balance of "
           f"{base.currency_symbol}{amount:,.{base.decimals}f} {base.currency_code}.",
           severity="SUCCESS", link="/dashboard")
    db.commit()
    return wallet


def fund_demo(db: Session, user: User, wallet: Wallet, amount: Decimal, currency_code: str | None
              ) -> WalletFunding:
    settings = get_settings()
    currency = rates_svc.currency_by_code(db, currency_code) if currency_code else wallet.base_currency
    if amount != q_amount(amount, currency.decimals):
        raise Unprocessable(f"{currency.currency_code} amounts support at most {currency.decimals} decimal places.",
                            code="invalid_precision")
    if amount <= 0:
        raise Unprocessable("Amount must be greater than zero.", code="invalid_amount")

    # Serialise funding per wallet so the daily limit cannot be raced.
    db.execute(select(Wallet.wallet_id).where(Wallet.wallet_id == wallet.wallet_id).with_for_update())
    book = rates_svc.rate_book(db)
    inr = rates_svc.currency_by_code(db, "INR")
    to_inr = book.require(currency.currency_id, inr.currency_id)
    amount_inr = amount * to_inr
    if amount_inr > settings.demo_funding_max_per_request_inr:
        cap = q_down(settings.demo_funding_max_per_request_inr / to_inr, currency.decimals)
        raise Unprocessable(f"Demo credits are limited to {cap:,} {currency.currency_code} per request.",
                            code="funding_limit")
    since = datetime.now(timezone.utc) - timedelta(days=1)
    rows = db.execute(select(WalletFunding.amount, WalletFunding.currency_id).where(
        WalletFunding.wallet_id == wallet.wallet_id, WalletFunding.funding_type == "DEMO_CREDIT",
        WalletFunding.created_at >= since)).all()
    used_inr = sum((a * book.require(cid, inr.currency_id) for a, cid in rows), Decimal(0))
    if used_inr + amount_inr > settings.demo_funding_daily_limit_inr:
        raise Unprocessable("Daily demo-credit limit reached. Try again tomorrow.", code="funding_limit")

    funding = _fund(db, wallet, currency, amount, "DEMO_CREDIT", "Demo credit", book)
    notify(db, user.user_id, "FUNDING", "Virtual funds added",
           f"{currency.currency_symbol}{amount:,.{currency.decimals}f} {currency.currency_code} demo credit "
           f"was added to your wallet ({funding.reference}).", severity="SUCCESS", link="/portfolio")
    db.commit()
    return funding


def _fund(db: Session, wallet: Wallet, currency: Currency, amount: Decimal, funding_type: str, note: str,
          book: rates_svc.RateBook, at: datetime | None = None) -> WalletFunding:
    """Credit virtual money: funding record + ledger credit (the ledger trigger moves the balance)."""
    rate_to_base = book.require(currency.currency_id, wallet.base_currency_id)
    base_value = q_base(amount * rate_to_base)

    ensure_holding(db, wallet.wallet_id, currency.currency_id)
    holding = db.execute(select(Holding.holding_id, Holding.quantity, Holding.average_cost).where(
        Holding.wallet_id == wallet.wallet_id, Holding.currency_id == currency.currency_id).with_for_update()).one()

    funding = WalletFunding(wallet_id=wallet.wallet_id, currency_id=currency.currency_id, amount=amount,
                            funding_type=funding_type, rate_to_base=rate_to_base, base_value=base_value,
                            reference=_reference("FND"), note=note,
                            created_at=at or datetime.now(timezone.utc))
    db.add(funding)
    db.flush()
    db.add(LedgerEntry(wallet_id=wallet.wallet_id, currency_id=currency.currency_id, funding_id=funding.funding_id,
                       entry_type="FUNDING_CREDIT", direction="CREDIT", amount=amount, reference=funding.reference,
                       created_at=funding.created_at))
    new_avg = weighted_average(holding.quantity, holding.average_cost, amount, base_value)
    db.flush()
    db.execute(update(Holding).where(Holding.holding_id == holding.holding_id).values(average_cost=new_avg))
    return funding


def ensure_holding(db: Session, wallet_id: int, currency_id: int) -> None:
    """Open a zero-balance holding if the wallet has none for this currency yet."""
    db.execute(pg_insert(Holding).values(wallet_id=wallet_id, currency_id=currency_id)
               .on_conflict_do_nothing(index_elements=["wallet_id", "currency_id"]))


def weighted_average(qty: Decimal, avg: Decimal, add_qty: Decimal, add_cost: Decimal) -> Decimal:
    total_qty = qty + add_qty
    if total_qty <= 0:
        return Decimal(0)
    return q_cost((qty * avg + add_cost) / total_qty)


def holdings(db: Session, wallet: Wallet, include_zero: bool = False) -> list[Holding]:
    stmt = select(Holding).where(Holding.wallet_id == wallet.wallet_id)
    if not include_zero:
        stmt = stmt.where(Holding.quantity > 0)
    return list(db.scalars(stmt.order_by(Holding.currency_id)).unique())


def total_funded_base(db: Session, wallet_id: int) -> Decimal:
    return db.execute(select(func.coalesce(func.sum(WalletFunding.base_value), 0))
                      .where(WalletFunding.wallet_id == wallet_id)).scalar_one()


def require_wallet(db: Session, user: User) -> Wallet:
    w = active_wallet(db, user.user_id)
    if w is None:
        raise NotFound("Create your Valora Wallet first.", code="wallet_required")
    return w
