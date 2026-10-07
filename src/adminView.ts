import { Markup, type Telegram } from "telegraf";
import { config } from "./config";
import { categoryLabel, formatPrice, locationLabel } from "./format";
import type { Listing } from "./generated/prisma/client";
import { CATEGORIES, CATEGORY_LABELS, LOCATIONS, LOCATION_LABELS } from "./types";
import { escapeHtml } from "./util";

// What the admin group sees: ONE control message per listing that is edited in
// place as the listing moves through its life.
//
// Button callback data (kept short; Telegram limits it to 64 bytes):
//   a:<id> approve     r:<id> reject      e:<id> open edit menu   eb:<id> back
//   ef:<field>:<id> edit a text field     ec:<id> / el:<id> category / location menu
//   sc:<CATEGORY>:<id> / sl:<LOCATION>:<id> set category / location
//   so:<id> sold out   av:<id> available

export type AdminMode = "pending" | "edit" | "approved" | "rejected";

type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

// ------------------------------------------------------------
// Keyboards
// ------------------------------------------------------------

export function pendingKeyboard(id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏️ ပြင်ဆင်မည်", `e:${id}`)],
    [
      Markup.button.callback("✅ အတည်ပြုမည်", `a:${id}`),
      Markup.button.callback("❌ ငြင်းပယ်မည်", `r:${id}`),
    ],
  ]);
}

export function editKeyboard(id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📦 အမည်", `ef:productName:${id}`),
      Markup.button.callback("💰 ဈေးနှုန်း", `ef:price:${id}`),
    ],
    [
      Markup.button.callback("🏷️ အမျိုးအစား", `ec:${id}`),
      Markup.button.callback("📍 မြို့နယ်", `el:${id}`),
    ],
    [
      Markup.button.callback("✨ အခြေအနေ", `ef:condition:${id}`),
      Markup.button.callback("📝 မှတ်ချက်", `ef:note:${id}`),
    ],
    [Markup.button.callback("📞 ဆက်သွယ်ရန်", `ef:contact:${id}`)],
    [Markup.button.callback("⬅️ ပြန်သွားမည်", `eb:${id}`)],
  ]);
}

export function categoryKeyboard(id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    ...CATEGORIES.map((c) => [
      Markup.button.callback(CATEGORY_LABELS[c], `sc:${c}:${id}`),
    ]),
    [Markup.button.callback("⬅️ နောက်သို့", `e:${id}`)],
  ]);
}

export function locationKeyboard(id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    ...LOCATIONS.map((l) => [
      Markup.button.callback(LOCATION_LABELS[l], `sl:${l}:${id}`),
    ]),
    [Markup.button.callback("⬅️ နောက်သို့", `e:${id}`)],
  ]);
}

export function availabilityKeyboard(id: string, isAvailable: boolean): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      isAvailable
        ? Markup.button.callback("🔴 Sold Out ပြောင်းမည်", `so:${id}`)
        : Markup.button.callback("🟢 Available ပြောင်းမည်", `av:${id}`),
    ],
  ]);
}

// ------------------------------------------------------------
// Text
// ------------------------------------------------------------

// "📍 ရွှေက္ကိုလ်" -> "ရွှေက္ကိုလ်" (each line already has its own icon).
const withoutEmoji = (label: string) => label.replace(/^\S+\s+/, "");

// Layout, with a blank line between each block:
//
//   📌 New listing + ID
//   📦 Product name
//   🏷️ Category / 📍 Town / 💰 Price / ✨ Condition
//   📝 Note              (only if there is one)
//   📞 Contact
//   ━━━━━━━━━━━━━━
//   👤 Seller
export function adminText(l: Listing): string {
  const seller = l.sellerUsername ? `@${escapeHtml(l.sellerUsername)}` : "မရှိပါ";

  const blocks = [
    [
      `<b>📌 ရောင်းရန် ပစ္စည်းအသစ်</b>`,
      `🧾 <b>Listing ID:</b> <code>${escapeHtml(l.publicId)}</code>`,
    ].join("\n"),

    `📦 <b>ပစ္စည်းအမည်:</b> ${escapeHtml(l.productName)}`,

    [
      `🏷️ <b>အမျိုးအစား:</b> ${escapeHtml(withoutEmoji(categoryLabel(l.category)))}`,
      `📍 <b>မြို့နယ်:</b> ${escapeHtml(withoutEmoji(locationLabel(l.location)))}`,
      `💰 <b>ဈေးနှုန်း:</b> ${escapeHtml(formatPrice(l))}`,
      `✨ <b>အခြေအနေ:</b> ${escapeHtml(l.condition)}`,
    ].join("\n"),

    l.note ? `📝 <b>မှတ်ချက်:</b> ${escapeHtml(l.note)}` : null,

    `📞 <b>ဆက်သွယ်ရန်:</b> ${escapeHtml(l.contact)}`,

    [
      "━━━━━━━━━━━━━━",
      `👤 <b>ရောင်းသူ:</b> ${seller} (ID: <code>${l.sellerTelegramId.toString()}</code>)`,
    ].join("\n"),
  ];

  return blocks.filter((block): block is string => block !== null).join("\n\n");
}

function footer(l: Listing, mode: AdminMode): string {
  switch (mode) {
    case "edit":
      return "\n\n✏️ <b>ပြင်လိုသည့်အချက်ကို ရွေးချယ်ပါ။</b>";
    case "approved":
      return (
        `\n\n✅ <b>အတည်ပြုပြီးပါပြီ</b> — ` +
        (l.availability === "SOLD_OUT" ? "🔴 Sold Out" : "🟢 Available")
      );
    case "rejected":
      return (
        `\n\n❌ <b>ပယ်ဖျက်ပြီးပါပြီ</b>\n` +
        `အကြောင်းပြချက်: ${escapeHtml(l.rejectionReason)}`
      );
    default:
      return "";
  }
}

function keyboardFor(l: Listing, mode: AdminMode): InlineKeyboard | undefined {
  switch (mode) {
    case "pending":
      return pendingKeyboard(l.id);
    case "edit":
      return editKeyboard(l.id);
    case "approved":
      return availabilityKeyboard(l.id, l.availability === "AVAILABLE");
    default:
      return undefined; // rejected: no buttons
  }
}

// ------------------------------------------------------------
// Updating the control message in the admin group
// ------------------------------------------------------------

export function isNotModified(err: unknown): boolean {
  return err instanceof Error && err.message.includes("message is not modified");
}

export async function renderAdminMessage(
  telegram: Telegram,
  l: Listing,
  mode: AdminMode,
): Promise<void> {
  if (l.adminMessageId === null) return;

  const keyboard = keyboardFor(l, mode);

  try {
    await telegram.editMessageText(
      config.adminChatId,
      Number(l.adminMessageId),
      undefined,
      adminText(l) + footer(l, mode),
      { parse_mode: "HTML", ...(keyboard ?? {}) },
    );
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}

// Swap only the buttons (used for the category / location pickers).
export async function showKeyboard(
  telegram: Telegram,
  l: Listing,
  keyboard: InlineKeyboard,
): Promise<void> {
  if (l.adminMessageId === null) return;

  try {
    await telegram.editMessageReplyMarkup(
      config.adminChatId,
      Number(l.adminMessageId),
      undefined,
      keyboard.reply_markup,
    );
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}
