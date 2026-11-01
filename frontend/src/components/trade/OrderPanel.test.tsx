import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Holding, Quote } from "../../services/types";
import { EUR, INR, JPY, mockFetch, renderWithProviders, USD } from "../../test/utils";
import { OrderPanel } from "./OrderPanel";

const holding = (c: typeof INR, quantity: string): Holding => ({
  currency: c,
  quantity,
  average_cost: "1",
  cost_basis: quantity,
  latest_rate: "1",
  current_value: quantity,
  unrealized_pnl: "0",
  unrealized_pnl_pct: "0",
  price_change_24h_pct: "0",
  realized_pnl: "0",
  allocation_pct: "100",
  updated_at: "2026-10-31T00:00:00Z",
});

function makeQuote(overrides: Partial<Quote> = {}, validityMs = 30_000): Quote {
  const created = new Date();
  return {
    quote_id: "a466ba6b-ad4a-40eb-b59d-a527d9595f0b",
    status: "PENDING",
    side: "BUY",
    amount_type: "SOURCE",
    pair_id: 9,
    pair_symbol: "USD/INR",
    from_currency: INR,
    to_currency: USD,
    from_amount: "1000.00000000",
    to_amount: "10.52000000",
    fee: "2.50000000",
    fee_rate: "0.002500",
    fee_currency: "INR",
    total_debit: "1002.50000000",
    mid_rate: "0.0105347213",
    quoted_rate: "0.0105241866",
    inverse_rate: "95.0192198227",
    spread: "0.002000",
    rate_recorded_at: created.toISOString(),
    rate_freshness: "LIVE",
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + validityMs).toISOString(),
    validity_seconds: Math.round(validityMs / 1000),
    available_balance: "100000.00000000",
    sufficient_balance: true,
    ...overrides,
  };
}

const baseRoutes = {
  "GET /api/market/currencies": { body: [USD, EUR, JPY, INR] },
  "GET /api/wallet/holdings": { body: [holding(INR, "100000.00000000"), holding(USD, "500.00000000")] },
  "GET /api/notifications": { body: { unread: 0, items: [] } },
};

function Harness({ initialFrom = "INR", initialTo = "USD" }: { initialFrom?: string; initialTo?: string }) {
  const [pair, setPair] = useState({ from: initialFrom, to: initialTo });
  return (
    <>
      <p data-testid="pair">{pair.from}→{pair.to}</p>
      <OrderPanel from={pair.from} to={pair.to} onChange={setPair} />
    </>
  );
}

async function getQuote(amount = "1000") {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: /INR · ₹1,00,000.00 available/ });
  await user.click(screen.getByRole("radio", { name: /Sell \/ Exchange INR/ }));
  await user.type(screen.getByLabelText(/Amount of INR to exchange/i), amount);
  await user.click(screen.getByRole("button", { name: "Get quote" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OrderPanel", () => {
  it("requests a SOURCE quote and renders the locked quote details", async () => {
    const fetchMock = mockFetch({ ...baseRoutes, "POST /api/trade/quote": { status: 201, body: makeQuote() } });
    renderWithProviders(<Harness />);
    await getQuote("1000");

    const details = await screen.findByLabelText("Quote details");
    expect(within(details).getByText(/1 INR = 0\.010524 USD/)).toBeInTheDocument();
    expect(within(details).getByText("1 USD = 95.0192 INR")).toBeInTheDocument();
    expect(within(details).getByText("1,000.00 INR")).toBeInTheDocument();
    expect(within(details).getByText("Fee (0.25%)")).toBeInTheDocument();
    expect(within(details).getByText("2.50 INR")).toBeInTheDocument();
    expect(within(details).getByText("1,002.50 INR")).toBeInTheDocument();
    expect(within(details).getByText("10.52 USD")).toBeInTheDocument();
    expect(screen.getByTestId("quote-countdown")).toHaveTextContent(/^(30|29)s$/);

    const quoteCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/trade/quote"))!;
    expect(JSON.parse(quoteCall[1]!.body as string)).toEqual({
      from_currency: "INR",
      to_currency: "USD",
      amount: "1000",
      amount_type: "SOURCE",
    });
  });

  it("uses amount_type TARGET for the Buy tab", async () => {
    const fetchMock = mockFetch({ ...baseRoutes, "POST /api/trade/quote": { status: 201, body: makeQuote({ amount_type: "TARGET" }) } });
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await screen.findByRole("option", { name: /INR · ₹1,00,000.00 available/ });
    expect(screen.getByRole("radio", { name: "Buy USD" })).toBeChecked();
    await user.type(screen.getByLabelText(/Amount of USD to buy/i), "25");
    await user.click(screen.getByRole("button", { name: "Get quote" }));
    await screen.findByLabelText("Quote details");
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/trade/quote"))!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ amount: "25", amount_type: "TARGET" });
  });

  it("disables confirmation once the countdown reaches zero and offers a fresh quote", async () => {
    mockFetch({ ...baseRoutes, "POST /api/trade/quote": { status: 201, body: makeQuote({}, 1200) } });
    renderWithProviders(<Harness />);
    await getQuote();

    expect(await screen.findByRole("button", { name: /Review & confirm/ })).toBeEnabled();
    await waitFor(() => expect(screen.getByTestId("quote-countdown")).toHaveTextContent("Expired"), { timeout: 4000 });
    expect(screen.queryByRole("button", { name: /Review & confirm/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get a fresh quote/ })).toBeInTheDocument();
    expect(screen.getByText(/This quote has expired/)).toBeInTheDocument();
  });

  it("swap flips FROM and TO", async () => {
    mockFetch(baseRoutes);
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    expect(screen.getByTestId("pair")).toHaveTextContent("INR→USD");
    await user.click(screen.getByRole("button", { name: /Swap currencies/ }));
    expect(screen.getByTestId("pair")).toHaveTextContent("USD→INR");
    expect(screen.getByLabelText("From (you pay)")).toHaveValue("USD");
    expect(screen.getByLabelText("To (you receive)")).toHaveValue("INR");
    expect(screen.getByRole("radio", { name: "Buy INR" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sell / Exchange USD" })).toBeInTheDocument();
  });

  it("selecting the TO currency as FROM swaps instead of creating a same-currency pair", async () => {
    mockFetch(baseRoutes);
    renderWithProviders(<Harness />);
    await screen.findByRole("option", { name: /INR · ₹1,00,000.00 available/ });
    fireEvent.change(screen.getByLabelText("From (you pay)"), { target: { value: "USD" } });
    expect(screen.getByTestId("pair")).toHaveTextContent("USD→INR");
  });

  it("shows the insufficient-balance message before confirmation and blocks confirming", async () => {
    mockFetch({
      ...baseRoutes,
      "POST /api/trade/quote": {
        status: 201,
        body: makeQuote({ from_amount: "200000.00000000", total_debit: "200500.00000000", sufficient_balance: false }),
      },
    });
    renderWithProviders(<Harness />);
    await getQuote("200000");
    const alert = await screen.findByText(/Insufficient INR balance/);
    expect(alert).toHaveTextContent("this trade needs 2,00,500.00 INR (including fee) but only 1,00,000.00 INR is available");
    expect(screen.getByRole("button", { name: /Review & confirm/ })).toBeDisabled();
  });

  it("confirms with a dialog naming the debited and credited currency, then executes with an Idempotency-Key", async () => {
    const q = makeQuote();
    const fetchMock = mockFetch({
      ...baseRoutes,
      "POST /api/trade/quote": { status: 201, body: q },
      "POST /api/trade/execute": {
        status: 201,
        body: {
          replayed: false,
          holdings: [holding(INR, "98997.50000000"), holding(USD, "510.52000000")],
          trade: {
            trade_id: 42, trade_reference: "TRD-261031-ABC123", quote_id: q.quote_id, order_id: 42, status: "COMPLETED",
            side: "BUY", pair_symbol: "USD/INR", from_currency: INR, to_currency: USD, from_amount: "1000.00000000",
            to_amount: "10.52000000", executed_rate: q.quoted_rate, mid_rate: q.mid_rate, fee: "2.50000000", fee_currency: "INR",
            trade_value_base: "1000.00", base_currency: "INR", executed_at: new Date().toISOString(), ledger_entries: [],
            pnl: null, quote_created_at: q.created_at, quote_expires_at: q.expires_at, rate_recorded_at: q.rate_recorded_at,
          },
        },
      },
    });
    renderWithProviders(<Harness />);
    const user = await getQuote();
    await user.click(await screen.findByRole("button", { name: /Review & confirm/ }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm your trade" });
    expect(within(dialog).getByText(/Debited from your wallet/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText("1,002.50 INR").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Credited to your wallet/i)).toBeInTheDocument();

    await act(async () => {
      await user.click(within(dialog).getByRole("button", { name: /^Confirm/ }));
    });
    expect(await screen.findByText("Trade executed")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "TRD-261031-ABC123" })[0]).toHaveAttribute("href", "/transactions/42");
    expect(screen.getByText("510.52 USD")).toBeInTheDocument();

    const exec = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/trade/execute"))!;
    const headers = exec[1]!.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(exec[1]!.body as string)).toEqual({ quote_id: q.quote_id });
  });

  it("explains an expired-quote rejection from the server in plain language", async () => {
    mockFetch({
      ...baseRoutes,
      "POST /api/trade/quote": { status: 201, body: makeQuote() },
      "POST /api/trade/execute": {
        status: 410,
        body: { error: { code: "quote_expired", message: "Your quote expired before it was confirmed.", details: null } },
      },
    });
    renderWithProviders(<Harness />);
    const user = await getQuote();
    await user.click(await screen.findByRole("button", { name: /Review & confirm/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Confirm/ }));
    expect((await screen.findAllByText(/30-second price window closed/)).length).toBeGreaterThan(0);
  });

  it("validates the amount against the currency's decimals before calling the API", async () => {
    const fetchMock = mockFetch(baseRoutes);
    const user = userEvent.setup();
    renderWithProviders(<Harness initialFrom="INR" initialTo="JPY" />);
    await screen.findByRole("option", { name: /INR · ₹1,00,000.00 available/ });
    await user.type(screen.getByLabelText(/Amount of JPY to buy/i), "10.5");
    await user.click(screen.getByRole("button", { name: "Get quote" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This currency has no decimal places.");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/trade/quote"))).toBe(false);
  });
});
