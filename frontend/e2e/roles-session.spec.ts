import { expect, test } from "@playwright/test";
import { apiLogin, sql } from "./helpers";

test.describe("role gating (member)", () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page.request, "member");
  });

  test("member navigation hides admin pages", async ({ page }) => {
    for (const path of ["/dashboard", "/line-log", "/settings"]) {
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await expect(nav.getByRole("link", { name: "LINE Log" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Sensors" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
      const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
      await expect(mobileNav.getByRole("link", { name: "Sensors" })).toHaveCount(0);
    }
  });

  test("direct URL to admin pages redirects to the dashboard", async ({ page }) => {
    for (const path of ["/sensors", "/members"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard$/);
    }
  });

  test("client-side navigation to an admin route is also blocked", async ({ page }) => {
    await page.goto("/dashboard");
    await page.evaluate(() => {
      window.history.pushState({}, "", "/members");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("member does not see 'Send test' on the LINE log", async ({ page }) => {
    await page.goto("/line-log");
    await expect(page.getByRole("heading", { name: "LINE Log" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send test/ })).toHaveCount(0);
  });

  test("backend refuses admin actions from a member even if the UI were bypassed", async ({ page }) => {
    const put = await page.request.put("/api/devices/999", { data: { name: "x", location: "y" } });
    expect(put.status()).toBe(403);
    expect((await page.request.delete("/api/devices/001")).status()).toBe(403);
    expect((await page.request.get("/api/users")).status()).toBe(403);
    // Never actually reached LINE: forbidden before the handler runs.
    expect((await page.request.post("/api/line/test")).status()).toBe(403);
  });
});

test.describe("session expiry / 401 handling", () => {
  test("revoked session on the dashboard returns to /signin on the next poll", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    sql("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username='member')");
    await expect(page).toHaveURL(/\/signin$/, { timeout: 12_000 });
  });

  test("expired session (expires_at in the past) is treated like signed out", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    sql("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00' WHERE user_id = (SELECT id FROM users WHERE username='member')");
    await expect(page).toHaveURL(/\/signin$/, { timeout: 12_000 });
    await page.goto("/line-log");
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("401 on a page without polling (Members) redirects on the next action", async ({ page }) => {
    await apiLogin(page.request, "admin");
    await page.goto("/members");
    const someone = page.getByRole("row").filter({ hasText: "@member" });
    await expect(someone).toBeVisible();
    // Sign out this browser session server-side only.
    sql("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username='admin')");
    await someone.getByRole("combobox").selectOption("admin");
    await expect(page).toHaveURL(/\/signin$/, { timeout: 8000 });
    // And nothing changed.
    expect(sql("SELECT role FROM users WHERE username='member'")).toBe("member");
  });

  test("signing out in one tab: the other tab follows on its next request", async ({ context }) => {
    const first = await context.newPage();
    await apiLogin(first.request, "member");
    await first.goto("/dashboard");
    const second = await context.newPage();
    await second.goto("/line-log");
    await expect(second.getByRole("heading", { name: "LINE Log" })).toBeVisible();
    await first.getByRole("button").filter({ has: first.locator("svg.lucide-log-out") }).click();
    await expect(first).toHaveURL(/\/signin$/);
    await second.getByRole("button", { name: "Refresh" }).click();
    await expect(second).toHaveURL(/\/signin$/, { timeout: 8000 });
  });
});
