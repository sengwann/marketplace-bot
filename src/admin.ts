import { Markup, type Telegraf } from "telegraf";
import {
  categoryKeyboard,
  locationKeyboard,
  renderAdminMessage,
  showKeyboard,
} from "./adminView";
import { config } from "./config";
import {
  approveListing,
  findById,
  findByPublicId,
  notifySellerApproved,
  notifySellerRejected,
  rejectListing,
  setAvailability,
  updatePending,
  UserError,
  type PendingPatch,
} from "./listings";
import { LIMITS } from "./limits";
import { logger } from "./logger";
import { getRules, setRules } from "./settings";
import { isCategory, isLocation, type MyContext } from "./types";
import { normalizePublicId, parsePrice, PRICE_HELP } from "./util";
import * as Sentry from "@sentry/node";

// ------------------------------------------------------------
// Who is allowed
// ------------------------------------------------------------

const isAdminUser = (ctx: MyContext) =>
  !!ctx.from && config.adminUserIds.includes(ctx.from.id);

const inAdminChat = (ctx: MyContext) =>
  !!ctx.chat && String(ctx.chat.id) === String(config.adminChatId);

/** Buttons and typed replies: an admin, inside the admin group. */
const isAdminAction = (ctx: MyContext) => isAdminUser(ctx) && inAdminChat(ctx);

/** Commands: an admin, in the admin group or in a private chat with the bot. */
const isAdminCommand = (ctx: MyContext) =>
  isAdminUser(ctx) && (ctx.chat?.type === "private" || inAdminChat(ctx));

const ADMIN_ONLY = "⚠️ ဤလုပ်ဆောင်ချက်ကို အုပ်ထိန်းသူများသာ အသုံးပြုခွင့်ရှိပါသည်။";

// ------------------------------------------------------------
// Editing a text field: the admin taps a field button, the bot sends a
// "reply to this message" prompt, and the admin's reply is saved straight away.
//
// The prompt ends with a tag like  (edit:productName:<listing id>)  so the bot
// knows what the reply is for without remembering anything between messages.
// Rejecting works the same way with  (reject:<listing id>).
// ------------------------------------------------------------

type TextField = "productName" | "price" | "condition" | "note" | "contact";

const PROMPTS: Record<TextField, string> = {
  productName: "📦 ပစ္စည်းအမည်အသစ်ကို ရေးပေးပါ။",
  price: "💰 ဈေးနှုန်းအသစ်ကို ရေးပေးပါ။ (ဥပမာ - 25000 MMK)",
  condition: "✨ အခြေအနေအသစ်ကို ရေးပေးပါ။",
  note: "📝 မှတ်ချက်အသစ်ကို ရေးပေးပါ။ မထားလိုပါက - ဟု ရေးပါ။",
  contact: "📞 ဆက်သွယ်ရန်အသစ်ကို ရေးပေးပါ။",
};

const isTextField = (value: string): value is TextField => value in PROMPTS;

const tooLong = (label: string, max: number) =>
  `⚠️ ${label}သည် စာလုံး ${max} ထက် မပိုရပါ။`;

function buildPatch(
  field: TextField,
  value: string,
): { patch: PendingPatch } | { error: string } {
  switch (field) {
    case "productName":
      return value.length > LIMITS.productName
        ? { error: tooLong("ပစ္စည်းအမည်", LIMITS.productName) }
        : { patch: { productName: value } };

    case "price": {
      const price = parsePrice(value);
      return price ? { patch: price } : { error: PRICE_HELP };
    }

    case "condition":
      return value.length > LIMITS.condition
        ? { error: tooLong("အခြေအနေ", LIMITS.condition) }
        : { patch: { condition: value } };

    case "note":
      if (value === "-") return { patch: { note: null } };
      return value.length > LIMITS.note
        ? { error: tooLong("မှတ်ချက်", LIMITS.note) }
        : { patch: { note: value } };

    case "contact":
      return value.length > LIMITS.contact
        ? { error: tooLong("ဆက်သွယ်ရန်အချက်အလက်", LIMITS.contact) }
        : { patch: { contact: value } };
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function requirePending(id: string) {
  const listing = await findById(id);
  if (!listing) throw new UserError("Listing မတွေ့ပါ။");
  if (listing.status !== "PENDING") {
    throw new UserError("PENDING listing မဟုတ်တော့ပါ။ ပြင်ဆင်၍ မရပါ။");
  }
  return listing;
}

function reportError(err: unknown, where: string): string {
  if (err instanceof UserError) return err.message;
  logger.error({ err }, `Admin action failed: ${where}`);
  Sentry.captureException(err);
  return "❌ အမှားအယွင်း ဖြစ်ပေါ်ပါသည်။ ထပ်မံကြိုးစားပါ။";
}

// ------------------------------------------------------------
// Button presses
// ------------------------------------------------------------

const ACTIONS = new Set(["a", "r", "e", "eb", "ef", "ec", "el", "sc", "sl", "so", "av"]);

async function handleButton(
  ctx: MyContext,
  action: string,
  args: string[],
): Promise<string | undefined> {
  const telegram = ctx.telegram;

  switch (action) {
    // Approve
    case "a": {
      const listing = await approveListing(telegram, args[0]);
      await renderAdminMessage(telegram, listing, "approved");
      await notifySellerApproved(telegram, listing);
      return "✅ အတည်ပြုပြီးပါပြီ";
    }

    // Reject: ask for the reason
    case "r": {
      const listing = await requirePending(args[0]);
      const controlId = ctx.callbackQuery?.message?.message_id;
      await ctx.reply(
        `❌ ပယ်ဖျက်ရသည့် အကြောင်းပြချက်ကို ရေးပေးပါ။\n\n(reject:${listing.id})`,
        {
          ...Markup.forceReply(),
          ...(controlId ? { reply_parameters: { message_id: controlId } } : {}),
        },
      );
      return;
    }

    // Open the edit menu / go back
    case "e": {
      await renderAdminMessage(telegram, await requirePending(args[0]), "edit");
      return;
    }
    case "eb": {
      await renderAdminMessage(telegram, await requirePending(args[0]), "pending");
      return;
    }

    // Ask for a new value of a text field
    case "ef": {
      const [field, id] = args;
      if (!isTextField(field)) return;
      const listing = await requirePending(id);
      const controlId = ctx.callbackQuery?.message?.message_id;
      await ctx.reply(`${PROMPTS[field]}\n\n(edit:${field}:${listing.id})`, {
        ...Markup.forceReply(),
        ...(controlId ? { reply_parameters: { message_id: controlId } } : {}),
      });
      return;
    }

    // Category / location pickers
    case "ec": {
      const listing = await requirePending(args[0]);
      await showKeyboard(telegram, listing, categoryKeyboard(listing.id));
      return;
    }
    case "el": {
      const listing = await requirePending(args[0]);
      await showKeyboard(telegram, listing, locationKeyboard(listing.id));
      return;
    }
    case "sc": {
      const [value, id] = args;
      if (!isCategory(value)) return;
      await requirePending(id);
      const listing = await updatePending(id, { category: value });
      await renderAdminMessage(telegram, listing, "edit");
      return "✅";
    }
    case "sl": {
      const [value, id] = args;
      if (!isLocation(value)) return;
      await requirePending(id);
      const listing = await updatePending(id, { location: value });
      await renderAdminMessage(telegram, listing, "edit");
      return "✅";
    }

    // Sold out / available
    case "so":
    case "av": {
      const listing = await setAvailability(
        telegram,
        args[0],
        action === "so" ? "SOLD_OUT" : "AVAILABLE",
      );
      await renderAdminMessage(telegram, listing, "approved");
      return action === "so" ? "🔴 Sold Out" : "🟢 Available";
    }
  }
}

// ------------------------------------------------------------
// Register everything on the bot
// ------------------------------------------------------------

export function registerAdmin(bot: Telegraf<MyContext>): void {
  // ---- Buttons ----
  bot.on("callback_query", async (ctx, next) => {
    const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) return next();

    const [action, ...args] = data.split(":");
    if (!ACTIONS.has(action)) return next(); // not an admin button

    if (!isAdminAction(ctx)) {
      await ctx.answerCbQuery(ADMIN_ONLY, { show_alert: true }).catch(() => {});
      return;
    }

    try {
      const toast = await handleButton(ctx, action, args);
      await ctx.answerCbQuery(toast).catch(() => {});
    } catch (err) {
      await ctx
        .answerCbQuery(reportError(err, `button ${action}`), { show_alert: true })
        .catch(() => {});
    }
  });

  // ---- Typed replies to the bot's prompts (edit a field / give a reject reason) ----
  bot.on("text", async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (
      !replyTo ||
      !("text" in replyTo) ||
      replyTo.from?.id !== ctx.botInfo.id ||
      !isAdminAction(ctx)
    ) {
      return next();
    }

    const editTag = /\(edit:(\w+):([0-9a-f-]{36})\)\s*$/.exec(replyTo.text);
    const rejectTag = /\(reject:([0-9a-f-]{36})\)\s*$/.exec(replyTo.text);
    if (!editTag && !rejectTag) return next();

    const chatId = ctx.chat.id;
    const value = ctx.message.text.trim();
    if (!value) {
      await ctx.reply("⚠️ အချက်အလက် မရှိပါ။ ထပ်မံရေးပေးပါ။");
      return;
    }

    try {
      if (editTag) {
        const [, field, id] = editTag;
        if (!isTextField(field)) return next();

        const built = buildPatch(field, value);
        if ("error" in built) {
          await ctx.reply(built.error);
          return;
        }

        await requirePending(id);
        const listing = await updatePending(id, built.patch);
        await renderAdminMessage(ctx.telegram, listing, "edit");
      } else if (rejectTag) {
        const listing = await rejectListing(rejectTag[1], value);
        await renderAdminMessage(ctx.telegram, listing, "rejected");
        await notifySellerRejected(ctx.telegram, listing);
      }

      // Tidy up the prompt and the admin's reply (the admin message already shows the result).
      await ctx.telegram.deleteMessage(chatId, replyTo.message_id).catch(() => {});
      await ctx.deleteMessage().catch(() => {});
    } catch (err) {
      await ctx.reply(reportError(err, "typed reply"));
    }
  });

  // ---- /soldout and /available ----
  const changeAvailability = async (
    ctx: MyContext,
    text: string,
    availability: "SOLD_OUT" | "AVAILABLE",
  ) => {
    if (!isAdminCommand(ctx)) return ctx.reply(ADMIN_ONLY);

    const rawId = text.split(/\s+/)[1];
    if (!rawId) {
      return ctx.reply(
        `အသုံးပြုပုံ: /${availability === "SOLD_OUT" ? "soldout" : "available"} SK7K2M9XQ`,
      );
    }

    try {
      const found = await findByPublicId(normalizePublicId(rawId));
      if (!found) throw new UserError("Listing ID မတွေ့ပါ။");

      const listing = await setAvailability(ctx.telegram, found.id, availability);
      await renderAdminMessage(ctx.telegram, listing, "approved").catch(() => {});
      return ctx.reply(
        availability === "SOLD_OUT"
          ? `🔴 Sold Out ပြောင်းပြီးပါပြီ - ${listing.publicId}`
          : `🟢 Available ပြောင်းပြီးပါပြီ - ${listing.publicId}`,
      );
    } catch (err) {
      return ctx.reply(reportError(err, "availability command"));
    }
  };

  bot.command("soldout", (ctx) => changeAvailability(ctx, ctx.message.text, "SOLD_OUT"));
  bot.command("available", (ctx) => changeAvailability(ctx, ctx.message.text, "AVAILABLE"));

  // ---- /setrules ----
  bot.command("setrules", async (ctx) => {
    if (!isAdminCommand(ctx)) return ctx.reply(ADMIN_ONLY);

    const newRules = ctx.message.text.replace(/^\/setrules(@\w+)?\s*/, "").trim();

    if (!newRules) {
      return ctx.reply(
        `⚠️ စည်းကမ်းချက်အသစ် ထည့်သွင်းပေးပါ။\n\n` +
          `အသုံးပြုပုံ:\n/setrules စည်းကမ်းချက်အသစ် စာသားများ...\n\n` +
          `လက်ရှိ စည်းကမ်းချက်များ:\n\n${await getRules()}`,
      );
    }

    try {
      await setRules(newRules);
      return ctx.reply("✅ စည်းကမ်းချက်များကို အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။");
    } catch (err) {
      return ctx.reply(reportError(err, "setrules"));
    }
  });
}
