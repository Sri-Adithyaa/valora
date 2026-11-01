import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INR, mockFetch, renderWithProviders } from "../test/utils";
import { LoginForm } from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

const me = {
  user: {
    user_id: 1, full_name: "Aarav Mehta", username: "demo", email: "demo@valora.money", phone: "+91 98765 43210",
    country: "India", base_currency: INR, account_status: "ACTIVE", is_demo: true, created_at: "2026-08-17T18:51:00Z",
  },
  wallet: null,
  unread_notifications: 0,
};

describe("LoginForm", () => {
  it("shows inline validation errors and does not call the API when fields are empty", async () => {
    const fetchMock = mockFetch({});
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Enter your email address or username.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email or username")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("displays the server's error message on bad credentials", async () => {
    mockFetch({
      "POST /api/auth/login": {
        status: 401,
        body: { error: { code: "invalid_credentials", message: "Incorrect email/username or password.", details: null } },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />, { route: "/login" });
    await user.type(screen.getByLabelText("Email or username"), "demo");
    await user.type(screen.getByLabelText("Password"), "wrong-password1");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email/username or password.");
  });

  it("maps field-level validation details from the API onto inputs", async () => {
    mockFetch({
      "POST /api/auth/login": {
        status: 422,
        body: {
          error: {
            code: "validation_error",
            message: "String should have at least 3 characters",
            details: [{ field: "identifier", message: "String should have at least 3 characters" }],
          },
        },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email or username"), "abc");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect((await screen.findAllByText("String should have at least 3 characters")).length).toBeGreaterThanOrEqual(1);
  });

  it("posts trimmed credentials and stores the session on success", async () => {
    const fetchMock = mockFetch({ "POST /api/auth/login": { status: 200, body: me } });
    const user = userEvent.setup();
    const { client } = renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email or username"), "  demo  ");
    await user.type(screen.getByLabelText("Password"), "ValoraDemo123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await vi.waitFor(() => expect(client.getQueryData(["me"])).toEqual(me));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ identifier: "demo", password: "ValoraDemo123" });
    expect(init!.credentials).toBe("include");
  });
});
