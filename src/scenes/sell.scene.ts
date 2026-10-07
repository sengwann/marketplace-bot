import { randomUUID } from "node:crypto";
import { Markup, Scenes } from "telegraf";
import { categoryLabel, locationLabel } from "../format";
import { LIMITS } from "../limits";
import { config } from "../config";
import { createListing, isOverDailyLimit, notifyAdmins } from "../listings";
import { logger } from "../logger";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  isCategory,
  isLocation,
  LOCATIONS,
  LOCATION_LABELS,
  type Category,
  type Currency,
  type Location,
  type MyContext,
} from "../types";
import { escapeHtml, parsePrice, PRICE_HELP } from "../util";

// The seller wizard. Steps, in order:
//  0 start   1 name   2 category   3 location   4 price   5 condition
//  6 note    7 contact   8 photos   9 review (submit / restart / cancel)
//
// Global commands (/start /sell /rules /cancel) are handled in bot.ts before
// this scene sees them, so the steps below only deal with their own input.

type EditField =
  | "productName"
  | "category"
  | "location"
  | "price"
  | "condition"
  | "note"
  | "contact";

interface Draft {
  submissionKey: string;
  /** Set while the seller is fixing one field from the review screen. */
  editing?: EditField;
  productName?: string;
  category?: Category;
  location?: Location;
  priceAmount?: number;
  currency?: Currency;
  condition?: string;
  note?: string | null;
  contact?: string;
  photoFileIds: string[];
  lastAlbumId?: string;
}

const draftOf = (ctx: MyContext) => ctx.wizard.state as Draft;

/** The text the user typed. Empty if it was not text, or was a /command. */
function getText(ctx: MyContext): string {
  const message = ctx.message;
  if (!message || !("text" in message)) return "";
  const text = message.text.trim();
  return text.startsWith("/") ? "" : text;
}

/** The data of the button that was pressed, if any. */
function getButton(ctx: MyContext): string | undefined {
  const query = ctx.callbackQuery;
  return query && "data" in query ? query.data : undefined;
}

const ack = (ctx: MyContext) => ctx.answerCbQuery().catch(() => {});

// ------------------------------------------------------------
// Keyboards
// ------------------------------------------------------------

const categoryKeyboard = () =>
  Markup.inlineKeyboard(
    CATEGORIES.map((c) => [Markup.button.callback(CATEGORY_LABELS[c], c)]),
  );

const locationKeyboard = () =>
  Markup.inlineKeyboard(
    LOCATIONS.map((l) => [Markup.button.callback(LOCATION_LABELS[l], l)]),
  );

const reviewKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ တင်မည်", "submit")],
    [Markup.button.callback("✏️ ပြင်မည်", "edit")],
    [
      Markup.button.callback("🔄 ပြန်စမည်", "restart"),
      Markup.button.callback("❌ ပယ်ဖျက်မည်", "cancel"),
    ],
  ]);

function reviewText(d: Draft): string {
  return (
    `📋 <b>ပစ္စည်းအချက်အလက်များကို စစ်ဆေးပါ</b>\n\n` +
    `📦 <b>ပစ္စည်းအမည်:</b> ${escapeHtml(d.productName)}\n` +
    `🏷️ <b>အမျိုးအစား:</b> ${escapeHtml(categoryLabel(d.category ?? ""))}\n` +
    `📍 <b>နေရာ:</b> ${escapeHtml(locationLabel(d.location ?? ""))}\n` +
    `💰 <b>ဈေးနှုန်း:</b> ${escapeHtml(
      `${(d.priceAmount ?? 0).toLocaleString("en-US")} ${d.currency ?? ""}`,
    )}\n` +
    `✨ <b>အခြေအနေ:</b> ${escapeHtml(d.condition)}\n` +
    `📝 <b>မှတ်ချက်:</b> ${escapeHtml(d.note || "မရှိပါ")}\n` +
    `📞 <b>ဆက်သွယ်ရန်:</b> ${escapeHtml(d.contact)}\n` +
    `📷 <b>ဓာတ်ပုံ:</b> ${d.photoFileIds.length} ပုံ\n\n` +
    `အချက်အလက်များ မှန်ကန်ပါက <b>တင်မည်</b> ကို နှိပ်ပါ။\n` +
    `မှားနေပါက <b>ပြန်စမည်</b> ကို နှိပ်ပြီး အစမှ ပြန်ဖြည့်ပါ။`
  );
}

// ------------------------------------------------------------
// Fixing one field from the review screen
// ------------------------------------------------------------

const backButton = Markup.button.callback("⬅️ မပြင်တော့ပါ", "edit_back");

const editMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("📦 အမည်", "edit_productName"),
      Markup.button.callback("💰 ဈေးနှုန်း", "edit_price"),
    ],
    [
      Markup.button.callback("🏷️ အမျိုးအစား", "edit_category"),
      Markup.button.callback("📍 နေရာ", "edit_location"),
    ],
    [
      Markup.button.callback("✨ အခြေအနေ", "edit_condition"),
      Markup.button.callback("📝 မှတ်ချက်", "edit_note"),
    ],
    [
      Markup.button.callback("📞 ဆက်သွယ်ရန်", "edit_contact"),
      Markup.button.callback("📷 ဓာတ်ပုံ", "edit_photos"),
    ],
    [backButton],
  ]);

const EDIT_PROMPTS: Record<Exclude<EditField, "category" | "location">, string> = {
  productName: "📦 ပစ္စည်းအမည်အသစ်ကို ရေးပေးပါ -",
  price: "💰 ဈေးနှုန်းအသစ်ကို ရေးပေးပါ - (ဥပမာ - 25000 MMK)",
  condition: "✨ အခြေအနေအသစ်ကို ရေးပေးပါ -",
  note: "📝 မှတ်ချက်အသစ်ကို ရေးပေးပါ - (မထားလိုပါက - ဟု ရေးပါ)",
  contact: "📞 ဆက်သွယ်ရန်အသစ်ကို ရေးပေးပါ -",
};

const showReview = (ctx: MyContext, d: Draft) =>
  ctx.reply(reviewText(d), { parse_mode: "HTML", ...reviewKeyboard() });

async function startEdit(ctx: MyContext, d: Draft, field: EditField) {
  d.editing = field;

  if (field === "category") {
    return ctx.reply(
      "🏷️ အမျိုးအစားအသစ်ကို ရွေးချယ်ပါ -",
      Markup.inlineKeyboard([
        ...CATEGORIES.map((c) => [Markup.button.callback(CATEGORY_LABELS[c], c)]),
        [backButton],
      ]),
    );
  }

  if (field === "location") {
    return ctx.reply(
      "📍 နေရာအသစ်ကို ရွေးချယ်ပါ -",
      Markup.inlineKeyboard([
        ...LOCATIONS.map((l) => [Markup.button.callback(LOCATION_LABELS[l], l)]),
        [backButton],
      ]),
    );
  }

  return ctx.reply(EDIT_PROMPTS[field], Markup.inlineKeyboard([[backButton]]));
}

/** Handles the seller's answer while d.editing is set. */
async function applyEdit(ctx: MyContext, d: Draft, action: string | undefined) {
  const field = d.editing as EditField;

  if (action === "edit_back") {
    await ack(ctx);
    d.editing = undefined;
    return showReview(ctx, d);
  }

  if (field === "category" || field === "location") {
    const valid =
      action !== undefined && (field === "category" ? isCategory(action) : isLocation(action));
    if (!valid) return ctx.reply("⚠️ ကျေးဇူးပြု၍ အပေါ်ပါ ခလုတ်များထဲမှ တစ်ခုကို ရွေးချယ်ပါ။");

    await ack(ctx);
    if (field === "category") d.category = action as Category;
    else d.location = action as Location;
    d.editing = undefined;
    return showReview(ctx, d);
  }

  // Text fields
  const text = getText(ctx);
  if (!text) {
    return ctx.reply('⚠️ စာသားဖြင့် ရေးပေးပါ သို့မဟုတ် "မပြင်တော့ပါ" ကို နှိပ်ပါ။');
  }

  const tooLong = (label: string, max: number) =>
    ctx.reply(`⚠️ ${label}သည် စာလုံး ${max} ထက် မပိုရပါ။`);

  switch (field) {
    case "productName":
      if (text.length > LIMITS.productName) return tooLong("ပစ္စည်းအမည်", LIMITS.productName);
      d.productName = text;
      break;

    case "price": {
      const price = parsePrice(text);
      if (!price) return ctx.reply(PRICE_HELP);
      d.priceAmount = price.priceAmount;
      d.currency = price.currency;
      break;
    }

    case "condition":
      if (text.length > LIMITS.condition) return tooLong("အခြေအနေ", LIMITS.condition);
      d.condition = text;
      break;

    case "note":
      if (text === "-") {
        d.note = null;
      } else {
        if (text.length > LIMITS.note) return tooLong("မှတ်ချက်", LIMITS.note);
        d.note = text;
      }
      break;

    case "contact":
      if (text.length > LIMITS.contact) return tooLong("ဆက်သွယ်ရန်အချက်အလက်", LIMITS.contact);
      d.contact = text;
      break;
  }

  d.editing = undefined;
  return showReview(ctx, d);
}

// ------------------------------------------------------------
// The scene
// ------------------------------------------------------------

export const sellScene = new Scenes.WizardScene<MyContext>(
  "SELL",

  // 0 — start (also runs again on "restart")
  async (ctx) => {
    // Refuse up front, so the seller doesn't fill in the whole form for nothing.
    if (ctx.from && (await isOverDailyLimit(ctx.from.id))) {
      await ctx.reply(
        `⚠️ ၂၄ နာရီအတွင်း ပစ္စည်း ${config.dailyListingLimit} ခုအထိသာ တင်ခွင့်ရှိပါသည်။\n\n` +
          "ကန့်သတ်ချက် ပြည့်သွားပါပြီ။ နောက်မှ ပြန်လည်ကြိုးစားပါ။",
      );
      return ctx.scene.leave();
    }

    const d = draftOf(ctx);
    for (const key of Object.keys(d)) {
      delete (d as unknown as Record<string, unknown>)[key];
    }
    d.submissionKey = randomUUID();
    d.photoFileIds = [];

    await ctx.reply("📦 ရောင်းချလိုသော ပစ္စည်း၏ အမည်ကို ရေးပြပေးပါ -");
    return ctx.wizard.next();
  },

  // 1 — product name
  async (ctx) => {
    const text = getText(ctx);
    if (!text) return ctx.reply("⚠️ ပစ္စည်းအမည်ကို စာသားဖြင့် ရေးပေးပါ။");
    if (text.length > LIMITS.productName) {
      return ctx.reply(`⚠️ ပစ္စည်းအမည်သည် စာလုံး ${LIMITS.productName} ထက် မပိုရပါ။`);
    }

    draftOf(ctx).productName = text;
    await ctx.reply("📂 ပစ္စည်း၏ အမျိုးအစားကို ရွေးချယ်ပါ -", categoryKeyboard());
    return ctx.wizard.next();
  },

  // 2 — category
  async (ctx) => {
    const choice = getButton(ctx);
    if (!choice || !isCategory(choice)) {
      return ctx.reply("⚠️ ကျေးဇူးပြု၍ အမျိုးအစားတစ်ခုကို ရွေးချယ်ပါ။");
    }

    await ack(ctx);
    draftOf(ctx).category = choice;
    await ctx.reply("📍 ပစ္စည်းရှိသော မြို့နယ်ကို ရွေးချယ်ပါ -", locationKeyboard());
    return ctx.wizard.next();
  },

  // 3 — location
  async (ctx) => {
    const choice = getButton(ctx);
    if (!choice || !isLocation(choice)) {
      return ctx.reply("⚠️ ကျေးဇူးပြု၍ မြို့နယ်တစ်ခုကို ရွေးချယ်ပါ။");
    }

    await ack(ctx);
    draftOf(ctx).location = choice;
    await ctx.reply(
      "💰 ဈေးနှုန်းနှင့် ငွေကြေးအမျိုးအစားကို ရေးပေးပါ -\n\n" +
        "(ဥပမာ - 25000 MMK, 500 THB)",
    );
    return ctx.wizard.next();
  },

  // 4 — price
  async (ctx) => {
    const price = parsePrice(getText(ctx));
    if (!price) return ctx.reply(PRICE_HELP);

    const d = draftOf(ctx);
    d.priceAmount = price.priceAmount;
    d.currency = price.currency;

    await ctx.reply(
      "✨ ပစ္စည်း၏ လက်ရှိအခြေအနေကို ရေးပြပေးပါ -\n\n" +
        "(ဥပမာ - 90% သန့်၊ အစုတ်အပြဲမရှိ၊ ဘူးပါမည်)",
    );
    return ctx.wizard.next();
  },

  // 5 — condition
  async (ctx) => {
    const text = getText(ctx);
    if (!text) return ctx.reply("⚠️ အခြေအနေကို စာသားဖြင့် ရေးပေးပါ။");
    if (text.length > LIMITS.condition) {
      return ctx.reply(`⚠️ အခြေအနေသည် စာလုံး ${LIMITS.condition} ထက် မပိုရပါ။`);
    }

    draftOf(ctx).condition = text;
    await ctx.reply(
      "📝 ထပ်မံဖော်ပြလိုသော အချက်အလက်ရှိပါက ရေးပေးပါ။\n\n" +
        "ဥပမာ - မူရင်းဘူးပါသည်၊ ဈေးနှုန်းညှိနှိုင်းနိုင်ပါသည်။\n\n" +
        'မထည့်လိုပါက "ကျော်မည် ⏭️" ခလုတ်ကို နှိပ်ပါ။',
      Markup.inlineKeyboard([[Markup.button.callback("ကျော်မည် ⏭️", "skip_note")]]),
    );
    return ctx.wizard.next();
  },

  // 6 — note (optional)
  async (ctx) => {
    const d = draftOf(ctx);

    if (getButton(ctx) === "skip_note") {
      await ack(ctx);
      d.note = null;
    } else {
      const text = getText(ctx);
      if (!text) {
        return ctx.reply(
          '⚠️ မှတ်ချက်ကို စာသားဖြင့် ရေးပေးပါ သို့မဟုတ် "ကျော်မည် ⏭️" ကို နှိပ်ပါ။',
        );
      }
      if (text.length > LIMITS.note) {
        return ctx.reply(`⚠️ မှတ်ချက်သည် စာလုံး ${LIMITS.note} ထက် မပိုရပါ။`);
      }
      d.note = text;
    }

    const username = ctx.from?.username;
    await ctx.reply(
      "📞 ဝယ်ယူလိုသူများ ဆက်သွယ်ရန် ဖုန်းနံပါတ် သို့မဟုတ် Telegram Username ကို ရေးပေးပါ -",
      username
        ? Markup.inlineKeyboard([
            [Markup.button.callback(`@${username} ကို သုံးမည်`, "use_username")],
          ])
        : undefined,
    );
    return ctx.wizard.next();
  },

  // 7 — contact
  async (ctx) => {
    const d = draftOf(ctx);

    if (getButton(ctx) === "use_username" && ctx.from?.username) {
      await ack(ctx);
      d.contact = `@${ctx.from.username}`;
    } else {
      const text = getText(ctx);
      if (!text) return ctx.reply("⚠️ ဆက်သွယ်ရန် အချက်အလက်ကို ရေးပေးပါ။");
      if (text.length > LIMITS.contact) {
        return ctx.reply(
          `⚠️ ဆက်သွယ်ရန်အချက်အလက်သည် စာလုံး ${LIMITS.contact} ထက် မပိုရပါ။`,
        );
      }
      d.contact = text;
    }

    await ctx.reply(
      "📷 ပစ္စည်းဓာတ်ပုံ ပို့ပေးပါ။\n\n" +
        `အနည်းဆုံး ၁ ပုံ၊ အများဆုံး ${LIMITS.maxPhotos} ပုံ ပို့နိုင်ပါသည်။\n` +
        'ဓာတ်ပုံများ ပို့ပြီးပါက "ပြီးပြီ ✅" ခလုတ်ကို နှိပ်ပါ။',
      Markup.inlineKeyboard([[Markup.button.callback("ပြီးပြီ ✅", "photos_done")]]),
    );
    return ctx.wizard.next();
  },

  // 8 — photos
  async (ctx) => {
    const d = draftOf(ctx);

    if (getButton(ctx) === "photos_done") {
      await ack(ctx);
      if (d.photoFileIds.length === 0) {
        return ctx.reply("⚠️ အနည်းဆုံး ဓာတ်ပုံ ၁ ပုံ ပို့ပေးရန် လိုအပ်ပါသည်။");
      }
      await showReview(ctx, d);
      return ctx.wizard.next();
    }

    const message = ctx.message;
    if (message && "photo" in message) {
      // An album arrives as several updates; only answer once per album.
      const albumId = "media_group_id" in message ? message.media_group_id : undefined;
      const firstOfBatch = !albumId || albumId !== d.lastAlbumId;
      d.lastAlbumId = albumId;

      if (d.photoFileIds.length >= LIMITS.maxPhotos) {
        if (firstOfBatch) {
          await ctx.reply(`⚠️ ဓာတ်ပုံ ${LIMITS.maxPhotos} ပုံထက် ပို၍ မတင်နိုင်ပါ။`);
        }
        return;
      }

      // Telegram sends several sizes of each photo; the last is the largest.
      d.photoFileIds.push(message.photo[message.photo.length - 1].file_id);

      if (firstOfBatch) {
        await ctx.reply(
          "✅ ဓာတ်ပုံ လက်ခံရရှိပါပြီ။ ထပ်ပို့နိုင်ပါသည်။\n" +
            'ပြီးပါက "ပြီးပြီ ✅" ကို နှိပ်ပါ။',
          Markup.inlineKeyboard([[Markup.button.callback("ပြီးပြီ ✅", "photos_done")]]),
        );
      }
      return;
    }

    return ctx.reply('⚠️ ဓာတ်ပုံ ပို့ပေးပါ သို့မဟုတ် "ပြီးပြီ ✅" ခလုတ်ကို နှိပ်ပါ။');
  },

  // 9 — review (submit / fix one field / restart / cancel)
  async (ctx) => {
    const action = getButton(ctx);

    // The seller is in the middle of fixing one field.
    if (draftOf(ctx).editing) {
      return applyEdit(ctx, draftOf(ctx), action);
    }

    if (!action) {
      return ctx.reply("⚠️ အောက်ပါခလုတ်များထဲမှ တစ်ခုကို ရွေးချယ်ပေးပါ။");
    }
    await ack(ctx);

    // "Edit" opens the field menu; "back" from the menu returns to the review.
    if (action === "edit") {
      return ctx.reply("✏️ ပြင်လိုသည့်အချက်ကို ရွေးချယ်ပါ -", editMenuKeyboard());
    }
    if (action === "edit_back") {
      return showReview(ctx, draftOf(ctx));
    }
    if (action === "edit_photos") {
      // Photos reuse the photo step: collect new ones, "done" returns to the review.
      const d = draftOf(ctx);
      d.photoFileIds = [];
      d.lastAlbumId = undefined;
      await ctx.reply(
        "📷 ဓာတ်ပုံအသစ်များ ပို့ပေးပါ။ (အဟောင်းများကို အစားထိုးပါမည်)\n\n" +
          `အနည်းဆုံး ၁ ပုံ၊ အများဆုံး ${LIMITS.maxPhotos} ပုံ ပို့နိုင်ပါသည်။\n` +
          'ပြီးပါက "ပြီးပြီ ✅" ကို နှိပ်ပါ။',
        Markup.inlineKeyboard([[Markup.button.callback("ပြီးပြီ ✅", "photos_done")]]),
      );
      return ctx.wizard.selectStep(8);
    }
    if (action.startsWith("edit_")) {
      const field = action.slice("edit_".length) as EditField;
      const known: EditField[] = [
        "productName",
        "category",
        "location",
        "price",
        "condition",
        "note",
        "contact",
      ];
      if (known.includes(field)) return startEdit(ctx, draftOf(ctx), field);
    }

    if (action === "cancel") {
      await ctx.reply("❌ ပစ္စည်းတင်ခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။");
      return ctx.scene.leave();
    }

    if (action === "restart") {
      return ctx.scene.enter("SELL");
    }

    if (action !== "submit") {
      return ctx.reply("⚠️ မမှန်ကန်သော ရွေးချယ်မှု ဖြစ်ပါသည်။");
    }

    const d = draftOf(ctx);
    if (
      !d.productName ||
      !d.category ||
      !d.location ||
      d.priceAmount === undefined ||
      !d.currency ||
      !d.condition ||
      !d.contact ||
      d.photoFileIds.length === 0 ||
      !ctx.from
    ) {
      return ctx.reply("⚠️ ပစ္စည်းအချက်အလက် မပြည့်စုံသေးပါ။ /sell ဖြင့် ပြန်စပါ။");
    }

    let result;
    try {
      result = await createListing({
        submissionKey: d.submissionKey,
        sellerTelegramId: BigInt(ctx.from.id),
        sellerUsername: ctx.from.username ?? null,
        sellerFirstName: ctx.from.first_name ?? null,
        productName: d.productName,
        category: d.category,
        location: d.location,
        priceAmount: d.priceAmount,
        currency: d.currency,
        condition: d.condition,
        note: d.note ?? null,
        contact: d.contact,
        photoFileIds: d.photoFileIds,
      });
    } catch (err) {
      logger.error({ err }, "Failed to save listing");
      return ctx.reply(
        "⚠️ စနစ်ပိုင်းဆိုင်ရာ အမှားအယွင်း ဖြစ်ပေါ်နေပါသည်။\n" +
          "ကျေးဇူးပြု၍ နောက်ထပ်ကြိုးစားပါ။",
      );
    }

    // The listing is saved. From here the seller always gets "success": if the
    // admin group can't be reached right now, the retry job delivers it later.
    await ctx.reply(
      "✅ သင့်ပစ္စည်းကို အောင်မြင်စွာ တင်ပြီးပါပြီ။\n\n" +
        "Admin များ စိစစ်ပြီးပါက Channel တွင် ဖော်ပြပေးပါမည်။",
    );
    await ctx.scene.leave();

    // A double-tap returns the existing listing (created = false): don't send it twice.
    if (result.created) {
      try {
        await notifyAdmins(ctx.telegram, result.listing);
      } catch (err) {
        logger.error(
          { err, listingId: result.listing.id },
          "Could not reach admin group; retry job will deliver it",
        );
      }
    }
  },
);
