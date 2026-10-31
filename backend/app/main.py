"""Valora Money API — FastAPI application entry point.

Run:  uvicorn app.main:app --reload      (Swagger UI at http://localhost:8000/docs)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, market, notifications, portfolio, trade, wallet
from app.core.config import get_settings
from app.core.errors import install_error_handlers

settings = get_settings()

app = FastAPI(
    title="Valora Money API",
    version="1.0.0",
    description=(
        "**Where Money Becomes an Asset.** Simulated multi-currency trading platform.\n\n"
        "> SIMULATION MODE — all balances and transactions are virtual. No real money is transferred.\n\n"
        "Authenticate with `POST /api/auth/login` (sets an httpOnly cookie used by this page)."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key", "Authorization"],
)
install_error_handlers(app)

for r in (auth.router, auth.profile_router, wallet.router, market.router, trade.router, portfolio.router,
          notifications.router, notifications.watchlist_router):
    app.include_router(r)


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "mode": "SIMULATION"}
