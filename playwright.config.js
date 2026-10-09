const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 40000,
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'node server.js',
    port: 3000,
    reuseExistingServer: true,
    env: { DB_PATH: ':memory:' },
    timeout: 15000,
  },
});
