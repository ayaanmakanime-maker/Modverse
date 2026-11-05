import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_ADMIN = { email: "e2e-admin@modverse.local", password: "E2E-Admin-Password-2026!" };
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: [...GL, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
    permissions: ["camera"],
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `rm -rf .data/e2e && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { MODVERSE_DATA_DIR: ".data/e2e", ADMIN_EMAIL: E2E_ADMIN.email, ADMIN_PASSWORD: E2E_ADMIN.password, MODVERSE_DISABLE_RATE_LIMIT: "true", MODVERSE_DEMO_ACCOUNTS: "false" },
  },
});
