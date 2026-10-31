"""In-app notifications. `notify` only stages the row; the caller owns the transaction."""
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Notification, Wallet


def notify(db: Session, user_id: int, type_: str, title: str, message: str, *,
           severity: str = "INFO", link: str | None = None) -> Notification:
    n = Notification(user_id=user_id, type=type_, title=title, message=message, severity=severity, link=link)
    db.add(n)
    return n


def notify_all_wallet_holders(db: Session, type_: str, title: str, message: str, severity: str) -> int:
    user_ids = db.scalars(select(Wallet.user_id).where(Wallet.status == "ACTIVE")).all()
    for uid in user_ids:
        notify(db, uid, type_, title, message, severity=severity, link="/markets")
    return len(user_ids)


def unread_count(db: Session, user_id: int) -> int:
    return db.execute(text("SELECT count(*) FROM notification WHERE user_id = :u AND NOT is_read"),
                      {"u": user_id}).scalar_one()
