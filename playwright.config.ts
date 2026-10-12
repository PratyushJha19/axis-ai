import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  outputDir: ".local/playwright-results",
  reporter: "list",
  use: {
    baseURL: "http://localhost:33018",
    channel: process.platform === "win32" ? "msedge" : "chromium",
    headless: true,
    trace: "off",
    actionTimeout: 10000,
  },
  webServer: {
    command: "node --import tsx tests/e2e/server.ts",
    url: "http://localhost:33018/health/ready",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
