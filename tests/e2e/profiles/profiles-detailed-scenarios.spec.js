// spec: tests/specs/profiles-scenarios.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.describe('InviSurf Profiles Detailed Scenarios', () => {
  let electronApp;
  let tempUserData;

  test.beforeEach(async () => {
    tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-profile-scenarios-'));
    electronApp = await electron.launch({
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
  });

  test.afterEach(async () => {
    try {
      await electronApp.close();
    } catch (_) {}
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1.1 profile-picker-landing-and-selection: displays branding, cards, and add button', async () => {
    const pickerWindow = await electronApp.firstWindow();
    await pickerWindow.waitForLoadState('domcontentloaded');

    // 1. Branding & header text
    await expect(pickerWindow).toHaveTitle(/Choose profile/i);
    await expect(pickerWindow.locator('.pp-hero__name')).toHaveText('InviSurf');
    await expect(pickerWindow.locator('.pp-subtitle')).toHaveText("Who's using this browser?");

    // 2. Profile cards
    const profileCards = pickerWindow.locator('.pp-card:not(.pp-card--add)');
    await expect(profileCards.first()).toBeVisible();
    const count = await profileCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 3. Add Card button
    const addCardBtn = pickerWindow.locator('.pp-card--add');
    await expect(addCardBtn).toBeVisible();
  });

  test('1.2 profile-creation-modal-workflow: opens modal, cancels, creates profile, and displays card', async () => {
    const pickerWindow = await electronApp.firstWindow();
    await pickerWindow.waitForLoadState('domcontentloaded');

    const addCardBtn = pickerWindow.locator('.pp-card--add');
    await addCardBtn.click();

    // 1. Modal appears with input
    const nameInput = pickerWindow.locator('#profile-editor-name');
    await expect(nameInput).toBeVisible();

    // 2. Test cancel
    await nameInput.fill('Draft Profile');
    const cancelBtn = pickerWindow.locator('.profile-editor-btn--secondary');
    await cancelBtn.click();
    await expect(nameInput).toBeHidden();

    // 3. Re-open and create new profile
    await addCardBtn.click();
    await expect(nameInput).toBeVisible();
    await nameInput.fill('QA Automation Profile');

    const saveBtn = pickerWindow.locator('.profile-editor-btn--primary');
    await saveBtn.click();
    await expect(nameInput).toBeHidden();

    // 4. Verify new profile card appears in picker list
    const newCard = pickerWindow.locator('.pp-card', { hasText: 'QA Automation Profile' });
    await expect(newCard).toBeVisible({ timeout: 5000 });
  });

  test('2.1 profile-menu-toolbar-trigger: opens shell window and validates profile button state', async () => {
    const pickerWindow = await electronApp.firstWindow();
    await pickerWindow.waitForLoadState('domcontentloaded');

    // Click profile card to open shell window
    const firstCard = pickerWindow.locator('.pp-card:not(.pp-card--add)').first();
    await firstCard.click();

    // Find shell window
    let shellWindow = null;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      shellWindow = electronApp.windows().find((w) => w.url().includes('index.html'));
      if (shellWindow) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(shellWindow).not.toBeNull();
    await shellWindow.waitForLoadState('domcontentloaded');

    // Locate profile avatar button in toolbar
    const profileBtn = shellWindow.locator('.profile-menu__trigger');
    await expect(profileBtn).toBeVisible({ timeout: 5000 });
    await expect(profileBtn).toHaveAttribute('aria-label', /Profiles/i);
    await expect(profileBtn).toHaveAttribute('aria-expanded', 'false');

    // Click profile button to toggle open
    await profileBtn.click();
    await expect(profileBtn).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    await profileBtn.click();
    await expect(profileBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
