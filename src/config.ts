import "dotenv/config";
import { parseQuietHours } from "./quietHours";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAdminIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      const parsed = Number(id);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid ADMIN_USER_IDS value: ${id}`);
      }
      return parsed;
    });

  if (ids.length === 0) {
    throw new Error("ADMIN_USER_IDS must contain at least one Telegram user ID.");
  }
  return [...new Set(ids)];
}

// How many listings one seller may submit per rolling 24 hours. 0 = no limit.
function parseDailyLimit(): number {
  const raw = (process.env.MAX_LISTINGS_PER_USER_PER_DAY ?? "").trim();
  if (raw === "") return 5;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `MAX_LISTINGS_PER_USER_PER_DAY must be a whole number (0 = no limit), got: ${raw}`,
    );
  }
  return value;
}

// Leave WEBHOOK_DOMAIN empty to run with long polling (handy on your laptop).
const webhookDomain = (process.env.WEBHOOK_DOMAIN ?? "").trim().replace(/\/$/, "");
const webhookSecret = (process.env.WEBHOOK_SECRET_TOKEN ?? "").trim();

if (webhookDomain) {
  if (process.env.NODE_ENV === "production" && !webhookDomain.startsWith("https://")) {
    throw new Error("WEBHOOK_DOMAIN must use https:// in production.");
  }
  if (!webhookSecret) {
    throw new Error("WEBHOOK_SECRET_TOKEN is required when WEBHOOK_DOMAIN is set.");
  }
}

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  adminChatId: requireEnv("ADMIN_CHAT_ID"),
  channelId: requireEnv("CHANNEL_ID"),
  adminUserIds: parseAdminIds(requireEnv("ADMIN_USER_IDS")),
  channelName: requireEnv("CHANNEL_NAME"),
  dailyListingLimit: parseDailyLimit(),

  webhookDomain,
  webhookPath: (process.env.WEBHOOK_PATH ?? "/telegram/webhook").trim(),
  webhookSecret,
  port: Number(process.env.PORT) || 3000,

  // Address the bot pings every 5 minutes so Render's free plan does not put it to sleep.
  // Only used in webhook mode. Render fills in RENDER_EXTERNAL_URL by itself;
  // KEEP_ALIVE_URL overrides it; KEEP_ALIVE=false turns the ping off.
  keepAliveUrl:
    process.env.KEEP_ALIVE === "false" || !webhookDomain
      ? ""
      : (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || webhookDomain)
          .trim()
          .replace(/\/$/, ""),

  // No pinging during these hours, in this time zone (default: 00:00-05:00 Myanmar time).
  // The same window is used when you set up the outside cron job, see README.
  // KEEP_ALIVE_QUIET_HOURS="" (empty) = ping all day.
  keepAliveQuiet: parseQuietHours(
    process.env.KEEP_ALIVE_QUIET_HOURS ?? "0-5",
    (process.env.KEEP_ALIVE_TIMEZONE ?? "Asia/Yangon").trim(),
  ),
};
