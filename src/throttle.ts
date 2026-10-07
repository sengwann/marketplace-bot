import type { MiddlewareFn } from "telegraf";
import { config } from "./config";
import type { MyContext } from "./types";

// Simple spam guard for private chats: a user who sends more than MAX_UPDATES
// updates (messages, button taps, commands) within WINDOW_MS is ignored until they
// slow down. They get one "slow down" notice, at most once every WARN_EVERY_MS.
//
// Kept in memory, which is fine because the bot runs as a single instance.
// Admins and group chats are never throttled.
//
// MAX_UPDATES is generous on purpose: a 6-photo album arrives as 6 updates
// within a second, and that must never be dropped.

const WINDOW_MS = 10_000;
const MAX_UPDATES = 12;
const WARN_EVERY_MS = 30_000;

const hits = new Map<number, number[]>();
const lastWarned = new Map<number, number>();

// Forget users who have been quiet, so the maps never grow.
setInterval(() => {
  const now = Date.now();
  for (const [id, times] of hits) {
    if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(id);
  }
  for (const [id, time] of lastWarned) {
    if (now - time >= WARN_EVERY_MS) lastWarned.delete(id);
  }
}, 60_000).unref();

export const throttle: MiddlewareFn<MyContext> = async (ctx, next) => {
  const id = ctx.from?.id;
  if (
    id === undefined ||
    ctx.chat?.type !== "private" ||
    config.adminUserIds.includes(id)
  ) {
    return next();
  }

  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_UPDATES) {
    // Dropped updates are not counted, so the user recovers once the window passes.
    hits.set(id, recent);

    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

    if (now - (lastWarned.get(id) ?? 0) >= WARN_EVERY_MS) {
      lastWarned.set(id, now);
      await ctx
        .reply("⏳ မြန်လွန်းနေပါသည်။ ခဏစောင့်ပြီးမှ ပြန်လည်ကြိုးစားပါ။")
        .catch(() => {});
    }
    return;
  }

  recent.push(now);
  hits.set(id, recent);
  return next();
};
