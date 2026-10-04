import { expect, test, type TestInfo } from "@playwright/test";
import { apiLogin } from "./helpers";

/** Accessibility findings: expected to fail until fixed (kept separate from functional bugs). */
function a11y(testInfo: TestInfo, description: string) {
  testInfo.annotations.push({ type: "A11Y", description });
  test.fail();
}

test.describe("accessibility checks", () => {
  test("sign-in and sign-up fields are labelled", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByLabel("Email or Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Remember me" })).toBeVisible();
    await page.goto("/signup");
    for (const label of ["Full Name", "Email", "Username", "Confirm Password"]) await expect(page.getByLabel(label)).toBeVisible();
  });

  test("A11Y: Sensor form inputs are not associated with their labels", async ({ page }, testInfo) => {
    a11y(testInfo, "sensors.tsx FormField renders <Label> without htmlFor and the <Input> has no id/aria-label");
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await page.getByRole("button", { name: "Add Sensor" }).click();
    await expect(page.getByRole("dialog").getByLabel("Sensor name")).toBeVisible({ timeout: 2000 });
  });

  test("A11Y: Settings inputs are not associated with their labels", async ({ page }, testInfo) => {
    a11y(testInfo, "settings.tsx ProfileField renders <Label> without htmlFor");
    await apiLogin(page.request, "member");
    await page.goto("/settings");
    await expect(page.getByLabel("Full name")).toBeVisible({ timeout: 2000 });
  });

  test("A11Y: modal close (X) button has no accessible name", async ({ page }, testInfo) => {
    a11y(testInfo, "modal.tsx: the header X <Button> has only an icon; the backdrop button is labelled 'Close dialog' but the visible X is not");
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await page.getByRole("button", { name: "Add Sensor" }).click();
    const unnamed = await page.getByRole("dialog").locator("button").evaluateAll((buttons) =>
      buttons.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label")).length);
    expect(unnamed).toBe(0);
  });

  test("A11Y: dashboard sign-out button has no accessible name", async ({ page }, testInfo) => {
    a11y(testInfo, "dashboard.tsx header renders its own logout <Button> without aria-label (AppShell's has 'Log out')");
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 2000 });
  });

  test("A11Y: LINE log filter chips do not expose their selected state", async ({ page }, testInfo) => {
    a11y(testInfo, "Status/date chips signal selection by colour only; no aria-pressed / role=radio");
    await apiLogin(page.request, "member");
    await page.goto("/line-log");
    await expect(page.getByRole("button", { name: "all", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  });

  test("A11Y: floor-plan markers have no descriptive name", async ({ page }, testInfo) => {
    a11y(testInfo, "Floor-plan buttons are named '1', '2', '1003' - no sensor name / aria-label");
    await apiLogin(page.request, "member");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Bench B/ })).toHaveCount(2, { timeout: 2000 }); // card + marker
  });
});
