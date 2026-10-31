"""Registration, login/logout, current user, profile and password management."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import current_session, current_user
from app.core.config import get_settings
from app.core.errors import Conflict, Unauthorized, Unprocessable
from app.core.ratelimit import limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models import User, UserSession, Watchlist
from app.schemas import (
    LoginIn, MeOut, MessageOut, PasswordChangeIn, ProfileUpdateIn, RegisterIn, UserOut, WalletBrief,
)
from app.services import rates as rates_svc
from app.services.notifications import notify, unread_count
from app.services.wallet import active_wallet

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
profile_router = APIRouter(prefix="/api/profile", tags=["Profile"])


def _start_session(db: Session, user: User, request: Request, response: Response) -> None:
    s = get_settings()
    token, sid, expires = create_access_token(user.user_id)
    db.add(UserSession(session_id=sid, user_id=user.user_id, expires_at=expires,
                       ip_address=request.client.host if request.client else None,
                       user_agent=(request.headers.get("user-agent") or "")[:255]))
    db.commit()
    response.set_cookie(s.cookie_name, token, httponly=True, secure=s.cookie_secure, samesite="lax",
                        max_age=s.access_token_minutes * 60, path="/")


def me_payload(db: Session, user: User) -> MeOut:
    wallet = active_wallet(db, user.user_id)
    return MeOut(user=UserOut.model_validate(user),
                 wallet=WalletBrief.model_validate(wallet) if wallet else None,
                 unread_notifications=unread_count(db, user.user_id))


@router.post("/register", response_model=MeOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(limiter("auth", "auth_rate_limit"))])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Create an account and start a session. The next step is wallet creation."""
    base = rates_svc.currency_by_code(db, body.base_currency)
    taken = db.execute(select(User.email, User.username).where(or_(
        func.lower(User.email) == body.email.lower(), func.lower(User.username) == body.username.lower()))).all()
    for email, username in taken:
        if email.lower() == body.email.lower():
            raise Conflict("An account with this email already exists.", code="email_taken")
        if username.lower() == body.username.lower():
            raise Conflict("This username is already taken.", code="username_taken")

    user = User(full_name=body.full_name, username=body.username, email=body.email.lower(), phone=body.phone,
                password_hash=hash_password(body.password), country=body.country,
                base_currency_id=base.currency_id)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("Email or username is already registered.", code="account_exists") from None
    db.add(Watchlist(user_id=user.user_id, name="Favourites"))
    db.commit()
    _start_session(db, user, request, response)
    return me_payload(db, user)


@router.post("/login", response_model=MeOut, dependencies=[Depends(limiter("auth", "auth_rate_limit"))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Log in with email **or** username. Sets an httpOnly session cookie."""
    ident = body.identifier.strip().lower()
    user = db.scalars(select(User).where(or_(func.lower(User.email) == ident,
                                             func.lower(User.username) == ident))).unique().first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise Unauthorized("Incorrect email/username or password.", code="invalid_credentials")
    if user.account_status != "ACTIVE":
        raise Unauthorized("This account is not active.", code="account_inactive")
    _start_session(db, user, request, response)
    return me_payload(db, user)


@router.post("/logout", response_model=MessageOut)
def logout(response: Response, session: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    """Revoke the current session server-side and clear the cookie."""
    db.execute(update(UserSession).where(UserSession.session_id == session.session_id)
               .values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    response.delete_cookie(get_settings().cookie_name, path="/")
    return MessageOut(message="Logged out")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_payload(db, user)


@profile_router.patch("", response_model=MeOut)
def update_profile(body: ProfileUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Edit permitted profile fields. Email and username are fixed identifiers."""
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.phone is not None:
        user.phone = body.phone
    if body.country is not None:
        user.country = body.country.strip()
    if body.base_currency is not None:
        user.base_currency_id = rates_svc.currency_by_code(db, body.base_currency).currency_id
    db.commit()
    db.refresh(user)
    return me_payload(db, user)


@profile_router.post("/password", response_model=MessageOut,
                     dependencies=[Depends(limiter("auth", "auth_rate_limit"))])
def change_password(body: PasswordChangeIn, session: UserSession = Depends(current_session),
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Change password and sign out every other session."""
    if not verify_password(body.current_password, user.password_hash):
        raise Unprocessable("Current password is incorrect.", code="invalid_password")
    if body.current_password == body.new_password:
        raise Unprocessable("Choose a password different from the current one.", code="password_reused")
    user.password_hash = hash_password(body.new_password)
    db.execute(update(UserSession).where(UserSession.user_id == user.user_id,
                                         UserSession.session_id != session.session_id,
                                         UserSession.revoked_at.is_(None))
               .values(revoked_at=datetime.now(timezone.utc)))
    notify(db, user.user_id, "SECURITY", "Password changed",
           "Your password was changed and other sessions were signed out.", severity="INFO", link="/profile")
    db.commit()
    return MessageOut(message="Password updated")
