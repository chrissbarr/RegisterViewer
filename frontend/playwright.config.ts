import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test_e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ...process.env,
      // Enable cloud features for all E2E tests. Only cloud-projects.spec.ts
      // intercepts requests via page.route(); other tests simply ignore the
      // extra cloud UI elements (Save button, etc.) and are unaffected.
      VITE_API_URL: 'https://mock-cloud-api.test',
      VITE_PERF_PROFILING: 'true',
    },
  },
});
