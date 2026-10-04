import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

/** Seeded accounts (see e2e/backend/seed.py). */
export const USERS = {
  admin: { identifier: "admin", password: "AdminPass123", name: "E2E Admin" },
  member: { identifier: "member", password: "MemberPass123", name: "Mary Member" },
  pending: { identifier: "pending1", password: "PendingPass123", name: "Pat Pending" },
  disabled: { identifier: "disabled1", password: "DisabledPass123", name: "Dan Disabled" },
} as const;
export type SeedUser = keyof typeof USERS;

export const SCREENSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../output/frontend-test-screenshots");

/** Run SQL against the E2E database (never the real one). Returns stdout. */
export function sql(statement: string): string {
  const db = process.env.E2E_DB_PATH;
  if (!db || !db.includes("e2e")) throw new Error(`refusing to touch DB ${db}`);
  return execFileSync("sqlite3", [db, statement], { encoding: "utf8" }).trim();
}

/** Sign in through the API; the cookie lands in the page's browser context. */
export async function apiLogin(request: APIRequestContext, user: SeedUser | { identifier: string; password: string }) {
  const creds = typeof user === "string" ? USERS[user] : user;
  const response = await request.post("/api/auth/login", {
    data: { identifier: creds.identifier, password: creds.password, remember: false },
  });
  expect(response.status(), await response.text()).toBe(200);
}

export async function loginAs(page: Page, user: SeedUser, landing = "/dashboard") {
  await apiLogin(page.request, user);
  await page.goto(landing);
}

/** Sign in through the real form. */
export async function uiLogin(page: Page, identifier: string, password: string) {
  await page.goto("/signin");
  await page.locator("#id").fill(identifier);
  await page.locator("#pw").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

export async function shot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

/** Mark a test as documenting a known bug; it is expected to fail until fixed. */
export function bug(testInfo: TestInfo, description: string) {
  testInfo.annotations.push({ type: "BUG", description });
}

export interface PageProblems {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/**
 * Collect console errors, uncaught exceptions, failed requests and HTTP >= 400
 * responses. `allow` filters out expected noise (e.g. the signed-out /me 401).
 */
export function watchProblems(page: Page, allow: RegExp[] = []): PageProblems {
  const problems: PageProblems = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const allowed = (text: string) => allow.some((pattern) => pattern.test(text));
  page.on("console", (message) => {
    if (message.type() === "error" && !allowed(message.text())) problems.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (!allowed(error.message)) problems.pageErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const text = `${request.method()} ${request.url()} ${request.failure()?.errorText}`;
    // Aborted polls on navigation are normal.
    if (!/ERR_ABORTED|cancelled|NS_BINDING_ABORTED/i.test(text) && !allowed(text)) problems.failedRequests.push(text);
  });
  page.on("response", (response) => {
    const text = `HTTP ${response.status()} ${response.request().method()} ${response.url()}`;
    if (response.status() >= 400 && !allowed(text)) problems.failedRequests.push(text);
  });
  return problems;
}

/** Local yyyy-mm-dd for a date `daysAgo` before today in the browser's zone (Asia/Bangkok). */
export function bangkokDay(daysAgo: number): string {
  const now = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}
