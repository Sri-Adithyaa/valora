"""Decimal helpers. Floats are never used for money anywhere in Valora."""
from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_UP, Decimal

TEN_DP = Decimal("0.0000000001")


def unit(decimals: int) -> Decimal:
    return Decimal(1).scaleb(-decimals)


def q_amount(value: Decimal, decimals: int, rounding=ROUND_HALF_EVEN) -> Decimal:
    return value.quantize(unit(decimals), rounding=rounding)


def q_down(value: Decimal, decimals: int) -> Decimal:
    return q_amount(value, decimals, ROUND_DOWN)


def q_up(value: Decimal, decimals: int) -> Decimal:
    return q_amount(value, decimals, ROUND_UP)


def q_rate(value: Decimal) -> Decimal:
    return value.quantize(TEN_DP, rounding=ROUND_HALF_EVEN)


def q_cost(value: Decimal) -> Decimal:
    """Average-cost precision (per unit, in the wallet's base currency)."""
    return value.quantize(TEN_DP, rounding=ROUND_HALF_EVEN)


def q_base(value: Decimal) -> Decimal:
    """Base-currency valuations used in P&L records (4 dp, rounded for display later)."""
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_EVEN)
