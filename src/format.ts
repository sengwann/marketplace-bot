import type { Listing } from "./generated/prisma/client";
import {
  CATEGORY_LABELS,
  CATEGORY_TAGS,
  LOCATION_LABELS,
  LOCATION_TAGS,
  type Category,
  type Location,
} from "./types";
import { escapeHtml } from "./util";

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as Category] ?? category;
}

export function locationLabel(location: string): string {
  return LOCATION_LABELS[location as Location] ?? location;
}

export function formatPrice(l: Pick<Listing, "priceAmount" | "currency">): string {
  return `${Number(l.priceAmount).toLocaleString("en-US")} ${l.currency}`;
}

// "📍 ရွှေက္ကိုလ်" -> "ရွှေက္ကိုလ်" (the channel post has its own icons).
const withoutEmoji = (label: string) => label.replace(/^\S+\s+/, "");

const DIVIDER = "━━━━━━━━━━━━━━";

// The public post in the channel. Sent as a photo caption (max 1024 characters,
// see limits.ts). Layout, with a blank line between each block:
//
//   📌 Title
//
//   💰 Price / ✨ Condition / 📍 Location
//
//   📝 Note              (only if there is one)
//
//   📞 Contact
//
//   ━━━━━━━━━━━━━━
//   🟢 Available
//   🧾 ID
//   #Category #Location
export function channelCaption(l: Listing): string {
  const status =
    l.availability === "SOLD_OUT"
      ? "🔴 <b>Sold Out</b>"
      : "🟢 <b>Available</b>";

  const categoryTag = CATEGORY_TAGS[l.category as Category] ?? "Other";
  const locationTag = LOCATION_TAGS[l.location as Location] ?? "";

  const blocks = [
    `<b>📌 ${escapeHtml(l.productName)}</b>`,

    [
      `💰 <b>ဈေးနှုန်း:</b> ${escapeHtml(formatPrice(l))}`,
      `✨ <b>အခြေအနေ:</b> ${escapeHtml(l.condition)}`,
      `📍 <b>နေရာ:</b> ${escapeHtml(withoutEmoji(locationLabel(l.location)))}`,
    ].join("\n"),

    l.note ? `📝 <b>မှတ်ချက်:</b> ${escapeHtml(l.note)}` : null,

    `📞 <b>ဆက်သွယ်ရန်:</b> ${escapeHtml(l.contact)}`,

    [
      DIVIDER,
      status,
      `🧾 ID: <code>${escapeHtml(l.publicId)}</code>`,
      `#${categoryTag} #${locationTag}`,
    ].join("\n"),
  ];

  return blocks.filter((block): block is string => block !== null).join("\n\n");
}
