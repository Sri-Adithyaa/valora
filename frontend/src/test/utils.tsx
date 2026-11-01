import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { AppProviders } from "../components/AppProviders";
import type { Currency } from "../services/types";

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function renderWithProviders(ui: ReactElement, { route = "/", client = makeClient() } = {}) {
  return {
    client,
    ...render(
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders client={client}>{ui}</AppProviders>
      </MemoryRouter>,
    ),
  };
}

/** Renders the current location so tests can assert on redirects. */
export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}
export type RouteHandler = (req: { url: URL; init: RequestInit; body: unknown }) => MockResponse | Promise<MockResponse>;

/**
 * Stub global fetch with a route table keyed by "METHOD /api/path" (query string ignored).
 * Returns the mock so tests can inspect calls.
 */
export function mockFetch(routes: Record<string, RouteHandler | MockResponse>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const key = `${(init.method ?? "GET").toUpperCase()} ${url.pathname}`;
    const route = routes[key];
    if (!route) {
      return new Response(JSON.stringify({ error: { code: "not_mocked", message: `No mock for ${key}`, details: null } }), { status: 404 });
    }
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const res = typeof route === "function" ? await route({ url, init, body }) : route;
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const cur = (code: string, decimals = 2, symbol = code): Currency => ({
  currency_id: code.charCodeAt(0) * 100 + code.charCodeAt(1),
  currency_code: code,
  currency_name: { INR: "Indian Rupee", USD: "US Dollar", EUR: "Euro", JPY: "Japanese Yen", GBP: "British Pound" }[code] ?? code,
  currency_symbol: symbol,
  country: "Testland",
  decimals,
  status: "ACTIVE",
});

export const INR = cur("INR", 2, "₹");
export const USD = cur("USD", 2, "$");
export const EUR = cur("EUR", 2, "€");
export const JPY = cur("JPY", 0, "¥");
