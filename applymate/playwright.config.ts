import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig({
  testDir: join(root, "applymate", "tests"),
  outputDir: join(root, "applymate-test-results"),
  preserveOutput: "never",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 12000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175", locale: "en-US",
    trace: "off", screenshot: "off", video: "off",
    reducedMotion: "reduce"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone SE"], defaultBrowserType: "chromium", viewport: { width: 320, height: 700 } } }
  ],
  webServer: [
    {
      command: "npm exec --workspace @applymate/server -- tsx src/test-server.ts",
      cwd: root, url: "http://127.0.0.1:7073/api/health",
      timeout: 90000, reuseExistingServer: false
    },
    {
      command: "npx cross-env APPLYMATE_API_URL=http://127.0.0.1:7073 npm run preview --workspace @applymate/client -- --port 4175",
      cwd: root, url: "http://127.0.0.1:4175",
      timeout: 30000, reuseExistingServer: false
    }
  ]
});
