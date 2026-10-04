import { expect, test, type Page } from "@playwright/test";
import { apiLogin, sql, uiLogin } from "./helpers";

const input = (page: Page, label: string) => page.locator(`label:text-is("${label}") + input`);

/** A fresh approved member, signed in on `page`. */
async function freshUser(page: Page) {
  const id = Date.now().toString(36);
  const user = { username: `set_${id}`, email: `set_${id}@lab.test`, name: `Settings ${id}`, password: "Password123" };
  const response = await page.request.post("/api/auth/signup", { data: user });
  expect(response.status()).toBe(201);
  sql(`UPDATE users SET status='active' WHERE username='${user.username}'`);
  return user;
}

test.describe("settings", () => {
  test("profile shows current values; edit name updates header; validation", async ({ page }) => {
    const user = await freshUser(page);
    await page.goto("/settings");
    await expect(input(page, "Full name")).toHaveValue(user.name);
    await expect(input(page, "Username")).toHaveValue(user.username);
    await expect(input(page, "Email address")).toHaveValue(user.email);

    await input(page, "Email address").fill("me@localhost"); // passes the native type=email check, fails the app rule
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await input(page, "Email address").fill(user.email);

    await input(page, "Username").fill("member");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("This username is already taken")).toBeVisible();
    await input(page, "Username").fill(user.username);

    await input(page, "Full name").fill("Renamed Person");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Profile updated")).toBeVisible();
    await expect(page.locator("header").getByText("Renamed Person")).toBeVisible();
    await page.reload();
    await expect(input(page, "Full name")).toHaveValue("Renamed Person");
  });

  test("password change: validation, wrong current password, success signs out other sessions", async ({ page, browser }) => {
    const user = await freshUser(page);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await apiLogin(otherPage.request, { identifier: user.username, password: user.password });

    await page.goto("/settings");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("Current password is required")).toBeVisible();
    await expect(page.getByText("New password is required")).toBeVisible();

    await input(page, "Current password").fill("WrongPassword1");
    await input(page, "New password").fill("NewPassword123");
    await input(page, "Confirm new password").fill("NewPassword124");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();

    await input(page, "Confirm new password").fill("NewPassword123");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("Current password is incorrect")).toBeVisible();

    await input(page, "Current password").fill(user.password);
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("Password changed. Other devices have been signed out.")).toBeVisible();
    await expect(input(page, "Current password")).toHaveValue("");

    expect((await otherPage.request.get("/api/auth/me")).status()).toBe(401);
    expect((await page.request.get("/api/auth/me")).status()).toBe(200);
    await other.close();

    await page.context().clearCookies();
    await uiLogin(page, user.username, "NewPassword123");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("avatar: rejects non-images; preview is local only (lost on reload)", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "UX", description: "'Change Photo' only previews locally; nothing is saved (the page says so in small print)" });
    await freshUser(page);
    await page.goto("/settings");
    const file = page.locator('input[type="file"]');
    await file.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByText("Please select an image file")).toBeVisible();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await file.setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("img", { name: "Profile preview" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("img", { name: "Profile preview" })).toHaveCount(0);
  });
});
