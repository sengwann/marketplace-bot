import { config } from "./config";
import { logger } from "./logger";
import { isQuietNow } from "./quietHours";

// Render's free plan puts a service to sleep after 15 minutes without incoming traffic,
// and waking it up takes about a minute. To avoid that, the bot visits its OWN public
// address every 5 minutes. The request goes out to the internet and comes back through
// Render's front door, so Render sees it as normal incoming traffic.
//
// Quiet hours (default 00:00-05:00 Myanmar time): no pinging, so the service may fall
// asleep at night and save free instance hours. A Telegram message at night still wakes it.
//
// This is the backup. The main pinger is the free job on cron-job.org (see README),
// which is also the only thing that can wake the service at 05:00 when it is asleep.

const EVERY_MS = 5 * 60 * 1000;

export function startKeepAlive(): NodeJS.Timeout | undefined {
  const base = config.keepAliveUrl;
  if (!base) return undefined; // laptop / polling mode: nothing to keep awake

  const url = `${base}/healthz`;
  const quiet = config.keepAliveQuiet;

  const ping = async () => {
    if (isQuietNow(quiet)) return; // night: let it sleep

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) logger.warn({ status: res.status }, "Keep-alive ping got a bad answer");
    } catch (err) {
      logger.warn({ err }, "Keep-alive ping failed");
    }
  };

  const timer = setInterval(() => void ping(), EVERY_MS);
  timer.unref();

  const quietText = quiet
    ? `, silent ${quiet.startHour}:00-${quiet.endHour}:00 ${quiet.timeZone}`
    : ", all day";
  logger.info(`Keep-alive ping every 5 minutes${quietText}: ${url}`);
  return timer;
}
