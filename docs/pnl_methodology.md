# Profit & Loss Methodology

Valora measures every wallet's performance in that wallet's **base currency**, which is chosen when
the wallet is created (for example INR). It uses the **weighted-average cost** method throughout.

## Cost basis

Each holding stores `average_cost`: what one unit of that currency cost, on average, in base
currency.

- **Funding** adds units at their base-currency value on the day of funding. INR funding into an INR
  wallet costs exactly 1.
- **Buying** currency B in a trade adds units at the trade's value in base currency:

  `new_avg_B = (qty_B × avg_B + trade_value_base) / (qty_B + amount_received)`

- **Selling or exchanging** currency A doesn't change A's average cost; it releases cost from it.

## Trade value in base currency

| Trade | `trade_value_base` |
|---|---|
| Base → X (e.g. INR → USD) | The base amount spent |
| X → Base (e.g. USD → INR) | The base amount received |
| X → Y (e.g. USD → EUR) | Amount of X × the mid rate X→base from the **same snapshot the quote was priced from** |

## Realized P&L

Each trade books one `pnl_transaction` row against the currency given up:

```
quantity_disposed = amount exchanged + fee        (the fee is paid in the source currency)
cost_value        = quantity_disposed × average_cost_of_source
realized_value    = trade_value_base
profit_loss       = realized_value − cost_value
```

As a result:

- **Fees are realized costs.** Spending ₹10,000 INR with a ₹25 fee books −₹25 of realized P&L.
- Selling USD that was bought at ₹94 per dollar for ₹95 per dollar books a realized gain of about
  ₹1 per dollar, less the fee.
- A rise in an exchange rate is **not** profit until you sell. Until then it is unrealized.

## Unrealized P&L

For each holding still held:

```
current_value  = quantity × latest rate (currency → base)
cost_basis     = quantity × average_cost
unrealized_pnl = current_value − cost_basis
```

Every holding in one portfolio response is valued from one consistent set of the latest stored
snapshots.

Just after a purchase, unrealized P&L is slightly negative. This is because the cost includes the
half-spread you paid, while the value uses the mid rate.

## Portfolio-level figures

| Figure | Definition |
|---|---|
| Total value | Σ current_value across holdings |
| Total funded | Σ base value of all virtual funding (initial balance and demo credits) |
| Overall gain | Total value − total funded (equals realized + unrealized) |
| Daily change | Σ quantity × (rate now − rate 24 h ago): **market movement only**. Trades and funding are excluded. |
| 24 h price change | The move in a currency's rate against base. This is a property of the currency, not your profit. |

## Portfolio value over time

`GET /api/portfolio/performance` rebuilds history from the immutable ledger and the stored rate
history. For each time bucket, it adds up the ledger movements to that point, then values each
balance at the bucket's closing rate against base. The `invested` series is cumulative funding, so
the gap between the two lines is the overall gain over time.
