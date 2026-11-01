/** Country list for registration / wallet setup, with a suggested base currency where one is supported. */
export const COUNTRIES: { name: string; currency?: string }[] = [
  { name: "Argentina" }, { name: "Australia", currency: "AUD" }, { name: "Austria", currency: "EUR" },
  { name: "Bangladesh" }, { name: "Belgium", currency: "EUR" }, { name: "Brazil" }, { name: "Canada", currency: "CAD" },
  { name: "Chile" }, { name: "China", currency: "CNY" }, { name: "Colombia" }, { name: "Croatia", currency: "EUR" },
  { name: "Cyprus", currency: "EUR" }, { name: "Czech Republic" }, { name: "Denmark" }, { name: "Egypt" },
  { name: "Estonia", currency: "EUR" }, { name: "Finland", currency: "EUR" }, { name: "France", currency: "EUR" },
  { name: "Germany", currency: "EUR" }, { name: "Greece", currency: "EUR" }, { name: "Hong Kong", currency: "HKD" },
  { name: "Hungary" }, { name: "India", currency: "INR" }, { name: "Indonesia" }, { name: "Ireland", currency: "EUR" },
  { name: "Israel" }, { name: "Italy", currency: "EUR" }, { name: "Japan", currency: "JPY" }, { name: "Kenya" },
  { name: "Kuwait" }, { name: "Latvia", currency: "EUR" }, { name: "Lithuania", currency: "EUR" },
  { name: "Luxembourg", currency: "EUR" }, { name: "Malaysia" }, { name: "Malta", currency: "EUR" }, { name: "Mexico" },
  { name: "Nepal" }, { name: "Netherlands", currency: "EUR" }, { name: "New Zealand", currency: "NZD" },
  { name: "Nigeria" }, { name: "Norway" }, { name: "Oman" }, { name: "Pakistan" }, { name: "Philippines" },
  { name: "Poland" }, { name: "Portugal", currency: "EUR" }, { name: "Qatar" }, { name: "Saudi Arabia" },
  { name: "Singapore", currency: "SGD" }, { name: "Slovakia", currency: "EUR" }, { name: "Slovenia", currency: "EUR" },
  { name: "South Africa" }, { name: "South Korea" }, { name: "Spain", currency: "EUR" }, { name: "Sri Lanka" },
  { name: "Sweden" }, { name: "Switzerland", currency: "CHF" }, { name: "Taiwan" }, { name: "Thailand" },
  { name: "Turkey" }, { name: "United Arab Emirates", currency: "AED" }, { name: "United Kingdom", currency: "GBP" },
  { name: "United States", currency: "USD" }, { name: "Vietnam" },
];

export function suggestedCurrency(country: string): string | undefined {
  return COUNTRIES.find((c) => c.name === country)?.currency;
}
