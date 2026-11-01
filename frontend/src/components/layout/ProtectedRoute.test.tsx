import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNextPath } from "../AppProviders";
import { INR, LocationProbe, mockFetch, renderWithProviders } from "../../test/utils";
import { PublicOnly, RequireAuth, RequireWallet } from "./Layouts";

afterEach(() => vi.unstubAllGlobals());

const user = {
  user_id: 7, full_name: "Test User", username: "tester", email: "t@example.com", phone: "+91 98765 43210",
  country: "India", base_currency: INR, account_status: "ACTIVE", is_demo: false, created_at: "2026-10-01T00:00:00Z",
};
const wallet = {
  wallet_id: 3, wallet_reference: "VLM-0000-0000-0001", wallet_name: "Test Wallet", status: "ACTIVE",
  created_at: "2026-10-01T00:00:00Z", base_currency: INR,
};

function TestRoutes() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<PublicOnly><p>Login page</p></PublicOnly>} />
        <Route path="/wallet/setup" element={<RequireAuth><p>Wallet setup</p></RequireAuth>} />
        <Route element={<RequireWallet />}>
          <Route path="/portfolio" element={<p>Portfolio page</p>} />
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
        </Route>
      </Routes>
      <LocationProbe />
    </>
  );
}

describe("protected routes", () => {
  it("redirects anonymous visitors to /login and remembers where they were going", async () => {
    mockFetch({
      "GET /api/auth/me": { status: 401, body: { error: { code: "not_authenticated", message: "Please log in to continue.", details: null } } },
    });
    renderWithProviders(<TestRoutes />, { route: "/portfolio?tab=x" });
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fportfolio%3Ftab%3Dx");
  });

  it("sends signed-in users without a wallet to wallet setup", async () => {
    mockFetch({ "GET /api/auth/me": { body: { user, wallet: null, unread_notifications: 0 } } });
    renderWithProviders(<TestRoutes />, { route: "/portfolio" });
    expect(await screen.findByText("Wallet setup")).toBeInTheDocument();
  });

  it("renders the page for users with a wallet", async () => {
    mockFetch({ "GET /api/auth/me": { body: { user, wallet, unread_notifications: 0 } } });
    renderWithProviders(<TestRoutes />, { route: "/portfolio" });
    expect(await screen.findByText("Portfolio page")).toBeInTheDocument();
  });

  it("returns a signed-in user from /login to the `next` page", async () => {
    mockFetch({ "GET /api/auth/me": { body: { user, wallet, unread_notifications: 0 } } });
    renderWithProviders(<TestRoutes />, { route: "/login?next=%2Fportfolio" });
    expect(await screen.findByText("Portfolio page")).toBeInTheDocument();
  });

  it("ignores unsafe `next` targets (open-redirect guard)", () => {
    expect(safeNextPath("/trade?from=USD")).toBe("/trade?from=USD");
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
