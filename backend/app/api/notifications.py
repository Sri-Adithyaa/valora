"""In-app notifications and the favourites watchlist."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.serializers import pair_out
from app.core.errors import NotFound
from app.database.session import get_db
from app.models import CurrencyPair, Notification, User, Watchlist, WatchlistPair
from app.schemas import MessageOut, NotificationList, NotificationOut, PairOut
from app.services.notifications import unread_count

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
watchlist_router = APIRouter(prefix="/api/watchlist", tags=["Watchlist"])


@router.get("", response_model=NotificationList)
def list_notifications(unread_only: bool = False, limit: int = Query(30, ge=1, le=100),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.user_id == user.user_id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    rows = db.scalars(stmt.order_by(Notification.created_at.desc(), Notification.notification_id.desc())
                      .limit(limit)).all()
    return NotificationList(unread=unread_count(db, user.user_id),
                            items=[NotificationOut.model_validate(n) for n in rows])


@router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.user_id:
        raise NotFound("Notification not found.", code="notification_not_found")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.now(timezone.utc)
        db.commit()
    return NotificationOut.model_validate(n)


@router.post("/read-all", response_model=MessageOut)
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
               .values(is_read=True, read_at=datetime.now(timezone.utc)))
    db.commit()
    return MessageOut(message="All notifications marked as read")


def _watchlist(db: Session, user: User) -> Watchlist:
    wl = db.scalars(select(Watchlist).where(Watchlist.user_id == user.user_id).order_by(Watchlist.watchlist_id)).first()
    if wl is None:
        wl = Watchlist(user_id=user.user_id, name="Favourites")
        db.add(wl)
        db.flush()
    return wl


@watchlist_router.get("", response_model=list[PairOut])
def get_watchlist(user: User = Depends(current_user), db: Session = Depends(get_db)):
    wl = _watchlist(db, user)
    db.commit()
    pairs = db.scalars(select(CurrencyPair).join(WatchlistPair, WatchlistPair.pair_id == CurrencyPair.pair_id)
                       .where(WatchlistPair.watchlist_id == wl.watchlist_id)
                       .order_by(WatchlistPair.added_at)).unique().all()
    ids = {p.pair_id for p in pairs}
    return [pair_out(p, ids) for p in pairs]


@watchlist_router.post("/{pair_id}", response_model=MessageOut, status_code=201)
def add_favourite(pair_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(CurrencyPair, pair_id) is None:
        raise NotFound("Currency pair not found.", code="pair_not_found")
    wl = _watchlist(db, user)
    db.execute(pg_insert(WatchlistPair).values(watchlist_id=wl.watchlist_id, pair_id=pair_id)
               .on_conflict_do_nothing())
    db.commit()
    return MessageOut(message="Added to favourites")


@watchlist_router.delete("/{pair_id}", response_model=MessageOut)
def remove_favourite(pair_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    wl = _watchlist(db, user)
    db.execute(delete(WatchlistPair).where(WatchlistPair.watchlist_id == wl.watchlist_id,
                                           WatchlistPair.pair_id == pair_id))
    db.commit()
    return MessageOut(message="Removed from favourites")
