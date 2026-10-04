import { expect, test } from "@playwright/test";
import { apiLogin } from "./helpers";

test.describe("accessibility checks", () => {
  test("sign-in and sign-up fields are labelled", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByLabel("Email or Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Remember me" })).toBeVisible();
    await page.goto("/signup");
    for (const label of ["Full Name", "Email", "Username", "Confirm Password"]) await expect(page.getByLabel(label)).toBeVisible();
  });

  test("Sensor form inputs are labelled", async ({ page }, testInfo) => {
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await page.getByRole("button", { name: "Add Sensor" }).click();
    await expect(page.getByRole("dialog").getByLabel("Sensor name")).toBeVisible({ timeout: 2000 });
  });

  test("Settings inputs are labelled", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/settings");
    await expect(page.getByLabel("Full name")).toBeVisible({ timeout: 2000 });
  });

  test("modal close (X) button has an accessible name", async ({ page }, testInfo) => {
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await page.getByRole("button", { name: "Add Sensor" }).click();
    const unnamed = await page.getByRole("dialog").locator("button").evaluateAll((buttons) =>
      buttons.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label")).length);
    expect(unnamed).toBe(0);
  });

  test("dashboard sign-out button has an accessible name", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 2000 });
  });

  test("LINE log filter chips expose their selected state", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/line-log");
    await expect(page.getByRole("button", { name: "all", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  });

  test("floor-plan markers have a descriptive name", async ({ page }, testInfo) => {
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Bench B/ })).toHaveCount(2, { timeout: 2000 }); // card + marker
  });
});
