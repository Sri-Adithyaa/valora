import { describe, expect, it } from "vitest";
import { INR, JPY, USD } from "../test/utils";
import {
  direction, formatMoney, formatNumber, formatPct, formatQuantity, formatRate, MINUS, relativeTime, secondsUntil,
  validateAmountInput,
} from "./format";

describe("formatMoney", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatMoney("100000", INR)).toBe("₹1,00,000.00");
    expect(formatMoney("12345678.5", INR)).toBe("₹1,23,45,678.50");
  });

  it("uses Western grouping for other currencies", () => {
    expect(formatMoney("1234567.891", USD)).toBe("$1,234,567.89");
  });

  it("respects JPY's 0 decimals", () => {
    expect(formatMoney("5280", JPY)).toBe("¥5,280");
    expect(formatMoney("5280.00000000", JPY, { code: true })).toBe("5,280 JPY");
  });

  it("formats the exact decimal string without float drift", () => {
    // 0.1 + 0.2 style issues can't happen: the string is formatted as-is.
    expect(formatMoney("1002.50000000", INR)).toBe("₹1,002.50");
    expect(formatMoney("9999999999999.995", USD)).toBe("$10,000,000,000,000.00");
  });

  it("signs P&L values and never prints a negative zero", () => {
    expect(formatMoney("586.05", INR, { signed: true })).toBe("+₹586.05");
    expect(formatMoney("-866.84", INR, { signed: true })).toBe(`${MINUS}₹866.84`);
    expect(formatMoney("-0.001", INR, { signed: true })).toBe("₹0.00");
  });

  it("accepts a bare currency code and returns a dash for missing values", () => {
    expect(formatMoney("10", "EUR")).toBe("€10.00");
    expect(formatMoney(null, USD)).toBe("—");
  });

  it("formats quantities with the ISO code", () => {
    expect(formatQuantity("674.29000000", USD)).toBe("674.29 USD");
  });
});

describe("formatPct", () => {
  it("adds a sign by default", () => {
    expect(formatPct("1.234")).toBe("+1.23%");
    expect(formatPct("-0.198")).toBe(`${MINUS}0.20%`);
  });
  it("shows zero without a sign", () => {
    expect(formatPct("0")).toBe("0.00%");
    expect(formatPct("-0.001")).toBe("0.00%");
  });
  it("can be unsigned and use custom decimals", () => {
    expect(formatPct("46.37", { signed: false, decimals: 1 })).toBe("46.4%");
  });
});

describe("formatRate", () => {
  it("uses 4 decimals for rates ≥ 1", () => {
    expect(formatRate("94.9242005000")).toBe("94.9242");
  });
  it("uses 5 significant digits for rates < 1", () => {
    expect(formatRate("0.0105241866")).toBe("0.010524");
    expect(formatRate("0.89454")).toBe("0.89454");
  });
});

describe("helpers", () => {
  it("reads direction from the string sign", () => {
    expect(direction("-1.2")).toBe("down");
    expect(direction("0.00")).toBe("flat");
    expect(direction("3")).toBe("up");
  });

  it("formats plain numbers in the currency's locale", () => {
    expect(formatNumber("1500000", 0, "INR")).toBe("15,00,000");
  });

  it("produces relative times", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(relativeTime("2026-10-31T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-31T11:58:00Z", now)).toBe("2 min ago");
    expect(relativeTime("2026-10-31T09:00:00Z", now)).toBe("3 h ago");
  });

  it("counts down seconds and never goes negative", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(secondsUntil("2026-10-31T12:00:30Z", now)).toBe(30);
    expect(secondsUntil("2026-10-31T11:59:00Z", now)).toBe(0);
  });

  it("validates amount input against the currency precision", () => {
    expect(validateAmountInput("", 2)).toMatch(/enter an amount/i);
    expect(validateAmountInput("abc", 2)).toMatch(/positive number/i);
    expect(validateAmountInput("0", 2)).toMatch(/greater than zero/i);
    expect(validateAmountInput("10.5", 0)).toMatch(/no decimal places/i);
    expect(validateAmountInput("10.123", 2)).toMatch(/at most 2/i);
    expect(validateAmountInput("1000.25", 2)).toBeNull();
  });
});
