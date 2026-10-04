import { expect, test, type Page } from "@playwright/test";
import { apiLogin, bug, shot, sql } from "./helpers";

const modal = (page: Page) => page.getByRole("dialog");
/** Inputs in the sensor form are not label-associated, so find them by label text + following input. */
const field = (page: Page, label: string) =>
  modal(page).locator(`label:text-is("${label}") + input`);
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

async function openAdd(page: Page) {
  await page.getByRole("button", { name: "Add Sensor" }).click();
  await expect(modal(page).getByRole("heading", { name: "Add Sensor" })).toBeVisible();
}

test.describe("sensors management (admin)", () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page.request, "admin");
    await page.goto("/sensors");
    await expect(page.getByText(/\d+ sensors in this environment/)).toBeVisible();
  });

  test("lists seeded sensors with status and alert ranges", async ({ page }) => {
    await expect(row(page, "Bench A")).toContainText("Online");
    await expect(row(page, "Bench A")).toContainText("18–30 °C");
    await expect(row(page, "Cold Room")).toContainText("Offline");
    await expect(row(page, "Cold Room")).toContainText("-- °C");
  });

  test("add form validation", async ({ page }) => {
    await openAdd(page);
    await field(page, "Sensor name").fill("");
    await modal(page).getByRole("button", { name: "Save Sensor" }).click();
    await expect(modal(page).getByText("Sensor name is required")).toBeVisible();
    await expect(modal(page).getByText("Sensor ID is required")).toBeVisible();
    await expect(modal(page).getByText("Location is required")).toBeVisible();
    await field(page, "Sensor ID").fill("001");
    await field(page, "Minimum temperature (°C)").fill("40");
    await modal(page).getByRole("button", { name: "Save Sensor" }).click();
    await expect(modal(page).getByText("This Sensor ID already exists")).toBeVisible();
    await expect(modal(page).getByText("Minimum temperature cannot exceed maximum")).toBeVisible();
    await field(page, "Sensor ID").fill("bad id!");
    await modal(page).getByRole("button", { name: "Save Sensor" }).click();
    await expect(modal(page).getByText(/may only contain letters/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
  });

  test("add, edit, then delete a sensor; deleted sensor does not reappear", async ({ page }) => {
    const id = `e2e${Date.now().toString().slice(-6)}`;
    await openAdd(page);
    await field(page, "Sensor name").fill("E2E Fridge");
    await field(page, "Sensor ID").fill(id);
    await field(page, "Location").fill("Corner");
    await field(page, "Maximum humidity (%RH)").fill("70");
    // Click on the floor plan to set the position.
    const plan = modal(page).getByRole("application");
    const box = (await plan.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await expect(modal(page).getByText("25%, 50%")).toBeVisible();
    await modal(page).getByRole("button", { name: "Save Sensor" }).click();
    await expect(page.getByText("Sensor saved")).toBeVisible();
    await expect(row(page, "E2E Fridge")).toContainText("35–70 %RH");
    expect(sql(`SELECT x || ',' || y FROM sensor_config WHERE device_id='${id}'`)).toBe("25.0,50.0");

    await row(page, "E2E Fridge").getByRole("button", { name: "Edit" }).click();
    await expect(modal(page).getByRole("heading", { name: "Edit Sensor" })).toBeVisible();
    await field(page, "Location").fill("Window");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Sensor updated")).toBeVisible();
    await expect(row(page, "E2E Fridge")).toContainText("Window");

    // Cancel keeps it.
    await row(page, "E2E Fridge").getByRole("button", { name: "Delete" }).click();
    await modal(page).getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, "E2E Fridge")).toBeVisible();
    await row(page, "E2E Fridge").getByRole("button", { name: "Delete" }).click();
    await modal(page).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Sensor settings removed. Stored readings were kept.")).toBeVisible();
    await expect(row(page, "E2E Fridge")).toHaveCount(0);

    // Not back after several polls, a reload, or on the dashboard.
    await page.waitForTimeout(6000);
    await expect(row(page, "E2E Fridge")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/\d+ sensors in this environment/)).toBeVisible();
    await expect(row(page, "E2E Fridge")).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page.getByText("E2E Fridge")).toHaveCount(0);
  });

  test("deleting a sensor that has readings: it stays gone (no reappearing from old data)", async ({ page }) => {
    // A reporting device with history, like the seeded ones.
    const id = `hist${Date.now().toString().slice(-6)}`;
    sql(`INSERT INTO sensor_readings (device_id, temperature, humidity, received_at) VALUES ('${id}', 22, 50, strftime('%Y-%m-%dT%H:%M:%S+00:00','now','-1 hour'))`);
    await page.reload();
    await expect(row(page, `Sensor ${id}`)).toBeVisible({ timeout: 8000 });
    await row(page, `Sensor ${id}`).getByRole("button", { name: "Delete" }).click();
    await modal(page).getByRole("button", { name: "Delete" }).click();
    await expect(row(page, `Sensor ${id}`)).toHaveCount(0);
    await page.waitForTimeout(6000);
    await page.reload();
    await expect(page.getByText(/\d+ sensors in this environment/)).toBeVisible();
    await expect(row(page, `Sensor ${id}`)).toHaveCount(0);
  });

  test("BUG: ID column shows an invented number for non-numeric device IDs", async ({ page }, testInfo) => {
    bug(testInfo, "Device 'sensor-01' is shown as ID '1003' (chartId fallback 1000+index) on Sensors page and floor plan");
    test.fail();
    const r = row(page, "Sensor sensor-01");
    await shot(page, "bug-sensor-id-column-1003");
    await expect(r.getByRole("cell").nth(1)).toHaveText("sensor-01", { timeout: 3000 });
  });

  test("BUG: a sensor whose MQTT device ID contains '-' cannot be edited", async ({ page }, testInfo) => {
    bug(testInfo, "Edit form validates Sensor ID with /^\\w+$/; IDs from topics like sensors/sensor-01/data are rejected, so the sensor can never be configured");
    test.fail();
    await row(page, "Sensor sensor-01").getByRole("button", { name: "Edit" }).click();
    await field(page, "Sensor name").fill("Freezer probe");
    await field(page, "Location").fill("Freezer");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(500);
    await shot(page, "bug-edit-dash-id-rejected");
    await expect(modal(page).getByText(/may only contain letters/)).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByText("Sensor updated")).toBeVisible({ timeout: 3000 });
  });

  test("BUG: changing the Sensor ID in Edit creates a duplicate instead of renaming", async ({ page }, testInfo) => {
    bug(testInfo, "Edit keeps the Sensor ID input editable; Save PUTs to the new ID and leaves the old sensor in place");
    test.fail();
    const id = `ren${Date.now().toString().slice(-6)}`;
    sql(`INSERT INTO sensor_config (device_id, name, location) VALUES ('${id}', 'Rename Me ${id}', 'Shelf')`);
    await page.reload();
    await row(page, `Rename Me ${id}`).getByRole("button", { name: "Edit" }).click();
    const idInput = field(page, "Sensor ID");
    try {
      // Either the ID is read-only (good) ...
      if (await idInput.isEditable()) {
        await idInput.fill(`${id}x`);
        await modal(page).getByRole("button", { name: "Save Changes" }).click();
        await expect(page.getByText("Sensor updated")).toBeVisible();
        await shot(page, "bug-edit-id-duplicates-sensor");
        // ... or a rename leaves exactly one sensor.
        await expect(row(page, `Rename Me ${id}`)).toHaveCount(1, { timeout: 3000 });
      }
    } finally {
      sql(`DELETE FROM sensor_config WHERE device_id IN ('${id}', '${id}x')`);
    }
  });
});
