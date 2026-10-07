import type { Telegram } from "telegraf";
import { prisma } from "./db";
import { notifyAdmins } from "./listings";
import { logger } from "./logger";

// Safety net: deliver listings that were saved but never reached the admin group
// (Telegram hiccup, server restarted mid-submit, ...).
// The 2 minute delay keeps it away from listings that are being sent right now
// (a send can take a while when Telegram asks us to wait, see telegramRetry.ts).
// It runs every 5 minutes (see startAdminRetry below, started from bot.ts).
// It only asks the database a question, so running often costs almost nothing.

const EVERY_MS = 5 * 60 * 1000;
const MIN_AGE_MS = 2 * 60 * 1000;

let running = false;

/** One round of the job. Returns how many listings were delivered. */
export async function runAdminRetryOnce(telegram: Telegram): Promise<number> {
  if (running) return 0;
  running = true;

  let delivered = 0;
  try {
    const stuck = await prisma.listing.findMany({
      where: {
        status: "PENDING",
        adminNotifiedAt: null,
        createdAt: { lt: new Date(Date.now() - MIN_AGE_MS) },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    for (const listing of stuck) {
      try {
        await notifyAdmins(telegram, listing);
        delivered++;
        logger.info({ listingId: listing.id }, "Delivered listing to admin group (retry)");
      } catch (err) {
        logger.error({ err, listingId: listing.id }, "Admin group retry failed");

        // Telegram says "too many requests": stop this round and try again next time.
        const code = (err as { response?: { error_code?: number } }).response?.error_code;
        if (code === 429) break;
      }
    }
  } catch (err) {
    logger.error({ err }, "Admin group retry job failed");
  } finally {
    running = false;
  }
  return delivered;
}

/** For the always-on server: run the job on a timer. */
export function startAdminRetry(telegram: Telegram): NodeJS.Timeout {
  const timer = setInterval(() => void runAdminRetryOnce(telegram), EVERY_MS);
  timer.unref();
  return timer;
}
