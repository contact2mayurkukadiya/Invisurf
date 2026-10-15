'use strict';

const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.describe('Profile Picker Flow', () => {
  let electronApp;
  let tempUserData;

  test.beforeEach(async () => {
    tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-picker-test-'));
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

  test('displays hero branding and profile cards on startup', async () => {
    const pickerWindow = await electronApp.firstWindow();
    await pickerWindow.waitForLoadState('domcontentloaded');

    // 1. Check title and branding
    await expect(pickerWindow).toHaveTitle(/Choose profile/i);
    await expect(pickerWindow.locator('.pp-hero__name')).toHaveText('InviSurf');
    await expect(pickerWindow.locator('.pp-subtitle')).toHaveText("Who's using this browser?");

    // 2. Check that at least one profile card exists
    const profileCards = pickerWindow.locator('.pp-card:not(.pp-card--add)');
    await expect(profileCards.first()).toBeVisible();
    const count = await profileCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 3. Check Add Profile button is visible
    const addCardBtn = pickerWindow.locator('.pp-card--add');
    await expect(addCardBtn).toBeVisible();
  });

  test('opens profile editor modal when clicking Add button and cancels cleanly', async () => {
    const pickerWindow = await electronApp.firstWindow();
    await pickerWindow.waitForLoadState('domcontentloaded');

    const addCardBtn = pickerWindow.locator('.pp-card--add');
    await addCardBtn.click();

    // Verify modal appears
    const nameInput = pickerWindow.locator('#profile-editor-name');
    await expect(nameInput).toBeVisible();

    // Type a profile name
    await nameInput.fill('QA Testing Profile');
    await expect(nameInput).toHaveValue('QA Testing Profile');

    // Cancel modal
    const cancelBtn = pickerWindow.locator('.profile-editor-btn--secondary');
    await cancelBtn.click();
    await expect(nameInput).toBeHidden();
  });
});
