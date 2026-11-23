// Every screen opens without a JavaScript error or a failed API call.
import { test, expect } from "@playwright/test";

const PAGES = [
  "/", "/insights", "/movies", "/me", "/transactions", "/budget", "/challenges", "/sugar-challenge", "/ious", "/shows", "/search",
  "/settings", "/pause", "/year", "/report", "/badges", "/wrapped", "/shared",
  "/accounts", "/networth", "/loans", "/trips", "/tax", "/import",
  "/habits", "/health", "/diet", "/renewals", "/vehicles", "/people",
  "/medical", "/household", "/goals", "/wishlist", "/journal",
];

test("every page renders cleanly", async ({ page }) => {
  // First visit: skip the welcome screen a brand-new user would see.
  await page.goto("/me");
  await page.evaluate(() => localStorage.setItem("welcomed_v1", "1"));
  const problems = [];
  page.on("pageerror", (e) => problems.push(`${page.url()} → ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(404|icon)|hydrat/i.test(m.text())) problems.push(`${page.url()} console: ${m.text().slice(0, 200)}`); });
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(1200); // let data load and effects run
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error");
  }
  expect(problems).toEqual([]);
});
