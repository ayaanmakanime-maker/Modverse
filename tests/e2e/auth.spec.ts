import { expect, test } from "@playwright/test";
import { login, logout, PASSWORD, register, uniqueEmail } from "./helpers";

test("registration, logout, login and password policy", async ({ page }) => {
  await page.goto("/register");
  await page.getByTestId("register-password").fill("password");
  await expect(page.getByText(/Strength: very weak/)).toBeVisible();
  const email = await register(page, "Priya");
  await expect(page.getByText("Priya").first()).toBeVisible();
  await logout(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("wrong-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
  await login(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/account/);
});

test("customers cannot access admin APIs or other users' designs", async ({ page, browser }) => {
  await register(page, "Owner");
  const created = await page.request.post("/api/designs", { data: { modelId: "tee-classic-crew", audience: "men" }, headers: { Origin: "http://localhost:3100" } });
  const { design } = await created.json();
  expect((await page.request.get("/api/admin/stats")).status()).toBe(403);
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await register(p2, "Intruder", uniqueEmail("intruder"));
  expect((await p2.request.get(`/api/designs/${design.id}`)).status()).toBe(404);
  expect((await p2.request.put(`/api/designs/${design.id}`, { data: { config: {} }, headers: { Origin: "http://localhost:3100" } })).status()).toBeGreaterThanOrEqual(400);
  // CSRF: cross-origin writes are blocked
  expect((await p2.request.post("/api/designs", { data: { modelId: "tee-classic-crew", audience: "men" }, headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  await other.close();
});
