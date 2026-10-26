# SKK Marketplace Bot (v2)

A Telegram marketplace bot for **Shwe Kokko** and **Myawaddy**. Sellers fill a wizard →
the listing goes to the admin group → admins approve / reject / edit → approved listings
are posted to the public channel. Built for ~1000 users, ~10 admins, ~100 listings a day,
one developer.

**Stack:** TypeScript · [Telegraf](https://telegraf.js.org) v4 · Prisma 7 + PostgreSQL
(Supabase) · Pino logging · Sentry error tracking · Vitest tests · deployed on Render's
free plan (webhook mode; long polling locally).

## Commands

| Who | Command | What it does |
|---|---|---|
| Seller | `/start` | Welcome message with Sell / Rules buttons |
| Seller | `/sell` | Start the listing wizard (won't restart a form already in progress) |
| Seller | `/rules` | Show the marketplace rules (stored in the database, editable by admins) |
| Seller | `/cancel` | Abort the current wizard step / form |
| Admin | `/soldout SKxxxxxxx` | Mark an approved listing sold out |
| Admin | `/available SKxxxxxxx` | Put a sold-out listing back on sale |
| Admin | `/setrules` | Replace the rules text shown to everyone |
| HTTP | `GET /healthz`, `GET /readyz` | Health checks (`/healthz` answers even while the bot is still starting; `/readyz` returns 503 until ready) |

## How it works

- **Seller wizard** (`src/scenes/sell.scene.ts`): name, price, category, location,
  condition, note, contact, photos → review screen. A ✏️ field-edit button lets the seller
  redo a single field instead of restarting everything.
- **Admin flow** (`src/admin.ts`, `src/adminView.ts`): every submission is notified to the
  admin group. Approve is one atomic `PENDING → APPROVED` claim, then the post goes to the
  channel; if posting fails it flips back. Admins edit a listing by tapping a field and
  replying with the new value — saved immediately, no draft session.
- **Reliability**: a job every 5 minutes (`src/retry.ts`) delivers listings that never
  reached the admin group; Telegram `429 Too Many Requests` answers are retried after the
  requested delay (`src/telegramRetry.ts`); updates from one user are processed strictly
  one at a time (`src/serialize.ts`).
- **Spam guard** (`src/throttle.ts`): in private chats, more than 12 updates in 10 seconds
  are ignored, with one "slow down" notice per 30 s. Admins and groups are exempt.
- **Daily cap**: `MAX_LISTINGS_PER_USER_PER_DAY` (default 5, `0` = unlimited, admins exempt)
  over a rolling 24 h, counted at `/sell` start so sellers aren't refused after filling
  the whole form.
- **Sessions live in Postgres** (`src/session.ts`), so deploys don't wipe half-filled forms.
  Expired sessions are deleted when read, plus once at startup.
- **Prices**: Burmese digits and mixed units work — `၂၅,၀၀၀ ကျပ်`, `500 ဘတ်`, `500thb`.
- **Channel posts** (`src/format.ts`): blank-line separated blocks with a divider; worst
  case fits Telegram's 1024-character caption limit (limits centralized in `src/limits.ts`).

## Files

```
src/bot.ts                 entry point: HTTP server, webhook/polling, shutdown
src/app.ts                 builds the bot, command handlers, middleware order
src/config.ts              environment parsing/validation
src/scenes/sell.scene.ts   seller wizard
src/admin.ts               admin buttons, typed replies, /soldout /available /setrules
src/adminView.ts           admin message text + keyboards
src/listings.ts            create / notify admins / approve / reject / edit / sold out
src/retry.ts               every 5 min: deliver listings stuck before the admin group
src/telegramRetry.ts       retry on Telegram 429 (respecting retry_after)
src/quietHours.ts          quiet-hour window logic for keep-alive (pure, unit tested)
src/keepAlive.ts           self-ping every 5 min so Render stays awake
src/format.ts              channel post text
src/session.ts             Postgres session store
src/serialize.ts           one update at a time per user
src/throttle.ts            spam guard
src/settings.ts            rules text stored in the database
src/limits.ts              text limits (keep the sum under 1024, see comment)
src/db.ts, logger.ts, util.ts, types.ts
prisma/schema.prisma       Listing, BotSession, Setting (+ migrations/)
```

## Requirements

Node **≥ 20.19** (`.nvmrc` / `.node-version` pin Node 22, which CI and Render use).

## First run

```bash
cp .env.example .env        # fill it in
npm install
npx prisma migrate dev --name init   # creates prisma/migrations — commit that folder
npm run typecheck
npm test
npm run dev                 # leave WEBHOOK_DOMAIN empty to use polling locally
```

Prisma 7 notes: the config is in `prisma.config.ts`, the client is generated into
`src/generated/prisma` (git-ignored; `npm run build` generates it). If `prisma generate`
complains about `moduleFormat`, change it in `prisma/schema.prisma` to match your version.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | watch-mode dev server (`tsx watch src/bot.ts`) |
| `npm run build` | `prisma generate && tsc` |
| `npm start` | run the compiled bot (`node dist/bot.js`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | run the Vitest suite (`util`, `quietHours`, `telegramRetry`) |
| `npm run db:migrate` | local Prisma migration |
| `npm run render-build` | `prisma migrate deploy && npm run build` (used by Render) |

## Environment variables

All names are the same locally (`.env`) and on Render (Environment tab). No quotes around
values. See `.env.example` for the full annotated list.

| Variable | Required | Meaning |
|---|---|---|
| `BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `ADMIN_CHAT_ID` | ✅ | Admin group ID (negative, e.g. `-1001234567890`) |
| `CHANNEL_ID` | ✅ | Public channel ID or `@username`; bot must be channel admin |
| `ADMIN_USER_IDS` | ✅ | Comma-separated Telegram user IDs of admins |
| `CHANNEL_NAME` | ✅ | Shown in the `/start` message |
| `DATABASE_URL` | ✅ | Supabase **Session pooler** string (port 5432) |
| `DATABASE_SSL` | ✅ | `true` for Supabase |
| `WEBHOOK_DOMAIN` | – | Set on a server (e.g. `https://skk-bot.onrender.com`); empty = long polling |
| `WEBHOOK_SECRET_TOKEN` | if webhook | Long random string |
| `MAX_LISTINGS_PER_USER_PER_DAY` | – | Default `5`, `0` = unlimited |
| `KEEP_ALIVE` / `KEEP_ALIVE_URL` / `KEEP_ALIVE_QUIET_HOURS` / `KEEP_ALIVE_TIMEZONE` | – | Self-ping tuning (defaults: on, RENDER_EXTERNAL_URL, `0-5`, `Asia/Yangon`) |
| `SENTRY_DSN` | – | Error tracking (off if empty) |
| `LOG_LEVEL`, `PORT`, `WEBHOOK_PATH`, `DATABASE_CA_CERT` | – | Optional overrides |

## Telegram setup

- Add the bot to the **admin group**; put the group ID in `ADMIN_CHAT_ID` (negative number).
- Make the bot an **admin of the channel** (post + edit messages); put it in `CHANNEL_ID`.
- Every admin should open a private chat with the bot once (so their command menu can be set).

## Deploy (Render + Supabase)

1. **Supabase:** create a project. On **Connect** copy the **Session pooler** string (port 5432)
   into `DATABASE_URL`, and set `DATABASE_SSL=true`. Do not use the "Direct connection"
   (Render cannot reach it).
2. **Render:** New > Web Service, instance type **Free** (or use `render.yaml`, the Blueprint:
   free plan, Singapore, health check `/healthz`).
   - Build command: `npm install --include=dev && npm run render-build`
     (creates/updates the database tables with `prisma migrate deploy`, then builds)
   - Start command: `npm start` (only starts the bot, so it opens its port within seconds)
   - Health check path: `/healthz`
   - Env vars: everything in `.env.example`. `WEBHOOK_DOMAIN` is your service address,
     e.g. `https://skk-bot.onrender.com`. The webhook is registered automatically on start.
3. **Keep it awake in the daytime** (Render's free plan sleeps after 15 minutes without traffic).
   Free job on **cron-job.org**, every 10 minutes from 05:00 to 23:50 Myanmar time, silent at night:
   1. Sign up at cron-job.org and choose **Create cronjob**.
   2. Title: `SKK bot keep-alive`. URL: `https://<your-service>.onrender.com/healthz`.
   3. Schedule: custom, time zone **Asia/Yangon**, hours **5–23**, minutes **0,10,20,30,40,50**,
      every day (same as `*/10 5-23 * * *`). Nothing runs from 00:00 to 04:59.
   4. Request method: GET, default timeout (30 seconds).
   5. Notifications: alert after **3** consecutive failures, plus notify on success and on disable.
   6. Save, then press **Test run**. The answer must be HTTP 200 with `{"status":"ok","ready":true}`.

   Also built in: the bot pings itself every 5 minutes with the same quiet hours
   (`src/keepAlive.ts` + `src/quietHours.ts`, backup in case one cron-job.org run fails).
   Change the hours with `KEEP_ALIVE_QUIET_HOURS` (default `0-5`) and `KEEP_ALIVE_TIMEZONE`
   (default `Asia/Yangon`). If you change them, change the cron-job.org job to match.

   What happens at night: after the last ping (23:50) Render lets the service sleep about 15
   minutes later. A Telegram message at night wakes it (the first reply takes about a minute;
   Telegram re-sends until the bot answers, so nothing is lost). At 05:00 the cron-job.org
   ping wakes it; that first ping usually times out (waking takes longer than 30 seconds),
   which is normal — the 05:10 ping succeeds. This is why the failure alert is 3 in a row.
4. **Hours:** awake ~19 h/day is roughly 590 of the 750 free hours in a 31-day month.
   Keep it as the only free web service in that Render workspace.

What runs on Render: the spam throttle, the one-update-at-a-time queue per user, the
Telegram 429 retry, and the stuck-listing retry (every 5 minutes) all work as before.

## First-time database setup (do this once)

The bot needs its tables (`listings`, `bot_sessions`, `settings`) in Supabase. Without them
it stops at start-up with "The table `public.bot_sessions` does not exist".

1. On your computer, put the Supabase **Session pooler** string (port 5432) in your local
   `.env` as `DATABASE_URL`, with `DATABASE_SSL=true`.
2. In the project folder, run ONE of these:
   - There is **no** `prisma/migrations/` folder yet: `npx prisma migrate dev --name init`
   - The folder **exists** (it does in this repo): `npx prisma migrate deploy`
3. Check in Supabase (Table Editor) that the three tables exist.
4. **Commit and push the `prisma/migrations/` folder to GitHub.** Render's build runs
   `prisma migrate deploy` from it, so it must be in the repo. Then redeploy on Render.

If step 2 says it cannot create a shadow database (Supabase can refuse this), generate the
SQL without one instead:
`npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > init.sql`,
save it as `prisma/migrations/<timestamp>_init/migration.sql`, add a file
`prisma/migrations/migration_lock.toml` containing `provider = "postgresql"`, and run
`npx prisma migrate deploy`.

## Production files

- `.nvmrc` and `.node-version`: Node 22. Local tools (nvm, fnm, Volta) and Render read these.
  Render also gets `NODE_VERSION=22` from `render.yaml`; set that variable by hand if you
  created the service without the blueprint.
- `.github/workflows/ci.yml`: on every push and pull request, GitHub installs, generates the
  Prisma client, type-checks, runs the tests and builds. Uses dummy values, no secrets needed.
- `render.yaml`: optional Render Blueprint (free plan, Singapore, health check `/healthz`).
- `package-lock.json` pins exact versions so Render and CI install the same thing as you.
  After changing dependencies, run `npm install` and commit the updated lockfile.
- Run the checks yourself any time: `npm run typecheck && npm test && npm run build`.

## Rare problems and the 60-second fix

**A listing is APPROVED but never appeared in the channel** (server restarted in the 1–2
seconds while approving). Check the channel. If the post is missing:

```sql
UPDATE listings SET status='PENDING' WHERE public_id='SKxxxxxxx' AND channel_message_id IS NULL;
```

Then approve it again. If the post exists, copy its message number from the post link:

```sql
UPDATE listings SET channel_message_id=<NUMBER> WHERE public_id='SKxxxxxxx';
```

**Sold-out edit fails:** the database is already changed; run `/soldout SKxxxxxxx` again.

## Design decisions (why it looks like this)

Compared to the original v1 codebase, v2 deliberately simplified:

- **3 statuses instead of 4** — approval is one atomic `PENDING → APPROVED` claim followed by
  posting; failure flips back. No recovery cron, no publish-intent columns, no orphan cleanup.
- **No admin edit drafts in session** — tap a field, reply with the new value, done. State
  lives in the prompt text, not in the session (~600 lines removed).
- **Photos sent first, caption+buttons as a reply** — guarantees the caption can never exceed
  Telegram's limits; a mid-way failure is retried by the 5-minute job (worst case: photos shown twice).
- **Repeat submits never re-notify admins** — per-user serialization plus a unique `submissionKey`.
- **Removed dependencies** — express, express-rate-limit, node-cron, zod, telegraf-throttler
  replaced by a plain `http` server and `setInterval`.

Kept on purpose: unique `submissionKey`, atomic claim on approve, HTML escaping, admin checks,
Postgres sessions, the 5-minute stuck-listing job, Sentry, health checks.
