import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// A port of its own, so a dev server left running on 3000 is never touched.
const PORT = Number(process.env.TEST_PORT) || 3210;
const DB_FILE = path.join(here, '.test-tmp', 'playwright.db');

// Every run starts from an empty database, sidecar files and all. Playwright
// re-evaluates this config inside each worker, and by then the server is up and
// holding the file open — deleting it there fails with EPERM on Windows. Only
// the initial load (the one without a worker index) does the cleaning, and that
// happens before the web server starts.
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
}
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'node server.js',
    url: `http://localhost:${PORT}/index.html`,
    env: { PORT: String(PORT), PLANNER_DB: DB_FILE },
    // Never adopt a server someone else started: it would be pointed at the
    // real planner.db rather than the throwaway one above.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000,
  },
});
