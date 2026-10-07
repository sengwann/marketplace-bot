import { config } from "./config"; // must be first: loads .env
import * as Sentry from "@sentry/node";
import { Markup, Scenes, session, Telegraf } from "telegraf";
import { registerAdmin } from "./admin";
import { logger } from "./logger";
import { sellScene } from "./scenes/sell.scene";
import { perUserQueue } from "./serialize";
import { sessionStore } from "./session";
import { getRules } from "./settings";
import { throttle } from "./throttle";
import type { MyContext, MySession } from "./types";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
});

// Builds the bot with all its handlers. It does NOT start anything: no server,
// no polling, no timers. That is done by src/bot.ts.
export function createBot(): Telegraf<MyContext> {
  const bot = new Telegraf<MyContext>(config.botToken);

  // ------------------------------------------------------------
  // Middleware order matters:
  //  1. spam guard   2. one update at a time per user   3. session   4. wizard scenes
  // ------------------------------------------------------------

  // Spam guard first, so ignored updates never even queue up.
  bot.use(throttle);
  bot.use(perUserQueue);

  bot.use(
    session<MySession, MyContext>({
      // One session per user per chat. Only the sell wizard uses it, but giving every
      // chat a session keeps the wizard stage from ever seeing a missing session.
      getSessionKey: (ctx) =>
        ctx.chat && ctx.from ? `${ctx.chat.id}:${ctx.from.id}` : undefined,
      defaultSession: () => ({}) as MySession,
      store: sessionStore,
    }),
  );

  const stage = new Scenes.Stage<MyContext>([sellScene], { ttl: 3600 });

  // ------------------------------------------------------------
  // Global commands
  // ------------------------------------------------------------

  const sellButton = Markup.button.callback("🛍 ပစ္စည်းရောင်းမည်", "start_sell");

  const sendStart = (ctx: MyContext) =>
    ctx.reply(
      `မင်္ဂလာပါ။ ${config.channelName} bot မှ ကြိုဆိုပါတယ်။ 📦\n\n` +
        `ရွှေက္ကိုလ် နှင့် မြဝတီ မြို့နယ်အတွက် အထွေထွေ ရောင်းဝယ်မှု Bot တစ်ခု ဖြစ်ပါသည်။`,
      Markup.inlineKeyboard([
        [sellButton],
        [Markup.button.callback("📜 စည်းကမ်းချက်များ", "rules")],
      ]),
    );

  const sendRules = async (ctx: MyContext) =>
    ctx.reply(await getRules(), Markup.inlineKeyboard([[sellButton]]));

  const enterSell = (ctx: MyContext) => {
    if (ctx.chat?.type !== "private") {
      return ctx.reply("⚠️ ပစ္စည်းတင်ရန် Bot နှင့် တိုက်ရိုက် (private) စကားပြောပြီး /sell ကို နှိပ်ပါ။");
    }

    // Already filling the form: do NOT restart it (that would throw away their answers).
    if (ctx.scene.current) {
      return ctx.reply(
        "⚠️ ပစ္စည်းတင်ရန် အချက်အလက်များ ဖြည့်သွင်းနေဆဲ ဖြစ်ပါသည်။\n\n" +
          "ဆက်လက်ဖြည့်သွင်းပါ၊ သို့မဟုတ် ပယ်ဖျက်ရန် /cancel ကို နှိပ်ပါ။",
      );
    }

    return ctx.scene.enter("SELL");
  };

  const cancel = async (ctx: MyContext) => {
    const wasFilling = !!ctx.scene.current;
    await ctx.scene.leave();
    return ctx.reply(
      wasFilling
        ? "❌ ပစ္စည်းတင်ခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။"
        : "ပယ်ဖျက်ရန် လုပ်ဆောင်နေသော အလုပ် မရှိပါ။",
    );
  };

  const commands = { start: sendStart, rules: sendRules, sell: enterSell, cancel };

  // Registered on the stage so they are answered while a seller is in the middle of
  // the wizard. Only /cancel ends the form; /start, /rules and /sell leave it alone.
  for (const [name, handler] of Object.entries(commands)) {
    stage.command(name, handler);
  }

  bot.use(stage.middleware());

  // Same commands outside the wizard / outside private chats.
  for (const [name, handler] of Object.entries(commands)) {
    bot.command(name, handler);
  }

  // ------------------------------------------------------------
  // Buttons on the start / rules messages
  // ------------------------------------------------------------

  bot.action("start_sell", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await enterSell(ctx);
  });

  bot.action("rules", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await sendRules(ctx);
  });

  // Admin buttons, replies and commands
  registerAdmin(bot);

  // Anything else typed to the bot in a private chat
  bot.on("text", (ctx) => {
    if (ctx.chat.type === "private") {
      return ctx.reply("ပစ္စည်းရောင်းရန် /sell ကို နှိပ်ပါ။ စည်းကမ်းချက်များကြည့်ရန် /rules");
    }
  });

  bot.catch((err, ctx) => {
    Sentry.captureException(err, {
      extra: { updateType: ctx.updateType, chatId: ctx.chat?.id, from: ctx.from?.id },
    });
    logger.error({ err }, `Error while handling ${ctx.updateType}`);
    ctx
      .reply("⚠️ စနစ်ပိုင်းဆိုင်ရာ အမှားအယွင်း ဖြစ်ပေါ်နေပါသည်။ ကျေးဇူးပြု၍ နောက်တစ်ကြိမ် ထပ်မံကြိုးစားပါ။")
      .catch(() => {});
  });

  return bot;
}

export { Sentry };
