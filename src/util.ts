import { randomInt } from "node:crypto";
import { LIMITS } from "./limits";
import type { Currency } from "./types";

// ------------------------------------------------------------
// HTML escaping (Telegram parse_mode: "HTML")
// ------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ------------------------------------------------------------
// Price parsing:  "25000 MMK", "၂၅,၀၀၀ ကျပ်", "500 thb", "500baht"
// ------------------------------------------------------------

const CURRENCY_ALIASES: Record<string, Currency> = {
  MMK: "MMK",
  KS: "MMK",
  "ကျပ်": "MMK",
  THB: "THB",
  BAHT: "THB",
  "ဘတ်": "THB",
};

export const PRICE_HELP =
  "⚠️ ဈေးနှုန်းနှင့် ငွေကြေးကို မှန်ကန်စွာ ရေးပေးပါ။\n" +
  "(ဥပမာ - 20000 MMK)\n\n" +
  "အသုံးပြုနိုင်သော ငွေကြေးများ: MMK, THB";

export function parsePrice(
  input: string,
): { priceAmount: number; currency: Currency } | null {
  const sanitized = input
    // Burmese digits ၀-၉ -> 0-9
    .replace(/[၀-၉]/g, (d) => String(d.charCodeAt(0) - 0x1040))
    .replace(/,/g, "")
    .trim();

  const match = sanitized.match(/^(\d+(?:\.\d+)?)\s*(\S+)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const currency = CURRENCY_ALIASES[match[2].toUpperCase()];

  if (
    !currency ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > LIMITS.maxPrice
  ) {
    return null;
  }

  return { priceAmount: amount, currency };
}

// ------------------------------------------------------------
// Public listing IDs:  SK + 7 characters (no 0/O/1/I/L lookalikes)
// ------------------------------------------------------------

const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePublicId(): string {
  let code = "";
  for (let i = 0; i < 7; i++) {
    code += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return `SK${code}`;
}

export function normalizePublicId(raw: string): string {
  return raw.trim().toUpperCase().replace(/^#/, "").replace(/-/g, "");
}
