# Expense Ledger

A personal expense tracker: Next.js app + Postgres, deployed on Vercel — 
entirely on free tiers. Every add/delete hits a real database via API
routes, so your data persists and is reachable from any device, not just
the browser you added expenses in.

## Free-tier footprint
- **Vercel Hobby plan** — free for personal, non-commercial projects.
  100GB bandwidth/month, generous function invocations — an app used by
  one person logging expenses won't come close.
- **Neon Postgres free tier** (connected through Vercel's Storage tab) —
  0.5GB storage, no time limit, no card required. An expense ledger is
  tiny (a few hundred bytes per row), so you'd need well over a million
  entries to approach that cap.
- Nothing in this project needs a paid add-on. If Vercel ever prompts you
  to "upgrade" during setup, that's for features you don't need here —
  skip it.

## What's inside
- `app/page.js` — the UI (add expense, monthly total, category chart, transaction list)
- `app/api/expenses/route.js` — GET (list) and POST (create)
- `app/api/expenses/[id]/route.js` — DELETE
- `lib/db.js` — Postgres queries via `@neondatabase/serverless` (auto-creates the `expenses` table on first request)
- `schema.sql` — same table, if you'd rather run it by hand in the Neon console

## Deploy it (10 minutes)

1. **Push this folder to a GitHub repo.**
   ```
   cd expense-tracker
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Create a new repo on GitHub, then `git remote add origin <your-repo-url>` and `git push -u origin main`.

2. **Import it into Vercel.**
   vercel.com → Add New → Project → import the GitHub repo. Framework preset auto-detects as Next.js. Deploy — it'll fail once, harmlessly, because there's no database yet. That's expected.

3. **Add a Neon database (free).**
   In the Vercel project → Storage tab → Create Database → choose **Neon** (Postgres) from the Marketplace → pick the **Free** plan. Once created, click **Connect** and select this project. Vercel automatically sets `DATABASE_URL` as an environment variable — no copy-pasting.

4. **Redeploy.**
   Deployments tab → redeploy the latest one so it picks up the new env var.

5. Open the deployed URL. The `expenses` table is created automatically the first time the app hits the database — no manual migration step.

## Local development
```
npm install
```
Copy `.env.example` to `.env.local` and paste in the connection string from Vercel (Settings → Environment Variables → reveal `DATABASE_URL`) or straight from the Neon console. Then:
```
npm run dev
```
Runs at `http://localhost:3000`.

## Notes
- Categories are fixed in `CATEGORIES` at the top of `app/page.js` — edit that array to add/remove/rename categories and their colors.
- Currency is hardcoded to ₹ (Indian Rupee) via the `fmt()` function in `app/page.js` — change the symbol there if needed.
- No login/auth — anyone with the URL can see and edit the data. Fine for personal use with a private URL; if you want it locked down, Vercel's Hobby plan includes password-protecting a deployment under Settings → Deployment Protection.
