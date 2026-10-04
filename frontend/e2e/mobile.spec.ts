import { expect, test, type Page } from "@playwright/test";
import { apiLogin, bug, shot } from "./helpers";

// Runs in the "mobile" project only: iPhone 13 (WebKit) at 375 px wide.

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement!;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // Ignore content inside horizontally scrollable containers (tables).
        let p = el.parentElement;
        while (p) {
          if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return false;
          p = p.parentElement;
        }
        return r.width > 0 && r.right > window.innerWidth + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 120));
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, offenders };
  });
}

test.describe("mobile 375px", () => {
  test("signed-out pages have no horizontal overflow", async ({ page }) => {
    for (const path of ["/signin", "/signup"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const result = await horizontalOverflow(page);
      expect(result.scrollWidth, `${path}: ${result.offenders.join(", ")}`).toBeLessThanOrEqual(result.innerWidth);
    }
  });

  test("every app page fits the width; bottom navigation replaces the sidebar", async ({ page }) => {
    await apiLogin(page.request, "admin");
    for (const path of ["/dashboard", "/sensors", "/members", "/line-log", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const result = await horizontalOverflow(page);
      expect(result.scrollWidth, `${path}: ${result.offenders.join(", ")}`).toBeLessThanOrEqual(result.innerWidth);
      await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
      await shot(page, `mobile${path.replace("/", "-")}`);
    }
  });

  test("bottom navigation works", async ({ page }) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await nav.getByRole("link", { name: "LINE Log" }).click();
    await expect(page).toHaveURL(/\/line-log$/);
    await nav.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(nav.getByRole("link", { name: "Sensors" })).toHaveCount(0);
  });

  test("LINE log date picker and filter chips stay inside the screen", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/line-log");
    await page.getByRole("button", { name: "Pick dates" }).click();
    const popover = page.locator("[data-radix-popper-content-wrapper]");
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 1);
    await expect(page.getByRole("grid")).toHaveCount(1); // one month on a phone
    await page.waitForTimeout(400); // fade-in animation
    testInfo.annotations.push({ type: "measured", description: `calendar popover ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)} (viewport 375x812)` });
    await shot(page, "mobile-line-log-calendar", false);
  });

  test("Add Sensor modal fits and can be scrolled to Save", async ({ page }) => {
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await page.getByRole("button", { name: "Add Sensor" }).click();
    const dialog = page.getByRole("dialog").locator("> div").last();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "Save Sensor" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Save Sensor" })).toBeInViewport();
  });

  test("dashboard charts are tall enough on phones", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
    const heights = await page.locator(".recharts-wrapper").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    testInfo.annotations.push({ type: "measured", description: `chart heights at 375px: ${heights.join(", ")} px` });
    await page.locator(".recharts-wrapper").first().scrollIntoViewIfNeeded();
    await shot(page, "bug-mobile-charts-squashed");
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(140);
  });
});
