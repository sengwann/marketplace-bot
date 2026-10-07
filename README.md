
# SKK Marketplace Bot (v2, lean)

Sellers fill a wizard → listing goes to the admin group → admins approve / reject / edit →
approved listings are posted to the public channel. Built for ~1000 users, ~10 admins,
~100 listings a day, one developer.

> **Not compiled or run yet.** The environment this was written in blocked `npm install`,
> so run the three checks in "First run" before you trust it. The pure helpers
> (`src/util.ts`: price parsing, IDs, escaping) were run and behave as expected.

## What changed from your old code

| Old | New |
|---|---|
| 4 statuses (+APPROVING), recovery cron, `/resetlisting`, publish-intent columns, orphan-post cleanup | 3 statuses. Approve = one atomic `PENDING → APPROVED`, then post. If posting fails it flips back. |
| Optimistic-lock `version`, `originalData`, `approvalStartedAt`, `adminGroupMediaMessageId`, … | Gone. 22 columns → 17. |
| Admin edit draft in session + Preview + Save + Cancel (~600 lines) | Tap a field, reply with the new value, it is saved immediately and the admin message refreshes. State lives in the prompt text, not in the session. |
| Session cleanup cron | Expired sessions are deleted when read, plus once at startup. |
| `sendMediaGroup` caption could exceed 1024 chars → listing silently stuck | Limits lowered (`src/limits.ts`), admin message is plain text (4096 limit), photos are sent first and the text + buttons follow as a reply to them. The buttons only appear once the photos arrived; a failure in between is retried by the 5-minute job (worst case: photos shown twice). |
| Double-tap on Submit could notify admins twice | Updates from the same user are processed one at a time (`src/serialize.ts`), and a repeat submit never re-sends. |
| Reject left the buttons on the admin message | Control message ID comes from the database. |
| Seller review: submit or restart everything | New **✏️ ပြင်မည်** button: pick one field (name, price, category, location, condition, note, contact, photos), redo just that, and land back on the review. |
| `/sell` mid-form restarted the form | `/sell` (and the Sell button) while filling the form just says "you're already filling one, /cancel to stop". `/start` and `/rules` also leave the form alone. Only `/cancel` ends it. |
| No limit on spam / number of listings | **Spam guard** (`src/throttle.ts`): in private chats, more than 12 updates in 10 seconds are ignored, with one "slow down" notice per 30 s. Admins and groups are exempt. **Daily cap**: `MAX_LISTINGS_PER_USER_PER_DAY` in `.env` (default 5, `0` = unlimited, admins exempt) over a rolling 24 h; every status counts, including rejected. Checked when `/sell` starts, so sellers aren't refused after filling the whole form. Change the number and restart. |
| Cramped channel post (and a doubled 📍 icon) | Channel caption in `src/format.ts` now has blank lines between blocks (title / price-condition-location / note / contact / status-ID-tags) and a divider line. Worst case with every field at its limit is 781 of Telegram's 1024 characters. |
| Prices in Burmese digits rejected | `၂၅,၀၀၀ ကျပ်`, `500 ဘတ်`, `500thb` all work. |
| express, express-rate-limit, node-cron, zod, telegraf-throttler | Removed. Plain `http` server + `setInterval`. |

Kept on purpose: unique `submissionKey`, atomic claim on approve, HTML escaping, admin checks,
Postgres sessions (deploys don't wipe half-filled forms), the 5-minute job that delivers
listings that never reached the admin group, Sentry, health checks.

## Files

```
src/bot.ts            start-up, middleware order, HTTP server, shutdown
src/scenes/sell.scene.ts   seller wizard
src/admin.ts          admin buttons, typed replies, /soldout /available /setrules
src/adminView.ts      admin message text + keyboards
src/listings.ts       create / notify admins / approve / reject / edit / sold out
src/retry.ts          every 5 min: deliver listings that never reached the admin group
src/format.ts         channel post text
src/session.ts        Postgres session store
src/serialize.ts      one update at a time per user
src/limits.ts         text limits (keep the sum under 1024, see comment)
```

## First run

```bash
cp .env.example .env        # fill it in
npm install
npx prisma migrate dev --name init   # creates prisma/migrations -- commit that folder
npm run typecheck
npm test
npm run dev                 # leave WEBHOOK_DOMAIN empty to use polling locally
```

Prisma 7 notes: the config is in `prisma.config.ts`, the client is generated into
`src/generated/prisma` (git-ignored; `npm run build` generates it). If `prisma generate`
complains about `moduleFormat`, change it in `prisma/schema.prisma` to match your version.

## Telegram setup

- Add the bot to the **admin group**; put the group ID in `ADMIN_CHAT_ID` (negative number).
- Make the bot an **admin of the channel** (post + edit messages); put it in `CHANNEL_ID`.
- Every admin should open a private chat with the bot once (so their command menu can be set).

## Deploy (Render + Supabase)

1. **Supabase:** create a project. On **Connect** copy the **Session pooler** string (port 5432)
   into `DATABASE_URL`, and set `DATABASE_SSL=true`. Do not use the "Direct connection"
   (Render cannot reach it).
2. **Render:** New > Web Service, instance type **Free**.
   - Build command: `npm install --include=dev && npm run build`
   - Start command: `npm start` (runs `prisma migrate deploy`, then the bot)
   - Health check path: `/healthz`
   - Env vars: everything in `.env.example`. `WEBHOOK_DOMAIN` is your service address,
     e.g. `https://skk-bot.onrender.com`. The webhook is registered automatically on start.
3. **Keep it awake in the daytime** (Render's free plan sleeps after 15 minutes without traffic).
   Free job on **cron-job.org**, every 10 minutes from 05:00 to 23:50 Myanmar time, silent at night:
   1. Sign up at cron-job.org and choose **Create cronjob**.
   2. Title: `SKK bot keep-alive`. URL: `https://<your-service>.onrender.com/healthz`.
   3. Schedule: choose the custom option and set
      - Time zone: **Asia/Yangon** (Myanmar time, UTC+6:30)
      - Hours: **5 to 23** (every hour from 05 to 23)
      - Minutes: **0, 10, 20, 30, 40, 50**
      - Days of month / months / days of week: every
      This is the same as the cron expression `*/10 5-23 * * *` in Asia/Yangon time:
      the first ping is 05:00, the last one is 23:50, and nothing runs from 00:00 to 04:59.
   4. Request method: GET. Leave the timeout at the default (30 seconds).
   5. Notifications: turn on "notify on failure" and set it to alert after **3** failures in a
      row, plus "notify when the job succeeds again" and "when the job is disabled".
   6. Save, then press **Test run**. The answer must be HTTP 200 with `{"status":"ok","ready":true}`.

   Also built in: the bot pings itself every 5 minutes with the same quiet hours (backup in case
   one cron-job.org run fails). Change the hours with `KEEP_ALIVE_QUIET_HOURS` (default `0-5`)
   and `KEEP_ALIVE_TIMEZONE` (default `Asia/Yangon`). If you change them, change the cron-job.org
   job to match.

   What happens at night: after the last ping (23:50) Render lets the service sleep about 15
   minutes later. A Telegram message at night wakes it (the first reply takes about a minute;
   Telegram sends the message again until the bot answers, so it is not lost). At 05:00 the
   cron-job.org ping wakes it. That first ping usually times out (waking takes longer than
   30 seconds), which is normal and the 05:10 ping succeeds. This is why you set the failure alert
   to 3 in a row.
4. **Hours:** awake about 19 hours a day is roughly 590 of the 750 free hours in a 31-day month.
   Keep it as the only free web service in that Render workspace.

What runs on Render: the spam throttle, the one-update-at-a-time queue per user, and the
stuck-listing retry (every 5 minutes) all work as before.

## Production files

- `.nvmrc` and `.node-version`: Node 22. Local tools (nvm, fnm, Volta) and Render read these.
  Render also gets `NODE_VERSION=22` from `render.yaml`; set that variable by hand if you
  created the service without the blueprint.
- `.github/workflows/ci.yml`: on every push and pull request, GitHub installs, generates the
  Prisma client, type-checks, runs the tests and builds. Uses dummy values, no secrets needed.
- `render.yaml`: optional Render Blueprint (free plan, Singapore, health check `/healthz`).
- **Do once:** run `npm install` on your computer and commit the new `package-lock.json`.
  It pins exact versions so Render and CI install the same thing as you. After that, add
  `cache: npm` under `node-version-file` in `ci.yml` to speed CI up.
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
# marketplace-bot

