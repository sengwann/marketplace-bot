import { config } from "./config"; // must be first: loads .env
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

import http from "node:http";
import { createBot, Sentry } from "./app";
import { closeDatabase, prisma } from "./db";
import { startKeepAlive } from "./keepAlive";
import { logger } from "./logger";
import { startAdminRetry } from "./retry";
import { deleteExpiredSessions } from "./session";

// Entry point: a laptop (long polling) or a server such as Render (webhook).

const bot = createBot();

// ------------------------------------------------------------
// HTTP server: health checks + thse Telegram webhook
// ------------------------------------------------------------

const useWebhook = config.webhookDomain !== "";

const webhook = useWebhook
  ? bot.webhookCallback(config.webhookPath, { secretToken: config.webhookSecret })
  : undefined;

// false while the bot is still starting (database, Telegram check). The HTTP server opens
// FIRST, so a wake-up ping gets its answer a few seconds sooner; Telegram updates that
// arrive in that short moment get a 503 and Telegram simply sends them again.
let ready = false;

const server = http.createServer(async (req, res) => {
  // "The process is alive". Cheap on purpose: no database call. Used by the cron-job.org
  // ping, the self-ping and Render's health check.
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ready }));
    return;
  }

  if (req.url === "/readyz") {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ready" }));
    } catch (err) {
      logger.error({ err }, "Readiness check failed");
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "not_ready" }));
    }
    return;
  }

  if (webhook && req.method === "POST" && req.url === config.webhookPath) {
    if (!ready) {
      res.writeHead(503, { "Retry-After": "5" });
      res.end();
      return;
    }
    await webhook(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

async function main() {
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info(`HTTP server listening on port ${config.port}`);

  await prisma.$connect();
  logger.info("Database connected");

  // Fails fast on a wrong BOT_TOKEN, and makes sure ctx.botInfo is set.
  bot.botInfo = await bot.telegram.getMe();

  const cleared = await deleteExpiredSessions();
  if (cleared > 0) logger.info({ cleared }, "Removed expired sessions");

  if (useWebhook) {
    const url = `${config.webhookDomain}${config.webhookPath}`;
    await bot.telegram.setWebhook(url, { secret_token: config.webhookSecret });
    logger.info(`Webhook set: ${url}`);
  } else {
    // Long polling (local development). launch() resolves only when the bot stops.
    void bot.launch().catch((err) => {
      logger.error({ err }, "Polling stopped");
      process.exit(1);
    });
    logger.info("Running with long polling (WEBHOOK_DOMAIN is empty)");
  }

  ready = true;
  startAdminRetry(bot.telegram); // delivers stuck listings, every 5 minutes
  startKeepAlive(); // pings itself every 5 minutes (not at night), see keepAlive.ts
  logger.info("Bot is ready");

  // The command menus are nice to have. Do them after the bot is ready, so a slow or
  // failing Telegram call can never delay or crash a wake-up.
  void setupMenus();
}

async function setupMenus() {
  // Menu shown in the "/" button
  const userCommands = [
    { command: "start", description: "Start the bot" },
    { command: "sell", description: "Post a new item" },
    { command: "cancel", description: "Cancel active operation" },
    { command: "rules", description: "View rules" },
  ];
  const adminCommands = [
    ...userCommands,
    { command: "setrules", description: "⚙️ Update rules" },
    { command: "soldout", description: "🔴 Mark listing sold out" },
    { command: "available", description: "🟢 Mark listing available" },
  ];

  try {
    await bot.telegram.setMyCommands(userCommands);
  } catch (err) {
    logger.warn({ err }, "Could not set the command menu");
    return;
  }

  for (const adminId of config.adminUserIds) {
    try {
      await bot.telegram.setMyCommands(adminCommands, {
        scope: { type: "chat", chat_id: adminId },
      });
    } catch (err) {
      // Happens if that admin has never opened a chat with the bot. Harmless.
      logger.warn({ err, adminId }, "Could not set admin command menu");
    }
  }
}

main().catch((err) => {
  Sentry.captureException(err);
  if ((err as { code?: string }).code === "P2021") {
    logger.error(
      "The database tables do not exist yet. Create them with `npx prisma migrate deploy` " +
        "(see README, section 'First-time database setup').",
    );
  }
  logger.error({ err }, "Failed to start");
  process.exit(1);
});

// ------------------------------------------------------------
// Last-resort error handlers
// ------------------------------------------------------------

// A forgotten promise that fails should be logged, not take the whole bot down.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  Sentry.captureException(reason);
});

// After an uncaught exception the process state is unknown: report it, then restart.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  Sentry.captureException(err);
  void Sentry.flush(2000).finally(() => process.exit(1));
});

// ------------------------------------------------------------
// Shutdown (PaaS sends SIGTERM on every deploy)
// ------------------------------------------------------------

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  // Never hang a deploy.
  setTimeout(() => process.exit(1), 10_000).unref();

  try {
    if (!useWebhook) bot.stop(signal);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });
    await closeDatabase();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
