// End-to-end flows and WCAG 2.1 AA scans on a running stack with the demo seed (see playwright.config.ts).
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const OWNER = "90 123 45 67";
const CASHIER = "90 123 45 70";
const TEACHER = "90 123 45 71";
const PASSWORD = "demo1234"; // demo seed password (prisma/seed-demo.ts)

async function login(page: Page, phone: string) {
  await page.context().clearCookies(); // no cookies = Uzbek UI, signed out
  await page.goto("/login");
  await page.locator('input[name="phone"]').first().fill(phone);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/**
 * Wait until a streamed page is complete: loading.tsx boundaries stream the page in after the first
 * paint, and <title> arrives with it. Scans and keyboard shortcuts must not run on the skeleton.
 */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => document.title !== "" && !document.querySelector('[hidden][id^="S:"]'));
}

/** Serious and critical WCAG 2.1 A/AA violations fail the test; the list is printed so it can be fixed. */
async function a11y(page: Page, label: string) {
  await settle(page);
  // @axe-core/playwright types against its own playwright-core copy; the runtime object is the same page
  const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n   ")}`).join("\n");
  expect(bad, report).toEqual([]);
}

test.describe("visitor", () => {
  test("landing: the payment demo shows what stays owed and prints a receipt", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("daftarsiz");
    await a11y(page, "landing");
    await page.getByRole("button", { name: "500 000", exact: true }).click();
    await expect(page.getByText("Qarz qoladi: 400 000 so'm")).toBeVisible();
    await page.getByRole("button", { name: "900 000", exact: true }).click();
    await expect(page.getByText("Qarz to'liq yopiladi")).toBeVisible();
    await page.getByRole("button", { name: "Tasdiqlash va chek" }).click();
    await expect(page.getByText("Chek № 139")).toBeVisible();
    await expect(page.getByText("Qarz yo'q")).toBeVisible();
  });

  test("legal pages and the signup page are reachable and accessible", async ({ page }) => {
    await page.context().clearCookies();
    for (const path of ["/legal/offer", "/legal/privacy", "/signup", "/login"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await a11y(page, path);
    }
  });

  test("signup → setup wizard → ready", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/signup");
    const n = String(Date.now()).slice(-7);
    await page.getByLabel("Markaz nomi").fill(`E2E markaz ${n}`);
    await page.getByLabel("Ismingiz").fill("E2E Egasi");
    await page.getByLabel("Telefon raqamingiz").fill(`95${n}`);
    await page.getByLabel("Parol").fill(`e2e-pass-${n}`);
    await page.locator('input[name="consent"]').check();
    await page.waitForTimeout(3_200); // the form refuses submissions faster than a person can type
    await page.getByRole("button", { name: "Markazni yaratish" }).click();
    await page.waitForURL("**/setup**");
    await a11y(page, "setup");
    const step = (name: string) => expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await page.getByRole("button", { name: "Saqlash va davom etish" }).click();
    await step("Birinchi kurs");
    await page.getByPlaceholder("Masalan: General English A1").fill("General English A1");
    await page.getByPlaceholder("600 000").fill("600000");
    await page.getByRole("button", { name: "Saqlash va davom etish" }).click();
    await step("Birinchi guruh");
    await page.getByRole("button", { name: "Saqlash va davom etish" }).click();
    await step("O'qituvchini taklif qilish");
    await page.getByRole("button", { name: "O'tkazib yuborish" }).click();
    await expect(page.getByText("Markaz tayyor")).toBeVisible();
  });

  test("signup without consent is refused", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/signup");
    await page.getByLabel("Markaz nomi").fill("No consent");
    await page.getByLabel("Ismingiz").fill("Test");
    await page.getByLabel("Telefon raqamingiz").fill("95 000 00 01");
    await page.getByLabel("Parol").fill("e2e-pass-0001");
    await page.getByRole("button", { name: "Markazni yaratish" }).click();
    // the browser blocks the required checkbox; the page must not move on
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe("staff", () => {
  test("owner: every main page renders and passes the accessibility scan", async ({ page }) => {
    await login(page, OWNER);
    for (const path of ["/", "/today", "/leads", "/students", "/groups", "/courses", "/payments", "/debtors", "/salary", "/expenses", "/reports", "/audit", "/settings", "/settings/staff"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await a11y(page, path);
    }
    await page.goto("/students");
    await settle(page);
    await page.locator("main table tbody a").first().click();
    await page.waitForURL("**/students/**");
    await a11y(page, "student page");
    await page.goto("/groups");
    await settle(page);
    await page.locator("main table tbody a").first().click();
    await page.waitForURL("**/groups/**");
    await a11y(page, "group page");
  });

  test("owner: the branch switcher keeps showing the branch it switched to", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/");
    await settle(page);
    const select = page.getByRole("combobox", { name: "Filial" });
    const branchId = await select.locator("option", { hasText: "Yunusobod" }).getAttribute("value");
    // the dashboard re-renders for the branch; the select must not jump back to the old option
    const done = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/"));
    await select.selectOption({ label: "Yunusobod" });
    await done;
    await page.waitForLoadState("networkidle");
    await expect(select).toHaveValue(branchId!);
    await page.reload();
    await settle(page);
    await expect(page.getByRole("combobox", { name: "Filial" })).toHaveValue(branchId!);
    // and back to all branches
    const back = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/"));
    await page.getByRole("combobox", { name: "Filial" }).selectOption({ value: "" });
    await back;
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("combobox", { name: "Filial" })).toHaveValue("");
  });

  test("owner: ⌘K finds a student and the payment flow ends on a receipt", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/debtors");
    const familyLink = page.locator('main a[href^="/families/"]').first();
    const href = await familyLink.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(`${href}?pay=1`);
    await page.getByRole("button", { name: "Davom etish" }).click();
    await expect(page.getByText("Tasdiqlang")).toBeVisible();
    await a11y(page, "payment confirm");
    await page.getByRole("button", { name: "Tasdiqlash va chek chiqarish" }).click();
    await page.waitForURL("**/r/**");
    await expect(page.getByText("Chek №")).toBeVisible();
    await expect(page.getByText(/Qolgan qarz|Oldindan to'langan|Qarz yo'q/)).toBeVisible();
    await a11y(page, "receipt");

    await page.goto("/");
    await settle(page);
    const dialog = page.getByRole("dialog");
    // the shortcut listener exists only after hydration; pressing again just reopens the palette
    await expect(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await dialog.getByRole("textbox").fill("Hamidov");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/students/**");
  });

  test("a decimal comma is so'm and tiyin, never a 100× payment (audit B1)", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/debtors");
    await settle(page);
    const href = await page.locator('main a[href^="/families/"]').first().getAttribute("href");
    await page.goto(`${href}?pay=1`);
    await settle(page);
    const amount = page.locator('input[name="amount"]');
    await amount.fill("150 000,00");
    await page.getByRole("button", { name: "Davom etish" }).click();
    await expect(page.getByText("Tasdiqlang")).toBeVisible();
    await expect(page.getByText("150 000 so'm").first()).toBeVisible();
    await expect(page.getByText("15 000 000")).toHaveCount(0);
  });

  test("cashier: can take payments but cannot open reports or settings", async ({ page }) => {
    await login(page, CASHIER);
    await page.goto("/reports");
    await expect(page).toHaveURL(/forbidden|today/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/forbidden|today/);
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible();
  });

  test("owner on a phone: admin pages never scroll sideways (wide tables scroll inside their card)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, OWNER);
    for (const path of ["/", "/today", "/leads", "/students", "/groups", "/payments", "/debtors", "/salary", "/reports", "/settings"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test("teacher on a phone: the teacher pages fit and pass the scan", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, TEACHER);
    await expect(page).toHaveURL(/\/t/);
    for (const path of ["/t", "/t/week", "/t/salary"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
      await a11y(page, path);
    }
  });
});
