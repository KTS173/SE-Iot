import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiLogin, bangkokDay, bug, shot, sql } from "./helpers";

// Seeded log (Asia/Bangkok days): today 3 (2 sent + 1 pending), yesterday 2
// (sent + failed), 3 days ago 1 sent, 10 days ago 1 failed, 20 days ago 2
// (sent + skipped), 40 days ago 1 sent. 10 in total.
const countLine = (page: Page) => page.getByText(/^\d+ messages? · /);
const chip = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const tableRows = (page: Page) => page.locator("tbody tr");

function dayLabel(daysAgo: number) {
  const [y, m, d] = bangkokDay(daysAgo).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The day button for `daysAgo` in the open "Pick dates" popover (Sep..Oct style two-month view). */
function dayButton(page: Page, daysAgo: number, firstShownDaysAgo = 30): Locator {
  // First shown month: today - 30 days, or the selected range's start.
  const [ty, tm] = bangkokDay(firstShownDaysAgo).split("-").map(Number);
  const [y, m, d] = bangkokDay(daysAgo).split("-").map(Number);
  const gridIndex = (y - ty) * 12 + (m - tm);
  return page.getByRole("grid").nth(gridIndex).locator('button[name="day"]:not(.day-outside)').filter({ hasText: new RegExp(`^${d}$`) });
}

async function openPicker(page: Page) {
  await page.getByRole("button", { name: /Pick dates|\d{4}/ }).click();
  await expect(page.getByText("Has failed messages")).toBeVisible();
}

test.describe("LINE log", () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/line-log");
    await expect(countLine(page)).toHaveText("10 messages · All dates");
  });

  test("summary cards reflect the delivery log and LINE is not configured", async ({ page }) => {
    await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
    await expect(page.getByText("Nobody has added the bot yet")).toBeVisible();
    const delivered = page.locator("div", { hasText: /^Delivered$/ }).locator("..");
    await expect(delivered.getByText("6", { exact: true })).toBeVisible();
    await expect(page.getByText("2 / 1")).toBeVisible();
    expect((await (await page.request.get("/api/line/status")).json()).data.configured).toBe(false);
  });

  test("QR card: image loads, has alt text, and the add-friend link opens LINE in a new tab", async ({ page }) => {
    const img = page.getByRole("img", { name: "QR code to add the alert bot on LINE" });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const link = page.getByRole("link", { name: "Add friend on LINE" });
    await expect(link).toHaveAttribute("href", "https://line.me/R/ti/p/%40886efqgu");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  });

  test("status filters", async ({ page }) => {
    const expected: [string, number][] = [["sent", 6], ["failed", 2], ["pending", 1], ["skipped", 1], ["all", 10]];
    for (const [name, count] of expected) {
      await chip(page, name).click();
      await expect(countLine(page), name).toHaveText(`${count} message${count === 1 ? "" : "s"} · All dates`);
      await expect(tableRows(page)).toHaveCount(count);
      if (name !== "all") {
        for (const badge of await page.locator("tbody tr td:nth-child(3) span").allTextContents()) {
          expect(badge.toLowerCase()).toBe(name);
        }
      }
    }
    await chip(page, "pending").click();
    await expect(page.getByText(/Next attempt/)).toBeVisible();
  });

  test("date presets, count line, combined with status, and clear", async ({ page }) => {
    await chip(page, "Today").click();
    await expect(countLine(page)).toHaveText(`3 messages · ${dayLabel(0)}`);
    await chip(page, "7D").click();
    await expect(countLine(page)).toHaveText(new RegExp(`^6 messages · .+ – ${dayLabel(0)}$`));
    await chip(page, "failed").click();
    await expect(countLine(page)).toHaveText(/^1 message · /);
    await chip(page, "all").click();
    await chip(page, "30D").click();
    await expect(countLine(page)).toHaveText(/^9 messages · /);
    await page.getByRole("button", { name: "Clear date filter" }).click();
    await expect(countLine(page)).toHaveText("10 messages · All dates");
    await expect(page.getByRole("button", { name: "Clear date filter" })).toHaveCount(0);
    await expect(chip(page, "All dates")).toHaveClass(/bg-blue-600/);
  });

  test("date filter sends local-day bounds to the API", async ({ page }) => {
    const request = page.waitForRequest((r) => r.url().includes("/api/notifications?") && r.url().includes("from="));
    await chip(page, "Today").click();
    const url = new URL((await request).url());
    const local = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour12: false });
    expect(local(url.searchParams.get("from")!)).toMatch(/, 00:00:00$/);
    expect(local(url.searchParams.get("to")!)).toMatch(/, 23:59:59$/);
  });

  test("calendar marks days: red = has failures, green = messages, grey = none; future disabled", async ({ page }) => {
    await openPicker(page);
    await expect(dayButton(page, 1)).toHaveClass(/after:bg-red-500/); // yesterday: a failure
    await expect(dayButton(page, 10)).toHaveClass(/after:bg-red-500/);
    await expect(dayButton(page, 3)).toHaveClass(/after:bg-emerald-500/);
    await expect(dayButton(page, 20)).toHaveClass(/after:bg-emerald-500/); // sent + skipped, no failure
    await expect(dayButton(page, 0)).toHaveClass(/after:bg-emerald-500/); // sent + pending
    await expect(dayButton(page, 2)).toHaveClass(/text-slate-400/);
    await expect(dayButton(page, 2)).not.toHaveClass(/after:bg-/);
    // Tomorrow is disabled (when it is inside the two shown months).
    if (bangkokDay(-1).slice(0, 7) === bangkokDay(0).slice(0, 7)) await expect(dayButton(page, -1)).toBeDisabled();
    await shot(page, "line-log-calendar-dots");
  });

  test("pick a single day, a range, and an empty day", async ({ page }) => {
    await openPicker(page);
    await dayButton(page, 1).click();
    await expect(countLine(page)).toHaveText(`2 messages · ${dayLabel(1)}`);
    await expect(page.getByRole("button", { name: dayLabel(1) })).toHaveClass(/bg-blue-600/);
    await page.keyboard.press("Escape");

    // New range: clear, then from 10 days ago to 3 days ago.
    await page.getByRole("button", { name: "Clear date filter" }).click();
    await openPicker(page);
    await dayButton(page, 10).click();
    await dayButton(page, 3).click();
    await expect(countLine(page)).toHaveText(/^2 messages · /);
    await expect(page.getByText("E2E failed 10 days ago")).toBeVisible();
    await expect(page.getByText("E2E sent 3 days ago")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Clear date filter" }).click();
    await openPicker(page);
    await dayButton(page, 2).click();
    await page.keyboard.press("Escape");
    await expect(countLine(page)).toHaveText(`0 messages · ${dayLabel(2)}`);
    await expect(page.getByText("No LINE messages match these filters")).toBeVisible();
  });

  test("UX: after a preset, clicking a day extends the preset instead of starting a new pick", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "UX", description: "Today preset + click 3 days ago selects 3-days-ago..today (6 msgs), not that single day" });
    await chip(page, "Today").click();
    await openPicker(page);
    await dayButton(page, 3, 0).click(); // the picker now opens on the current month
    await expect(countLine(page)).toHaveText(/^6 messages · /);
  });

  test("UX: filters are not kept in the URL - lost on refresh and on back navigation", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "UX", description: "Status/date filters live in component state only; refresh, back/forward and shared links reset them" });
    await chip(page, "failed").click();
    await chip(page, "7D").click();
    await expect(countLine(page)).toHaveText(/^1 message · /);
    expect(new URL(page.url()).search).toBe("");
    await page.reload();
    await expect(countLine(page)).toHaveText("10 messages · All dates");
    await chip(page, "failed").click();
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Sensor Trends" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/line-log$/);
    await expect(countLine(page)).toHaveText("10 messages · All dates");
  });

  test("empty state does not say 'recorded yet' when filters hide messages", async ({ page }, testInfo) => {
    await chip(page, "skipped").click();
    // Same log without the skipped row.
    await page.route("**/api/notifications?*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data = body.data.filter((row: { status: string }) => row.status !== "skipped");
      await route.fulfill({ status: 200, json: body });
    });
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(countLine(page)).toHaveText("0 messages · All dates");
    await page.waitForTimeout(400);
    await shot(page, "bug-line-log-misleading-empty-state");
    await expect(page.getByText("No LINE messages recorded yet")).toHaveCount(0, { timeout: 2000 });
  });

  test("status filter finds old failures beyond the newest 500 rows", async ({ page }, testInfo) => {
    // 520 newer "sent" rows, e.g. a few weeks of a flapping sensor.
    sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 520)
         INSERT INTO notification_deliveries (alert_id, event_state, channel, dedupe_key, retry_key, message, status, attempts, recipient_count, created_at, delivered_at)
         SELECT 9000+i, 'opened', 'line', 'bulk:'||i, 'bulk-r'||i, 'E2E bulk '||i, 'sent', 1, 2,
                strftime('%Y-%m-%dT%H:%M:%S+00:00','now','-50 days'), strftime('%Y-%m-%dT%H:%M:%S+00:00','now','-50 days') FROM n`);
    try {
      await page.reload();
      await expect(page.getByText("2 / 1")).toBeVisible();
      await expect(countLine(page)).toContainText("500 messages · All dates · showing the newest 500 only"); // 531 exist
      await chip(page, "failed").click();
      await expect(chip(page, "failed")).toHaveClass(/bg-blue-600/);
      await page.waitForTimeout(400); // let the chip colour transition finish
      await shot(page, "bug-line-log-500-cap");
      await expect(countLine(page)).toHaveText("2 messages · All dates", { timeout: 3000 });
    } finally {
      sql("DELETE FROM notification_deliveries WHERE dedupe_key LIKE 'bulk:%'");
    }
  });
});

test("admin sees 'Send test' but LINE is not configured (never clicked)", async ({ page }) => {
  await apiLogin(page.request, "admin");
  await page.goto("/line-log");
  await expect(page.getByRole("button", { name: "Send test" })).toBeVisible();
  await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
});
