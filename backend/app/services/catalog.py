"""Reference catalogue: supported currencies and how pairs are oriented.

The live list lives in the database (currency / currency_pair tables); this module only provides the
initial catalogue used by the seed script and tests.
"""
from decimal import Decimal
from itertools import combinations

# code, name, symbol, country/region, decimals
CURRENCIES: list[tuple[str, str, str, str, int]] = [
    ("USD", "US Dollar", "$", "United States", 2),
    ("EUR", "Euro", "€", "Eurozone", 2),
    ("GBP", "British Pound", "£", "United Kingdom", 2),
    ("CHF", "Swiss Franc", "Fr", "Switzerland", 2),
    ("AUD", "Australian Dollar", "A$", "Australia", 2),
    ("CAD", "Canadian Dollar", "C$", "Canada", 2),
    ("SGD", "Singapore Dollar", "S$", "Singapore", 2),
    ("AED", "UAE Dirham", "AED", "United Arab Emirates", 2),
    ("JPY", "Japanese Yen", "¥", "Japan", 0),
    ("INR", "Indian Rupee", "₹", "India", 2),
]

# Pair orientation: the currency listed first is the pair's BASE (1 BASE = rate QUOTE).
# This yields USD/INR, EUR/INR, USD/EUR, USD/GBP, EUR/GBP, USD/JPY, GBP/JPY, ...
PRIORITY = [c[0] for c in CURRENCIES]

FEATURED = ["USD/INR", "EUR/INR", "GBP/INR", "USD/EUR", "USD/GBP", "EUR/GBP", "USD/JPY", "GBP/JPY"]

MAJORS = {"USD", "EUR", "GBP", "JPY", "CHF"}

# Approximate USD→X reference rates, used only to anchor simulated seed history when the live
# provider cannot be reached during seeding.
REFERENCE_USD_RATES: dict[str, Decimal] = {
    "USD": Decimal("1"),
    "EUR": Decimal("0.8945"),
    "GBP": Decimal("0.7466"),
    "CHF": Decimal("0.8244"),
    "AUD": Decimal("1.4225"),
    "CAD": Decimal("1.3975"),
    "SGD": Decimal("1.2785"),
    "AED": Decimal("3.6726"),
    "JPY": Decimal("157.59"),
    "INR": Decimal("94.92"),
}


def pair_specs() -> list[dict]:
    """Every unordered combination of supported currencies, oriented by PRIORITY."""
    specs = []
    for order, (a, b) in enumerate(combinations(PRIORITY, 2)):
        symbol = f"{a}/{b}"
        both_major = a in MAJORS and b in MAJORS
        specs.append({
            "base": a,
            "quote": b,
            "symbol": symbol,
            "spread": Decimal("0.0010") if both_major else Decimal("0.0020"),
            "min_trade_amount": Decimal("100") if a == "JPY" else Decimal("1"),
            "is_featured": symbol in FEATURED,
            "display_order": FEATURED.index(symbol) if symbol in FEATURED else 100 + order,
        })
    return specs
