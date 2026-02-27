import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for README screenshot generation.
 * Reuses the dev server settings from the main config.
 *
 * Run:  npm run screenshots
 */
export default defineConfig({
  testDir: './scripts',
  testMatch: 'generate-screenshots.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5173',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
