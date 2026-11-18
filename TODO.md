# TODO — known issues

Ordered by priority. Tick items off as they're fixed.

## 🔴 Critical — security & data safety
- [x] **1. API has no authentication.** ~~The PIN is only checked in the browser.~~ Fixed: correct PIN → signed HttpOnly session cookie (30 days, rolling); `/api/data` returns 401 without it. Changing the PIN signs out all other devices. Note: if no PIN is set, the API is still open — set one.
- [ ] **20. Next.js 14.2.5 has a known security vulnerability** (npm warns on install). Upgrade to the latest patched 14.2.x.
- [ ] **2. Cron endpoints are public.** `/api/cron-daily-notifications` and `/api/cron-generate-recurring` don't check Vercel's `CRON_SECRET` — anyone can trigger them and spam push notifications.
- [ ] **3. Weak PIN hashing.** Unsalted SHA-256 of a 4–8 digit PIN is brute-forceable instantly if the DB leaks. Use salted scrypt.

## 🟠 Data-integrity bugs
- [ ] **4. Recurring items can be generated twice.** `generateDueRecurring` / `generateDueRecurringIncome` (lib/db.js) do SELECT → INSERT → UPDATE non-atomically on every expense list load; concurrent loads duplicate entries. Fix with an atomic `UPDATE … WHERE last_generated_month != ym RETURNING`.
- [ ] **5. Import duplicates everything.** `importAll` doesn't dedupe and isn't transactional — importing twice doubles data; a mid-import failure leaves partial data.
- [ ] **6. Backup is incomplete.** Not exported: savings goal, milestone rewards, theatres, OTT platforms. Exported but not imported: sugar-challenge history, receipt photos, IOU `settled` flag.
- [ ] **7. Offline queue issues.** 4xx responses are retried forever; a lost response after a successful write duplicates on retry (no idempotency key); queuing a receipt photo can overflow localStorage (unhandled `QuotaExceededError`).
- [ ] **8. `archiveChallenge` isn't atomic.** Insert history + 2 deletes run as separate statements.

## 🟡 Performance
- [ ] **9. `listExpenses` returns every receipt photo** (base64) on every load. Return a `has_receipt` flag and fetch the photo on demand.
- [ ] **10. Cold start runs ~25 sequential DDL statements** in `ensureTables()`.
- [ ] **11. No pagination / date filtering** — every page fetches all history.

## 🔵 Code quality
- [ ] **12. Dead files:** `lib/balance.js`, `lib/movies.js`, `lib/sugarChallenge.js`, `lib/budget.js`.
- [ ] **13. README and `schema.sql` are outdated** (describe an `app/` dir and a single table).
- [ ] **14. Very large page files:** `pages/index.js` (~1300 lines), settings, movies, sugar-challenge.
- [ ] **15. No tests or linting.**
- [ ] **16. Errors are swallowed:** non-404/410 push failures ignored; all server errors return a generic "Server error".

## ⚪ UX
- [ ] **17. Recurring day limited to 1–28** — no "last day of month" option.
- [ ] **18. Server uses UTC** for recurring generation; 00:00–05:30 IST it still thinks it's the previous day.
- [ ] **19. Top-up form default date is computed once at module load** — stale if the app stays open past midnight.
