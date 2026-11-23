// Browser tests: `npm run e2e`. Starts the app on an in-memory database
// (see next.config.mjs) and drives Chromium at phone size.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /\.e2e\.mjs$/,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3123",
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    // A production build (like Vercel), into its own folder so it never
    // mixes with a normal build.
    command: "npx next build && npx next start -p 3123",
    url: "http://localhost:3123",
    timeout: 420_000,
    reuseExistingServer: false,
    env: { E2E_PGLITE: "1", NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: "postgres://e2e", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
