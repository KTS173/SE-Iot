import { expect, test } from "@playwright/test";
import { USERS, apiLogin, bug, shot, sql, uiLogin } from "./helpers";

test.describe("sign in / sign out", () => {
  test("signed-out visitor is sent to /signin from / and every protected page", async ({ page }) => {
    for (const path of ["/", "/dashboard", "/sensors", "/members", "/line-log", "/settings", "/pending"]) {
      await page.goto(path);
      await expect(page, `from ${path}`).toHaveURL(/\/signin$/);
    }
  });

  test("admin signs in with username and lands on the dashboard", async ({ page }) => {
    await uiLogin(page, "admin", USERS.admin.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Welcome back, E2E Admin")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("E2E Admin").first()).toBeVisible();
  });

  test("sign in with email (case-insensitive) works", async ({ page }) => {
    await uiLogin(page, "MEMBER@LAB.TEST", USERS.member.password);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("wrong password shows a generic error and stays on /signin", async ({ page }) => {
    await uiLogin(page, "member", "wrong-password");
    await expect(page.getByText("Invalid username or password")).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  test("empty form is rejected client-side", async ({ page }) => {
    await page.goto("/signin");
    let calls = 0;
    page.on("request", (request) => { if (request.url().includes("/api/auth/login")) calls++; });
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText("Please fill in all fields")).toBeVisible();
    expect(calls).toBe(0);
  });

  test("disabled account cannot sign in", async ({ page }) => {
    await uiLogin(page, "disabled1", USERS.disabled.password);
    await expect(page.getByText("This account has been disabled")).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("Google button is hidden when Google sign-in is not configured", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toHaveCount(0);
  });

  test("Google error query param shows a toast and is removed from the URL", async ({ page }, testInfo) => {
    await page.goto("/signin?error=google_domain");
    await expect(page).toHaveURL(/\/signin$/); // the param is removed...
    await page.waitForTimeout(1500);
    await shot(page, "bug-google-error-toast-missing");
    // ...but the user never learns why Google sign-in failed.
    await expect(page.getByText("This Google account's email domain is not allowed")).toBeVisible({ timeout: 3000 });
  });

  test("signed-in user opening /signin or /signup is sent to the dashboard", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/signin");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("sign out ends the server session; back button does not reveal data", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/line-log");
    await expect(page.getByRole("heading", { name: "LINE Log" })).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByText("Signed out")).toBeVisible();
    // The cookie is gone server-side too.
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await page.goBack();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("'Remember me' off gives a browser-session cookie, on gives a persistent one", async ({ page, context }) => {
    await page.goto("/signin");
    await page.locator("#id").fill("member");
    await page.locator("#pw").fill(USERS.member.password);
    await page.getByRole("checkbox").click(); // default is checked -> uncheck
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    let cookie = (await context.cookies()).find((c) => c.name === "seiot_session");
    expect(cookie?.expires).toBe(-1);
    expect(cookie?.httpOnly).toBe(true);

    await page.goto("about:blank");
    await context.clearCookies();
    await uiLogin(page, "member", USERS.member.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    cookie = (await context.cookies()).find((c) => c.name === "seiot_session");
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 20 * 86400);
  });

  test("signing in again after a session is revoked works without a stale user", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByText("Mary Member").first()).toBeVisible();
    sql("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username='member')");
    await page.reload();
    await expect(page).toHaveURL(/\/signin$/);
    await uiLogin(page, "admin", USERS.admin.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("E2E Admin").first()).toBeVisible();
  });
});
