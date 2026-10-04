import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Isolated stack: seeded SQLite backend on 5011, Vite dev server on 5199 with a
// same-origin /api proxy (like nginx in production). Neither touches the Pi.
const apiPort = process.env.E2E_API_PORT ?? "5011";
const webPort = process.env.E2E_WEB_PORT ?? "5199";
const baseURL = `http://localhost:${webPort}`;
process.env.E2E_DB_PATH ??= path.join(os.tmpdir(), "se-iot-e2e", "sensor_e2e.db");
process.env.E2E_API_PORT = apiPort;
process.env.E2E_WEB_PORT = webPort;

export default defineConfig({
  testDir: "./e2e",
  // One shared database: run serially so specs never race on the same rows.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: "../output/playwright-artifacts",
  reporter: [["list"], ["html", { outputFolder: "../output/playwright-report", open: "never" }]],
  use: {
    baseURL,
    // The lab is in Thailand; the backend formats LINE times in Asia/Bangkok.
    timezoneId: "Asia/Bangkok",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: [
    {
      command: "bash e2e/backend/start.sh",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !!process.env.E2E_REUSE,
      stdout: "pipe",
      stderr: "pipe",
      env: { E2E_WEB_ORIGIN: baseURL },
    },
    {
      command: "npx vite --config e2e/vite.e2e.config.ts",
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: !!process.env.E2E_REUSE,
    },
  ],
});
