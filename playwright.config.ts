import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone SE"], defaultBrowserType: "chromium", viewport: { width: 320, height: 700 } } }
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : [
    {
      command: "npm run start:api",
      url: "http://127.0.0.1:7071",
      timeout: 120_000,
      reuseExistingServer: false
    },
    {
      command: "npm run preview --workspace web",
      url: "http://127.0.0.1:4173",
      timeout: 30_000,
      reuseExistingServer: false
    }
  ]
});
