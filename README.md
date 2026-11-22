# Expense Ledger

A personal money-and-habits tracker you install on your phone as an app (PWA). Built with
Next.js (pages router) + Postgres on Neon, deployed on Vercel — all on free tiers.

## Features
- **Home:** a "left to spend today" ring, swipeable cards (money, sugar streak — mark today
  right there — movies, savings goal, mini challenge), the day's top insight, today's entries.
- **＋ quick add** (centre of the bottom bar): big keypad, category chips, one-tap "usual"
  suggestions, paste a bank/UPI SMS, voice, receipt photo, split the bill (adds IOUs).
- **Insights:** this month vs last, where the money went, plain-language observations,
  money × movies × diet patterns, and a monthly **Wrapped** story you can share.
- **Me:** level & badges, mini challenges (no-delivery week, daily cap, no-spend weekend…).
- **Smarter money:** "Can I afford it?", spending calendar, subscriptions finder, envelope
  jars from category limits, categories learned from your own history.
- **Reminders:** 9 PM nudge if nothing's logged (or you went over), bills due tomorrow with a
  one-tap UPI pay page, weekly server backups (last 4 kept, restorable from Settings).
- **Accounts & cards:** bank, UPI, cash, wallets and credit cards, each with its own balance;
  pick which one paid in quick-add; transfers and "pay card bill" never count as spending.
  Cards show the billing cycle: bill due, due date, unbilled, limit used, with reminders
  3 days and 1 day before the due date. Card logins (link + username) and an **encrypted vault**
  for card number, CVV, PINs and passwords: sealed on the phone with a passphrase
  (PBKDF2 + AES-GCM, `lib/vault.js`), so the server and backups only hold ciphertext. A
  forgotten passphrase can't be recovered.
- **Loans & EMIs:** outstanding, EMIs left, payoff date, and "what if I prepay ₹X".
- **Net worth:** cash + accounts + investments + money owed to you, minus cards, loans and
  IOUs, with a monthly trend.
- **Refunds & cashback** linked to the original expense (category totals stay right).
- **Trips & events:** tag expenses (automatic while a trip is on); total, per person, per day.
- **Tax deductions:** tag expenses 80C / 80D / HRA…; per financial-year summary with limits and
  a CSV for your CA.
- **Smart checks:** unusual-spend alerts, a duplicate warning in quick-add, a month-end
  forecast vs your budget, bank/card **statement CSV import** (safe to re-run), and
  plain-English search ("food last month over 500").
- **Habits:** daily check-ins, streaks, a goal of N days a week.
- **Health:** weight, sleep (from bed/wake times), mood, steps, water; weight trend, and how mood
  and sleep line up with spending.
- **Diet (free, offline):** ~75 common Indian foods, daily calorie/protein/sugar targets by goal,
  a rule-based 7-day plan (veg / egg / non-veg) with a priced shopping list, and an "Ask Claude"
  button that copies your week into a prompt for the free Claude app.
- **Renewals & documents:** insurance, PUC, licence, passport, rent… with reminders 30/7/1/0 days
  before; warranties with a bill photo; ID documents with numbers sealed in the vault.
- **Vehicles:** fuel log, real mileage (full-tank method), fuel cost per km, service due by km.
- **People:** birthdays and anniversaries (reminder a week before and on the day, WhatsApp
  wishes), gift history and budget, and things you've lent out.
- **More movie info (free sources, each optional):** IMDb / Rotten Tomatoes / Metacritic (OMDb),
  budget vs box office and a summary (Wikidata + Wikipedia, no key), exact episode air times
  (TVmaze, no key), logos (fanart.tv), subtitle languages (OpenSubtitles), YouTube review videos,
  and a one-time Trakt import. Settings → Movie data sources shows which are on (`lib/movieApis.js`).
- **Streaming check:** apps you pay for vs what you watched on them in 90 days (on Shows).
- **Sunday summary** push, a "coming up" card on Home, CSV export from Search, more app-icon shortcuts.
- **Shared spaces:** split costs with a flatmate or partner through a private link — they
  only see that space, no PIN or account needed.
- **Ledger:** log expenses by typing, voice, quick-add, or with a receipt photo. Wallet balance
  (top-ups or "set balance"), recurring expenses and income, budget rules, a savings goal.
- **Movies:** what you watched, ticket and snack costs, theatre or streaming service, your
  opinion vs. the public's, and a watchlist.
- **Sugar challenge:** a daily no-sugar streak with savings and history.
- **IOUs**, search, insights, a monthly report and a year in review.
- **Phone-app features:** installable, works offline (changes queue and sync later), push
  notifications, PIN lock with optional fingerprint/face unlock, light and dark themes.
- **Backup:** export everything (receipts included) to JSON from Settings, and import it
  again. Import skips records you already have, so it's safe to run more than once.

## Project layout
| Path | What it is |
|---|---|
| `pages/*.js` | One file per screen. `_app.js` is the shell: bottom nav, lock screen, offline sync. |
| `pages/api/data.js` | The single data API. `?type=` / `body.type` picks the resource; GET/POST/PUT/DELETE. |
| `pages/api/cron-*.js` | Daily jobs run by Vercel Cron (see `vercel.json`). |
| `pages/api/notify-water.js` | Water/sugar reminders, called by an external scheduler with `?secret=`. |
| `lib/db.js` | All SQL. Creates and migrates tables automatically (see `SCHEMA_VERSION`). |
| `lib/auth.js` | PIN hashing and the session cookie. |
| `lib/dates.js` | Server-side "today" in the app's timezone. |
| `lib/offlineQueue.js` | Browser-side queue for changes made offline. |
| `public/sw.js` | Service worker: offline fallback and push notifications. |
| `schema.sql` | Reference copy of the table definitions (the app applies them itself). |
| `TODO.md` | Known issues and their status. |

## Security model
- Set a **PIN** in Settings. After a correct PIN, the server sets a signed, HttpOnly session
  cookie (30 days, renewed while you use the app). Every API call without it gets `401`.
- Changing the PIN signs out every other device.
- The PIN is stored as a salted scrypt hash.
- **With no PIN set, the API is open to anyone who has the URL**, so set one.
- Cron endpoints only run when called with Vercel's `CRON_SECRET`.

## Environment variables
| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres connection string (set automatically by the Vercel ↔ Neon integration). |
| `CRON_SECRET` | yes, for cron jobs | Any long random string. Vercel sends it to cron endpoints automatically; without it the daily jobs refuse to run. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for push | Generate with `npx web-push generate-vapid-keys`. |
| `WATER_NOTIFY_SECRET` | for water reminders | Shared secret for `/api/notify-water?secret=…`. |
| `OMDB_API_KEY`, `FANART_API_KEY`, `OPENSUBTITLES_API_KEY`, `YOUTUBE_API_KEY`, `TRAKT_CLIENT_ID` | optional | Free keys for extra movie info; see `.env.example`. Each feature stays hidden until its key is set. |
| `AUTH_SECRET` | no | Session signing secret. If unset, one is generated and stored in the database. |
| `TMDB_API_KEY` | no | Free key from themoviedb.org (v3 key or v4 read token) for real movie posters. Without it, posters are generated tiles. |
| `APP_TIMEZONE` | no | Defaults to `Asia/Kolkata`. Decides when "today" starts for recurring items and reminders. |

## Deploy
1. Push the repo to GitHub, then on vercel.com: **Add New → Project** and import it.
2. In the project, go to **Storage → Create Database → Neon (Free)** and connect it. This sets `DATABASE_URL`.
3. Under **Settings → Environment Variables**, add `CRON_SECRET` (and the push variables if you want notifications).
4. Redeploy. Tables are created on the first request.
5. Open the app, go to **Settings**, and **set a PIN**.

## Local development
```
npm install
cp .env.example .env.local   # paste DATABASE_URL (and any other variables) into it
npm run dev                  # http://localhost:3000
npm test                     # unit tests (vitest)
npm run lint                 # ESLint (next/core-web-vitals)
```

## Notes
- Built-in categories live in `CATEGORIES` at the top of `pages/index.js`. You can add custom ones in Settings.
- Currency formatting (₹, Indian digit grouping) lives in `fmt()` in `lib/format.js`.
- Receipt photos are compressed on the phone (`lib/receiptImage.js`) and stored in the
  database. The expense list only loads them when you open one.
