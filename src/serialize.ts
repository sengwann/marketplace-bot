import type { MiddlewareFn } from "telegraf";
import type { MyContext } from "./types";

// Handles updates from the SAME user one at a time.
//
// Why: Telegram delivers an album of 6 photos as 6 separate updates, and a
// double-tap on "Submit" as 2 updates. Without this they run at the same time
// and overwrite each other's session data (lost photos, duplicate listings).
// Different users still run in parallel.

const tails = new Map<string, Promise<void>>();

export const perUserQueue: MiddlewareFn<MyContext> = async (ctx, next) => {
  const id = ctx.from?.id ?? ctx.chat?.id;
  if (id === undefined) {
    return next();
  }

  const key = String(id);
  const previous = tails.get(key) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(key, tail);

  await previous;
  try {
    await next();
  } finally {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
};
