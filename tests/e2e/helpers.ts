import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Saffron-Monsoon-2026!";
export const ADMIN = { email: "e2e-admin@modverse.local", password: "E2E-Admin-Password-2026!" };

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export async function register(page: Page, name = "Test User", email = uniqueEmail()) {
  await page.goto("/register");
  await page.getByTestId("register-name").fill(name);
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(PASSWORD);
  await page.getByTestId("register-terms").check();
  await page.getByTestId("register-submit").click();
  await page.waitForURL("**/account**");
  return email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.request.post("/api/auth/logout", { headers: { Origin: new URL(page.url()).origin } });
  await page.context().clearCookies();
}

export async function openEditor(page: Page, model = "tee-classic-crew", audience = "men", mode = "atelier") {
  await page.goto(`/design/new?model=${model}&audience=${audience}&mode=${mode}`);
  await expect(page.getByTestId("canvas-2d")).toBeVisible();
}

export async function saveDesign(page: Page) {
  await page.getByTestId("save-design").click();
  await page.waitForURL(/\/design\/[0-9a-f-]{36}/);
  return page.url().match(/\/design\/([0-9a-f-]{36})/)![1];
}
