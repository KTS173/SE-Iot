import { expect, test } from "@playwright/test";
import { apiLogin, bug, shot, watchProblems } from "./helpers";

// The signed-out check of /api/auth/me is a 401 by design; Chrome logs it.
const SIGNED_OUT_NOISE = [/HTTP 401 GET .*\/api\/auth\/me/, /status of 401 \(Unauthorized\)/];

test.describe("console errors and failed requests", () => {
  for (const role of ["admin", "member"] as const) {
    test(`no console errors or failed requests on any page (${role})`, async ({ page }) => {
      await apiLogin(page.request, role);
      const problems = watchProblems(page);
      const pages = role === "admin"
        ? ["/dashboard", "/sensors", "/members", "/line-log", "/settings"]
        : ["/dashboard", "/line-log", "/settings"];
      for (const path of pages) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await page.waitForLoadState("networkidle");
        if (path === "/dashboard") {
          for (const preset of ["1H", "6H", "1D", "30D", "7D"]) await page.getByRole("button", { name: preset, exact: true }).click();
          await page.getByRole("button", { name: /^Bench A/ }).click();
        }
        if (path === "/line-log") {
          for (const chip of ["Today", "7D", "failed", "all"]) await page.getByRole("button", { name: chip, exact: true }).click();
          await page.getByRole("button", { name: "Pick dates" }).click();
          await page.keyboard.press("Escape");
        }
        await page.waitForTimeout(1000);
      }
      expect(problems.pageErrors, "uncaught exceptions").toEqual([]);
      expect(problems.consoleErrors, "console errors").toEqual([]);
      expect(problems.failedRequests, "failed requests").toEqual([]);
    });
  }

  test("signed-out pages only show the expected /api/auth/me 401", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "NOISE", description: "Every signed-out page load logs 'Failed to load resource: 401' for /api/auth/me in the console" });
    const problems = watchProblems(page, SIGNED_OUT_NOISE);
    for (const path of ["/signin", "/signup"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.failedRequests).toEqual([]);
  });

  test("a backend outage keeps the dashboard up and marks sensors offline", async ({ page }) => {
    await apiLogin(page.request, "member");
    const problems = watchProblems(page, [/api\/devices/, /api\/sensors\/chart/, /Failed to load resource/]);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /^Bench A/ })).toContainText("Online");
    await page.route("**/api/devices", (route) => route.abort("connectionrefused"));
    await expect(page.getByRole("button", { name: /^Bench A/ })).toContainText("Offline", { timeout: 12_000 });
    await expect(page.getByRole("button", { name: /^Bench A/ })).toContainText("--°C");
    expect(problems.pageErrors).toEqual([]);
    await page.unroute("**/api/devices");
    await expect(page.getByRole("button", { name: /^Bench A/ })).toContainText("Online", { timeout: 12_000 });
  });

  test("BUG: unknown URL shows TanStack's bare 'Not Found' with no way back", async ({ page }, testInfo) => {
    bug(testInfo, "No notFoundComponent: /does-not-exist renders an unstyled 'Not Found' paragraph, no navigation, and logs a router warning");
    test.fail();
    await apiLogin(page.request, "member");
    const warnings: string[] = [];
    page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
    await page.goto("/does-not-exist");
    await expect(page.getByText("Not Found")).toBeVisible();
    await shot(page, "bug-404-bare-not-found");
    expect(warnings.join("\n")).not.toContain("notFoundComponent");
    await expect(page.getByRole("link", { name: /dashboard|home|back/i })).toBeVisible({ timeout: 2000 });
  });
});
