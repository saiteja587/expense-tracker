// Real flows in a real browser against the real API (in-memory database).
// Runs in order; the last test sets a PIN, so it stays last.
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/me");
  await page.evaluate(() => localStorage.setItem("welcomed_v1", "1"));
});

async function typeAmount(page, digits) {
  for (const d of digits) await page.getByRole("button", { name: d, exact: true }).click();
}

test("quick-add logs an expense and warns about a likely duplicate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an expense" }).click();
  await typeAmount(page, "250");
  await page.getByRole("radio", { name: /Food/ }).click();
  await page.getByPlaceholder(/Note \(optional\)/).fill("Swiggy dinner");
  await page.getByRole("button", { name: /Save ₹250/ }).click();
  await expect(page.getByText(/Swiggy dinner · ₹250 logged/)).toBeVisible();

  await page.getByRole("button", { name: "Add an expense" }).click();
  await typeAmount(page, "250");
  await page.getByRole("radio", { name: /Food/ }).click();
  await page.getByPlaceholder(/Note \(optional\)/).fill("swiggy order");
  await page.getByRole("button", { name: /Save ₹250/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Looks like you already logged" })).toBeVisible();
  await page.getByRole("button", { name: /Save ₹250/ }).click(); // second tap saves anyway
  await expect(page.getByText(/swiggy order · ₹250 logged/)).toBeVisible();
});

test("a credit card's secrets are sealed and only shown with the passphrase", async ({ page }) => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("radio", { name: /Credit card/ }).click();
  await page.getByPlaceholder(/Card name/).fill("HDFC Millennia");
  await page.getByRole("button", { name: /Add secret details/ }).click();
  await page.getByRole("textbox", { name: "Card number" }).fill("4111 1111 1111 1111");
  await page.getByLabel("CVV").fill("123");
  await page.getByLabel("ATM / card PIN").fill("4321");
  await page.getByLabel(/Vault passphrase/).fill("correct horse");
  await page.getByLabel("Type the passphrase again").fill("correct horse");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("HDFC Millennia", { exact: true })).toBeVisible();
  await expect(page.getByText("•••• 1111")).toBeVisible(); // last 4 filled from the number

  // What the server stored is ciphertext.
  const stored = await page.evaluate(async () => (await (await fetch("/api/data?type=accounts")).json()).accounts[0].vault);
  expect(stored).not.toContain("4111");
  expect(stored).not.toContain("4321");

  await page.getByRole("button", { name: /Show card details/ }).click();
  await page.getByPlaceholder("Vault passphrase").fill("wrong one");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByText("Wrong passphrase.")).toBeVisible();
  await page.getByPlaceholder("Vault passphrase").fill("correct horse");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByText("4111 1111 1111 1111")).toBeVisible();
  await expect(page.getByText(/Hides in \d+s/)).toBeVisible();

  // A second card with a different passphrase is refused.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("radio", { name: /Credit card/ }).click();
  await page.getByPlaceholder(/Card name/).fill("Axis Ace");
  await page.getByRole("button", { name: /Add secret details/ }).click();
  await page.getByRole("textbox", { name: "Card number" }).fill("5500 0000 0000 0004");
  await page.getByLabel(/Vault passphrase/).fill("another phrase");
  await page.getByLabel("Type the passphrase again").fill("another phrase");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/isn't the vault passphrase you used before/)).toBeVisible();
});

test("habits: create one and check in today", async ({ page }) => {
  await page.goto("/habits");
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: /Walk 30 minutes/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: /Walk 30 minutes: mark done today/ }).click();
  await expect(page.getByText(/🔥 1-day streak/)).toBeVisible();
  await expect(page.getByText("1 of 1 done today")).toBeVisible();
});

test("diet: log an Indian dish and see today's totals", async ({ page }) => {
  await page.goto("/diet");
  await page.getByPlaceholder(/Search: roti/).fill("masala dosa");
  await page.getByRole("button", { name: "+1" }).first().click();
  await expect(page.getByText("330 / ")).toBeVisible();
  await page.getByRole("button", { name: "7-day plan" }).click();
  await expect(page.getByText(/kcal · \d+ g protein/).first()).toBeVisible();
  await page.getByRole("button", { name: "Shopping list" }).click();
  await expect(page.getByText("About this week")).toBeVisible();
});

// A tiny real PDF with statement lines (Helvetica text, one line each).
function statementPdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 10 Tf 40 800 Td 14 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join("\n")}\nET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test("statement import reads a PDF on the phone and imports the ticked rows", async ({ page }) => {
  await page.goto("/import");
  const pdf = statementPdf([
    "Date Narration Value Dt Withdrawal Deposit Balance",
    "01/11/26 UPI-ZOMATO-ORDER 01/11/26 450.00 49,550.00",
    "02/11/26 NEFT SALARY ACME 02/11/26 75,000.00 1,24,550.00",
  ]);
  await page.locator('input[type="file"]').setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText("UPI-ZOMATO-ORDER")).toBeVisible();
  await expect(page.getByText("NEFT SALARY ACME")).toBeVisible();
  await expect(page.getByText("+₹75,000")).toBeVisible();
  await page.getByRole("button", { name: /Import 2 rows/ }).click();
  await expect(page.getByText(/1 expense and 1 money-in added/)).toBeVisible();
});

test("goals and grocery list", async ({ page }) => {
  await page.goto("/goals");
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: /Anything else/ }).click();
  await page.getByPlaceholder(/Read 12 books/).fill("Read 12 books");
  await page.getByLabel(/^Target/).fill("12");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: /^\+1/ }).click();
  await expect(page.getByText(/^1 of 12/)).toBeVisible();

  await page.goto("/household");
  await page.getByRole("button", { name: /Grocery/ }).click();
  await page.getByPlaceholder("Add: milk, 2 L").fill("Milk, 2 L");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Milk")).toBeVisible();
  await page.getByRole("checkbox", { name: "Bought Milk" }).check();
  await expect(page.getByRole("button", { name: "Clear bought" })).toBeVisible();
});

test("movie corner: import, rank, stub, and the settings group", async ({ page }) => {
  await page.goto("/movie-corner");
  await page.getByRole("tab", { name: /Import/ }).click();
  const csv = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-01-03,Alpha,2020,x,4,,,2026-01-02\n2026-01-04,Beta,2021,y,4,,,2026-01-03\n";
  await page.locator('input[type="file"]').setInputFiles({ name: "diary.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import 2 films" }).click();
  await expect(page.getByText("Added 2.")).toBeVisible();

  await page.getByRole("tab", { name: /Ranking/ }).click();
  await page.getByRole("button", { name: "Beta was better" }).click();
  await expect(page.getByText("1 match played")).toBeVisible();
  await expect(page.getByRole("listitem").first()).toContainText("Beta");

  await page.getByRole("tab", { name: /Stubs/ }).click();
  await page.getByRole("button", { name: "Add stub" }).click();
  await page.getByLabel("Stub movie").fill("Alpha");
  await page.getByLabel("Seat", { exact: true }).fill("H12");
  await page.locator('input[type="file"]').setInputFiles({ name: "t.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await expect(page.getByText("Photo added ✓")).toBeVisible();
  await page.getByRole("button", { name: "Save stub" }).click();
  await expect(page.getByRole("img", { name: "Ticket for Alpha" })).toBeVisible();

  await page.goto("/movies?tab=stats");
  await expect(page.getByText(/2 in 2026/)).toBeVisible();
  await page.getByRole("button", { name: "Compare a pass" }).click();
  await page.getByLabel("Pass name").fill("Test pass");
  await page.getByLabel("Price a month").fill("400");
  await page.getByLabel("Tickets a month").fill("4");
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByText(/No theatre visits it would cover/)).toBeVisible();

  await page.goto("/movies?tab=discover");
  await page.getByRole("button", { name: "Find films" }).click();
  await expect(page.getByText(/needs the TMDB key/)).toBeVisible(); // no key in tests

  // The sources list has its own group, not hidden inside Backup.
  await page.goto("/settings");
  await page.getByText("🎬 Movie data sources").click();
  await expect(page.getByText("Wikipedia + Wikidata")).toBeVisible();
});

test("language: Telugu labels on the bottom bar and Me", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("🎨 Appearance").click();
  await page.getByRole("button", { name: "తెలుగు" }).click();
  await page.goto("/me");
  await expect(page.getByRole("navigation", { name: "Main" }).getByText("హోమ్")).toBeVisible();
  await expect(page.getByText("అలవాట్లు")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("app_lang", "en"));
});

test("emergency card shows on the lock screen without the PIN", async ({ page }) => {
  await page.goto("/medical");
  await page.getByRole("button", { name: /Emergency card/ }).click();
  await page.getByLabel("Name").fill("Sai");
  await page.getByLabel("Blood group").fill("O+");
  await page.getByLabel("Emergency contact").fill("Amma");
  await page.getByLabel("Their phone").first().fill("9876543210");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Emergency card saved/)).toBeVisible();

  // Lock the app with a PIN, then come back.
  await page.evaluate(async () => {
    await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "set-pin", pin: "1234" }) });
    await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "logout" }) });
    localStorage.removeItem("unlock_session_v1");
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByText("Enter your PIN")).toBeVisible();
  await page.getByRole("button", { name: /Emergency info/ }).click();
  await expect(page.getByRole("dialog", { name: "Emergency information" })).toBeVisible();
  await expect(page.getByText("O+")).toBeVisible();
  await expect(page.getByText("📞 9876543210")).toBeVisible();
});
