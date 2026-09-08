import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4177', headless: true },
  webServer: {
    command: 'python3 -m http.server 4177 --bind 127.0.0.1',
    cwd: '../..',
    url: 'http://127.0.0.1:4177/packages/task-timeline-component/e2e/fixture.html',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
