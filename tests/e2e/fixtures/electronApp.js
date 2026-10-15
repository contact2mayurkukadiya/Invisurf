'use strict';

const { test: base, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Extended Playwright test runner configured for InviSurf Electron application.
 * Automatically manages an isolated test userData directory for each test run,
 * handles the initial "Choose profile" picker, and targets the real browser shell window (index.html).
 */
const test = base.extend({
  invisurfApp: async ({}, use) => {
    const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-test-data-'));

    const electronApp = await electron.launch({
      args: [
        path.join(__dirname, '..', '..', '..'),
        `--user-data-dir=${tempUserData}`,
        '--no-sandbox',
        '--disable-gpu',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        INVISURF_TEST_MODE: 'true',
      },
    });

    // InviSurf launches the "Choose profile" picker window first
    const firstWin = await electronApp.firstWindow();
    await firstWin.waitForLoadState('domcontentloaded');

    const initialTitle = await firstWin.title().catch(() => '');

    if (initialTitle.toLowerCase().includes('profile')) {
      // Click the profile card in the picker to launch the main InviSurf browser window
      try {
        const profileCard = firstWin.locator('.pp-card:not(.pp-card--add)').first();
        if (await profileCard.isVisible({ timeout: 4000 }).catch(() => false)) {
          await profileCard.click();
        } else {
          throw new Error('Profile card not visible');
        }
      } catch (_) {
        // Fallback: trigger main window creation directly in Electron main process
        await electronApp.evaluate(() => {
          const State = require('./main/state');
          const windowManager = require('./main/windows/windowManager');
          const profile = Array.from(State.profilesById.values())[0];
          if (profile) {
            windowManager.createWindow(profile.profileId);
            if (State.profilePickerWindow && !State.profilePickerWindow.isDestroyed()) {
              State.profilePickerWindow.close();
            }
          }
        });
      }
    }

    // Wait until the real browser shell window (app://dist/index.html) is loaded
    let shellWindow = null;
    const startWait = Date.now();
    while (Date.now() - startWait < 15000) {
      shellWindow = electronApp.windows().find((w) => w.url().includes('index.html'));
      if (shellWindow) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!shellWindow) {
      shellWindow = await electronApp.waitForEvent('window', {
        timeout: 10000,
        predicate: (w) => w.url().includes('index.html'),
      });
    }

    await shellWindow.waitForLoadState('domcontentloaded');
    // Ensure React UI elements have mounted
    await shellWindow.locator('#url-input').waitFor({ state: 'visible', timeout: 10000 });

    await use({
      app: electronApp,
      pickerWindow: firstWin,
      shellWindow,
      tempUserData,
      getTabPages: () => {
        const pages = electronApp.context().pages();
        return pages.filter((p) => p !== shellWindow);
      },
    });

    // Teardown
    try {
      await electronApp.close();
    } catch (_) {}

    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch (_) {}
  },
});

module.exports = { test, expect: base.expect };
