# TODO — known issues

Ordered by priority. Tick items off as they're fixed.

## 🔴 Critical — security & data safety
- [x] **1. API has no authentication.** Correct PIN → signed HttpOnly session cookie (30 days, rolling); `/api/data` returns 401 without it. Changing the PIN signs out all other devices. If no PIN is set the API is still open — set one.
- [x] **2. Cron endpoints are public.** Both cron routes now require Vercel's `CRON_SECRET` (and refuse to run if it isn't configured).
- [x] **3. Weak PIN hashing.** Salted scrypt. Old SHA-256 hashes are upgraded automatically on the next correct PIN entry.
- [x] **20. Next.js 14.2.5 security vulnerability.** Upgraded to 14.2.35.

## 🟠 Data-integrity bugs
- [x] **4. Recurring items can be generated twice.** Generation is now a single `UPDATE … RETURNING` + `INSERT` statement, so only one caller can claim a month.
- [x] **5. Import duplicates everything.** Rows keep their original `created_at` and are skipped if already present; each import call is one transaction; large backups are sent in chunks and can simply be re-run.
- [x] **6. Backup is incomplete.** Export/import now cover receipts, savings goal, milestone rewards, theatres, OTT platforms, challenge history, IOU `settled`, and recurring `last_generated_month`.
- [x] **7. Offline queue issues.** 4xx responses are dropped (and reported) instead of retried forever; new records carry a `clientRequestId` so retries can't duplicate; a full localStorage queues without the photo instead of failing silently.
- [x] **8. `archiveChallenge` isn't atomic.** Runs as one transaction.

## 🟡 Performance
- [x] **9. `listExpenses` returns every receipt photo.** The list returns `has_receipt`; photos load on demand (`?type=receipts&ids=`) in an in-app viewer.
- [x] **10. Cold start runs ~25 sequential DDL statements.** One `SELECT` of `schema_version`; the DDL only runs (as one transaction) when `SCHEMA_VERSION` changes.
- [ ] **11. No pagination / date filtering.** *Deferred on purpose.* Insights, report and year views compute from the full history, so paging would need server-side aggregates first. With receipts out of the list payload (#9), an expense row is ~200 bytes, so a few years of data is still well under 1MB. Revisit if loading feels slow.

## 🔵 Code quality
- [x] **12. Dead files** removed.
- [x] **13. README, `schema.sql`, `.env.example`** rewritten to match the app.
- [ ] **14. Very large page files.** *Partly done:* shared `fmt`/`todayISO` moved to `lib/format.js`. Still to do: split `pages/index.js` (~1350 lines), settings, movies and sugar-challenge into components. Best done gradually, now that tests and lint exist.
- [x] **15. No tests or linting.** `npm test` (vitest; DB tests run real SQL on in-process Postgres via PGlite) and `npm run lint` (next/core-web-vitals, 0 errors). Internal `<a>` links switched to `next/link`.
- [x] **16. Errors are swallowed.** Push failures are logged; API errors say which call failed, and bad input (Postgres class 22) returns a 400 with the reason.

## ⚪ UX
- [x] **17. Recurring day limited to 1–28.** Now 1–31; 29–31 fall on the last day of shorter months.
- [x] **18. Server uses UTC.** Recurring generation and daily notifications use `APP_TIMEZONE` (default `Asia/Kolkata`).
- [x] **19. Top-up form default date is stale** after midnight. Computed when the form opens.

## Redesign (Nov 2026) — done
- [x] Phase 1: colour tokens + real dark mode, one button style, labelled bottom bar (Home · Insights · ＋ · Movies · Me), keypad lock screen, grouped Settings, 40px icon buttons, ≥11.5px text, labelled dates, chart legends, no silly percentages, "−₹" negatives.
- [x] Phase 2: quick-add sheet, new Home, Transactions page, Insights tab, shared data hook (`lib/useLedger.js`) + tested maths (`lib/ledger.js`).
- [x] Phase 3: Wrapped stories, badges & levels, mini challenges, plain-language insights.
- [x] Phase 4: movie posters (TMDB), WhatsApp IOU reminders, bill splitting, SMS paste, app-icon shortcuts, first-run welcome.

## Features batch 2 (Nov 2026) — done
- [x] App-icon badge, 9 PM nudge, learned categories, subscriptions, spending calendar, micro-animations, seasonal greetings,
      envelope jars, "Can I afford it?", bill reminders with UPI pay page, movie ratings/reviews + poster wall, "Pick for me",
      slip triggers, weekly server backups, shared spaces.

## Money features (Nov 2026) — done
- [x] Accounts & transfers, credit-card cycles + due reminders, encrypted card vault, loans & EMIs, net worth (+ monthly
      snapshots), refunds/cashback, trips, tax tags & FY summary, unusual-spend alerts, duplicate check, month-end
      forecast, statement CSV import, plain-English search. Schema v10. Tests: `tests/money*.test.js`.

## Life features (Nov 2026) — done
- [x] Habits, health log, free diet (Indian food table, plan, shopping list, Ask Claude), renewals / warranties /
      documents, vehicles & fuel, birthdays & gifts, lent items, OTT optimizer, Sunday summary, Home "coming up",
      CSV export, shortcuts. One `life_items` table (schema v11); kinds and fields in `lib/life.js`.
- [x] Recurring bills can be paid from an account or card; one vault passphrase is enforced (`vault_check`).
- [x] Card spends no longer count twice in "left to spend today" (card dues are set aside from the pool).

## Batch 3 (Nov 2026) — done
- [x] Card picker & rewards, fee waiver, points expiry · free-trial renewals · goals (incl. savings from an account) ·
      tax nudges Jan–Mar · UPI settle-up · PDF statements · Telugu/Hindi phase 1 · live mutual funds (mfapi.in) ·
      foreign currency (Frankfurter) · meters · wishlist · medicines + emergency card · medical records ·
      home inventory · maintenance · grocery list · journal · year beyond money. Schema v12.
- [x] Browser tests: `npm run e2e` (Playwright, Chromium at phone size, PGlite in place of Neon). Every page is
      opened and checked for errors; key flows are exercised end to end.

## Open follow-ups
- [ ] Movie cards feel cramped next to the poster on narrow phones; consider moving edit/delete into a ⋯ menu.
- [ ] Statement import reads CSV only; PDF statements need converting first.
- [ ] `schema.sql` is out of date (stops before v4); regenerate it from `ensureTables()`.
- [ ] Telugu / Hindi phase 2: translate the remaining screens (lib/i18n.js; strings are keyed by their English text).
- [ ] Grocery list is per person; a list shared between people would need a shared table (like watch-together lists).
- [ ] Live Google Sheets sync needs a Google sign-in for the app; CSV export from Search covers it for now.
- [ ] Health/diet preferences (goal, veg/non-veg) are kept per device (localStorage).
- [ ] Photos on warranties/documents aren't in backups (same as receipts in the weekly backups).
- [ ] Wikidata often lacks budget / box office for Indian films, so "hit or flop" shows only for some.
- [ ] Remaining lint warnings (9): React hook dependency warnings and `<img>` for receipt previews. Harmless, but worth a look during the #14 split.
