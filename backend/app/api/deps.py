"""Shared dependencies: database session, authenticated user, active wallet."""
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import User, UserSession, Wallet
from app.services.wallet import require_wallet


def _token_from(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(get_settings().cookie_name)


def current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    token = _token_from(request)
    if not token:
        raise Unauthorized("Please log in to continue.", code="not_authenticated")
    claims = decode_access_token(token)
    if not claims:
        raise Unauthorized("Your session is invalid or has expired. Please log in again.", code="session_expired")
    try:
        sid = uuid.UUID(claims["sid"])
    except (KeyError, ValueError):
        raise Unauthorized("Invalid session.", code="session_invalid") from None
    session = db.get(UserSession, sid)
    now = datetime.now(timezone.utc)
    if session is None or session.revoked_at is not None or session.expires_at <= now \
            or str(session.user_id) != claims.get("sub"):
        raise Unauthorized("Your session has ended. Please log in again.", code="session_expired")
    return session


def current_user(session: UserSession = Depends(current_session), db: Session = Depends(get_db)) -> User:
    user = db.scalars(select(User).where(User.user_id == session.user_id)).unique().one_or_none()
    if user is None:
        raise Unauthorized("Account not found.", code="not_authenticated")
    if user.account_status != "ACTIVE":
        raise Forbidden("This account is not active.", code="account_inactive")
    return user


def current_wallet(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Wallet:
    return require_wallet(db, user)
