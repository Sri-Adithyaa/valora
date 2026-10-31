"""Password hashing (Argon2id) and signed session tokens."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: int) -> tuple[str, uuid.UUID, datetime]:
    s = get_settings()
    session_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=s.access_token_minutes)
    token = jwt.encode(
        {"sub": str(user_id), "sid": str(session_id), "exp": expires, "iat": now},
        s.jwt_secret,
        algorithm=s.jwt_algorithm,
    )
    return token, session_id, expires


def decode_access_token(token: str) -> dict | None:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.PyJWTError:
        return None
