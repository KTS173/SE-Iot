import { expect, test, type Page, type Request } from "@playwright/test";
import { apiLogin, bug, shot, sql } from "./helpers";

const card = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).filter({ hasText: /°C/ });

function chartRequest(page: Page, trigger: () => Promise<unknown>): Promise<URL> {
  const waiter = page.waitForRequest((r: Request) => r.url().includes("/api/sensors/chart"));
  return trigger().then(() => waiter).then((r) => new URL(r.url()));
}

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page.request, "member");
  });

  test("shows sensors, live status, summary and both charts", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("4 devices connected")).toBeVisible();
    await expect(card(page, "Bench A")).toContainText("Online");
    await expect(card(page, "Cold Room")).toContainText("Offline");
    await expect(card(page, "Cold Room")).toContainText("--°C");
    await expect(page.getByText("Sensors Online")).toBeVisible();
    await expect(page.getByText("75% online")).toBeVisible();
    // Average of the three online sensors: (24.0 + 31.2 + 22.0) / 3 = 25.7
    await expect(page.getByText("25.7")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
    // One line per sensor in each chart.
    await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(4);
  });

  test("range presets request the right window and bucket", async ({ page }) => {
    const first = await chartRequest(page, () => page.goto("/dashboard"));
    const span = (u: URL) => (Date.parse(u.searchParams.get("to")!) - Date.parse(u.searchParams.get("from")!)) / 3_600_000;
    // Default is 7D, day buckets, from local midnight six days ago.
    expect(first.searchParams.get("bucket")).toBe("86400");
    expect(first.searchParams.get("offset")).toBe("25200"); // Asia/Bangkok
    expect(new Date(first.searchParams.get("from")!).toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok" })).toBe("00:00:00");

    const cases: [string, number, number, string][] = [
      ["1H", 1, 1, "60"],
      ["6H", 6, 6, "60"],
      ["30D", 29 * 24, 30 * 24, "86400"],
    ];
    for (const [label, min, max, bucket] of cases) {
      // Wait for the request of the new range (an older poll may be in flight).
      const waiter = page.waitForRequest((r) => {
        if (!r.url().includes("/api/sensors/chart")) return false;
        const s = span(new URL(r.url()));
        return s >= min - 0.01 && s <= max + 0.01;
      });
      await page.getByRole("button", { name: label, exact: true }).click();
      const url = new URL((await waiter).url());
      expect(url.searchParams.get("bucket"), label).toBe(bucket);
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveClass(/bg-blue-600/);
    }
    const dayWaiter = page.waitForRequest((r) => r.url().includes("/api/sensors/chart") && span(new URL(r.url())) <= 24);
    await page.getByRole("button", { name: "1D", exact: true }).click();
    const day = new URL((await dayWaiter).url());
    expect(new Date(day.searchParams.get("from")!).toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok" })).toBe("00:00:00");
    await expect(page.getByText(/All sensors · \d+ \w+ · 00:00 – \d\d:\d\d/)).toBeVisible();
    await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(4);
  });

  test("custom range from the calendar", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Custom" }).click();
    const grid = page.getByRole("grid").first(); // current month
    await grid.locator('button[name="day"]:not(.day-outside)').filter({ hasText: /^1$/ }).click();
    const url = await chartRequest(page, () =>
      grid.locator('button[name="day"]:not(.day-outside)').filter({ hasText: /^3$/ }).click(),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Custom" })).toHaveClass(/bg-blue-600/);
    const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
    expect(fmt(url.searchParams.get("from")!)).toMatch(/^01\/\d\d\/\d{4}, 00:00:00$/);
    expect(fmt(url.searchParams.get("to")!)).toMatch(/^03\/\d\d\/\d{4}, 23:59:59$/);
    await expect(page.getByText(/All sensors · 1 \w+ – 3 \w+ \d{4}/)).toBeVisible();
  });

  test("focus one sensor from the list and from the floor plan, then show all", async ({ page }) => {
    await page.goto("/dashboard");
    await card(page, "Bench A").click();
    await expect(card(page, "Bench A")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("North bench · ID 001")).toBeVisible();
    await expect(page.getByText(/Bench A · \d+ \w+ –/)).toBeVisible();
    await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(1);
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(4);

    // Floor-plan marker "2" is Bench B.
    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(page.getByText("South bench · ID 002")).toBeVisible();
    await expect(card(page, "Bench B")).toHaveAttribute("aria-pressed", "true");
    await card(page, "Bench B").click(); // toggles back
    await expect(page.getByRole("button", { name: "Show all" })).toHaveCount(0);
  });

  test("alert lines toggle is remembered after reload", async ({ page }) => {
    await page.goto("/dashboard");
    const legend = page.getByText("- - - Alert below 18°C / above 30°C");
    await expect(legend).toBeVisible();
    await expect(page.locator(".recharts-reference-line")).not.toHaveCount(0);
    await page.getByRole("button", { name: "Alert lines" }).click();
    await expect(legend).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Alert lines" })).toHaveAttribute("aria-pressed", "false");
    await expect(legend).toHaveCount(0);
    await page.getByRole("button", { name: "Alert lines" }).click();
    await expect(legend).toBeVisible();
  });

  test("chart scale: validation, save, persists, clear back to automatic", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Scale" }).first().click();
    const min = page.getByLabel("Temperature axis minimum");
    const max = page.getByLabel("Temperature axis maximum");
    await min.fill("30");
    await max.fill("10");
    await expect(page.getByText("Min must be lower than max")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await max.fill("");
    await expect(page.getByText("Fill in both values")).toBeVisible();
    await max.fill("40");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Temperature chart scale saved")).toBeVisible();
    await page.reload();
    await expect(page.locator(".recharts-wrapper").first().getByText("40°C")).toBeVisible();
    await page.getByRole("button", { name: "Scale" }).first().click();
    await expect(page.getByLabel("Temperature axis minimum")).toHaveValue("30");
    await page.getByLabel("Temperature axis minimum").fill("");
    await page.getByLabel("Temperature axis maximum").fill("");
    await page.getByRole("button", { name: "Save" }).click();
    expect(await page.evaluate(() => localStorage.getItem("dashboard-chart-range-temperature"))).toBeNull();
  });

  test("BUG: average temperature shows 0.0 °C when no sensor is online", async ({ page }, testInfo) => {
    bug(testInfo, "Summary shows 'Average Temperature 0.0 °C / Humidity 0 %RH' when every sensor is offline instead of '--'");
    test.fail();
    // Same roster, but every device stopped reporting.
    await page.route("**/api/devices", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const row of body.data) row.online = false;
      await route.fulfill({ status: 200, json: body });
    });
    await page.goto("/dashboard");
    await expect(page.getByText("0% online")).toBeVisible();
    const avg = page.getByText("Average Temperature").locator("..");
    await shot(page, "bug-average-zero-when-offline");
    await expect(avg).not.toContainText("0.0");
  });

  test("sensor above its alert limit is flagged in the sensor list", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    const benchB = card(page, "Bench B");
    await expect(benchB).toContainText("31.2°C");
    await shot(page, "bug-out-of-range-not-flagged");
    // Any visual cue: warning colour, icon or text.
    await expect(benchB.locator(".text-amber-500, .text-red-500, .text-red-600, .bg-amber-50, [class*='amber']")).not.toHaveCount(0, { timeout: 3000 });
  });

  test("BUG: focused non-numeric sensor is lost (charts go blank) when another sensor is added", async ({ page }, testInfo) => {
    bug(testInfo, "chartId() gives non-numeric devices id 1000+index; a roster change shifts the index so selectedId points at nothing");
    test.fail();
    await page.goto("/dashboard");
    await card(page, "Sensor sensor-01").click();
    await expect(page.getByText("Unassigned · ID sensor-01")).toBeVisible();
    await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(1);
    // An admin registers a new sensor that sorts before "sensor-01".
    sql("INSERT OR REPLACE INTO sensor_config (device_id, name, location) VALUES ('004', 'E2E Focus Shift', 'Door')");
    try {
      await expect(page.getByText("5 devices connected")).toBeVisible({ timeout: 12_000 });
      await shot(page, "bug-focus-lost-after-roster-change");
      await expect(page.getByText("Unassigned · ID sensor-01")).toBeVisible({ timeout: 3000 });
      await expect(page.locator(".recharts-wrapper").first().locator(".recharts-line")).toHaveCount(1, { timeout: 3000 });
    } finally {
      sql("DELETE FROM sensor_config WHERE device_id = '004'");
    }
  });

  test("UX: custom range calendar lets you pick future dates", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "UX", description: "Dashboard Custom calendar has no disabled={{after: today}} (the LINE log one does)" });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Custom" }).click();
    const nextMonth = page.getByRole("grid").nth(1);
    await expect(nextMonth.locator('button[name="day"]:not(.day-outside)').first()).toBeEnabled();
  });
});
