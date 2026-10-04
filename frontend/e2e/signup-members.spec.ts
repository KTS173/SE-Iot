import { expect, test, type Page } from "@playwright/test";
import { USERS, apiLogin, sql, uiLogin } from "./helpers";

const stamp = () => Date.now().toString(36);

async function fillSignup(page: Page, v: { name: string; email: string; username: string; password: string; confirm?: string }) {
  await page.goto("/signup");
  await page.getByLabel("Full Name").fill(v.name);
  await page.getByLabel("Email").fill(v.email);
  await page.getByLabel("Username").fill(v.username);
  await page.getByLabel("Password", { exact: true }).fill(v.password);
  await page.getByLabel("Confirm Password").fill(v.confirm ?? v.password);
  await page.getByRole("button", { name: "Sign Up" }).click();
}

test.describe("sign up and approval", () => {
  test("client-side validation: short password, mismatch, empty", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page.getByText("Please fill in all fields")).toBeVisible();
    await fillSignup(page, { name: "A", email: "a@lab.test", username: "aaa", password: "short" });
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
    await fillSignup(page, { name: "A", email: "a@lab.test", username: "aaa", password: "longenough1", confirm: "different1" });
    await expect(page.getByText("Passwords do not match")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("server validation messages are shown (duplicate username, bad username)", async ({ page }) => {
    await fillSignup(page, { name: "Dup", email: `dup${stamp()}@lab.test`, username: "member", password: "Password123" });
    await expect(page.getByText("This username is already taken")).toBeVisible();
    await fillSignup(page, { name: "Bad", email: `bad${stamp()}@lab.test`, username: "has space", password: "Password123" });
    await expect(page.getByText(/Username must be 3-32/)).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("new account waits on /pending, can't reach app pages, admin approves, user gets in", async ({ page, browser }) => {
    const id = stamp();
    const username = `new_${id}`;
    await fillSignup(page, { name: `Newbie ${id}`, email: `${username}@lab.test`, username, password: "Password123" });
    await expect(page).toHaveURL(/\/pending$/);
    await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
    await expect(page.getByText(`Hi Newbie ${id}`)).toBeVisible();

    for (const path of ["/dashboard", "/line-log", "/settings", "/sensors", "/members", "/signin"]) {
      await page.goto(path);
      await expect(page, `pending user opening ${path}`).toHaveURL(/\/pending$/);
    }
    // The API refuses data too, not just the UI.
    expect((await page.request.get("/api/devices")).status()).toBe(403);
    expect((await page.request.get("/api/notifications")).status()).toBe(403);

    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByText("Still waiting for an admin to approve your account")).toBeVisible();

    // Admin approves in a separate browser context.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await apiLogin(admin.request, "admin");
    await admin.goto("/members");
    const row = admin.getByRole("row").filter({ hasText: `@${username}` });
    await expect(row.getByText("Waiting for approval")).toBeVisible();
    // Pending sign-ups are listed first.
    await expect(admin.getByRole("row").nth(1)).toContainText("Waiting for approval");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText(`Newbie ${id} approved`)).toBeVisible();
    await expect(row.getByText("Active")).toBeVisible();
    await adminContext.close();

    // Still on the waiting screen: "Check again" picks up the approval.
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Your account has been approved")).toBeVisible();
  });

  test("pending user can sign out from the waiting screen", async ({ page }) => {
    await uiLogin(page, "pending1", USERS.pending.password);
    await expect(page).toHaveURL(/\/pending$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);
  });
});

test.describe("members admin", () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page.request, "admin");
  });

  test("lists accounts with counts; own row cannot be changed", async ({ page }) => {
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ account\(s\)/)).toBeVisible();
    await expect(page.getByText(/waiting for approval/).first()).toBeVisible();
    const me = page.getByRole("row").filter({ hasText: "(you)" });
    await expect(me.getByRole("combobox")).toBeDisabled();
    await expect(me.getByRole("button")).toHaveCount(0);
  });

  test("promote member to admin and back; role change is persisted", async ({ page }) => {
    const id = stamp();
    sql(`INSERT INTO users (name, username, email, password_hash, role, status, created_at) VALUES ('Role Test ${id}', 'role_${id}', 'role_${id}@lab.test', '!', 'member', 'active', '2026-01-01T00:00:00+00:00')`);
    await page.goto("/members");
    const row = page.getByRole("row").filter({ hasText: `@role_${id}` });
    await row.getByRole("combobox").selectOption("admin");
    await expect(page.getByText("Role updated")).toBeVisible();
    await page.reload();
    await expect(row.getByRole("combobox")).toHaveValue("admin");
    await row.getByRole("combobox").selectOption("member");
    await expect(row.getByRole("combobox")).toHaveValue("member");
  });

  test("disabling a signed-in member kicks them out on their next request; re-enable restores access", async ({ page, browser }) => {
    const id = stamp();
    const username = `kick_${id}`;
    const signup = await page.request.post("/api/auth/signup", {
      data: { name: `Kick ${id}`, username, email: `${username}@lab.test`, password: "Password123" },
    });
    expect(signup.status()).toBe(201);
    // signup switched this context's cookie to the new user; sign the admin back in.
    await apiLogin(page.request, "admin");
    await page.goto("/members");
    const row = page.getByRole("row").filter({ hasText: `@${username}` });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByText("Active")).toBeVisible();

    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await apiLogin(member.request, { identifier: username, password: "Password123" });
    await member.goto("/dashboard");
    await expect(member.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("Disabled")).toBeVisible();
    // The dashboard polls /api/devices every 5 s; the 401 must send them to /signin.
    await expect(member).toHaveURL(/\/signin$/, { timeout: 12_000 });
    await uiLogin(member, username, "Password123");
    await expect(member.getByText("This account has been disabled")).toBeVisible();

    await row.getByRole("button", { name: "Enable" }).click();
    await expect(row.getByText("Active")).toBeVisible();
    await uiLogin(member, username, "Password123");
    await expect(member).toHaveURL(/\/dashboard$/);
    await memberContext.close();
  });

  test("reject a pending sign-up removes it after confirmation; cancel keeps it", async ({ page }) => {
    const id = stamp();
    sql(`INSERT INTO users (name, username, email, password_hash, role, status, created_at) VALUES ('Reject ${id}', 'rej_${id}', 'rej_${id}@lab.test', '!', 'member', 'pending', '2026-01-01T00:00:00+00:00')`);
    await page.goto("/members");
    const row = page.getByRole("row").filter({ hasText: `@rej_${id}` });
    await row.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Reject Sign-up")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Reject" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Member removed")).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(`@rej_${id}`)).toHaveCount(0);
  });
});
