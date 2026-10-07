import { describe, expect, it } from "vitest";
import { escapeHtml, generatePublicId, normalizePublicId, parsePrice } from "./util";

describe("parsePrice", () => {
  it("parses a plain price", () => {
    expect(parsePrice("25000 MMK")).toEqual({ priceAmount: 25000, currency: "MMK" });
  });

  it("accepts commas, lowercase and no space", () => {
    expect(parsePrice("25,000 mmk")).toEqual({ priceAmount: 25000, currency: "MMK" });
    expect(parsePrice("500thb")).toEqual({ priceAmount: 500, currency: "THB" });
  });

  it("accepts Burmese digits and Burmese currency words", () => {
    expect(parsePrice("၂၅,၀၀၀ ကျပ်")).toEqual({ priceAmount: 25000, currency: "MMK" });
    expect(parsePrice("၅၀၀ ဘတ်")).toEqual({ priceAmount: 500, currency: "THB" });
  });

  it("accepts decimals", () => {
    expect(parsePrice("99.5 THB")).toEqual({ priceAmount: 99.5, currency: "THB" });
  });

  it("rejects missing currency, unknown currency, zero and garbage", () => {
    expect(parsePrice("25000")).toBeNull();
    expect(parsePrice("10 USD")).toBeNull();
    expect(parsePrice("0 MMK")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });

  it("rejects a price too large for the database column", () => {
    expect(parsePrice("999999999999999 MMK")).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the characters Telegram HTML cares about", () => {
    expect(escapeHtml('<b>Tom & "Jerry"</b>')).toBe(
      "&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;",
    );
  });

  it("turns null and undefined into an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("listing IDs", () => {
  it("generates SK + 7 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePublicId()).toMatch(/^SK[A-HJKMNP-Z2-9]{7}$/);
    }
  });

  it("normalizes what an admin types", () => {
    expect(normalizePublicId(" #sk-7k2m9xq ")).toBe("SK7K2M9XQ");
  });
});
