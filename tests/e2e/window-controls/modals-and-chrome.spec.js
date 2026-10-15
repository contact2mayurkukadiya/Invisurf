// spec: tests/specs/modals-and-chrome.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Window Controls & In-Shell Modals', () => {
  test('transparency-mode-toggle: toggles opacity button active state', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const transparencyBtn = shellWindow.locator('#transparency-btn');
    await expect(transparencyBtn).toBeVisible();
    await expect(transparencyBtn).toHaveAttribute('aria-label', 'Transparency Mode');

    // Click transparency button to open menu
    await transparencyBtn.click();
    await expect(transparencyBtn).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    await transparencyBtn.click();
    await expect(transparencyBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('profile-menu-presence: validates profile menu button in chrome', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const profileBtn = shellWindow.locator('.profile-menu__trigger');
    await expect(profileBtn).toBeVisible();
    await expect(profileBtn).toHaveAttribute('aria-label', /Profiles/i);
  });

  test('command-palette-search: triggers command palette, filters commands, and closes on Escape', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // Send command palette IPC shortcut from main process
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-command-palette');
    });

    const paletteDialog = shellWindow.locator('div[role="dialog"][aria-label="Search menu commands"]');
    await expect(paletteDialog).toBeVisible({ timeout: 5000 });

    const searchInput = paletteDialog.locator('input.search-tabs-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('New Tab');

    const firstRow = paletteDialog.locator('.command-palette-row').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toContainText(/New Tab/i);

    // Escape closes the dialog
    await searchInput.press('Escape');
    await expect(paletteDialog).not.toBeVisible();
  });

  test('tab-search-modal: triggers tab search, displays current tab, and dismisses on Escape', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // Send tab search IPC shortcut from main process
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('shortcut-tab-search');
    });

    const tabSearchDialog = shellWindow.locator('div[role="dialog"][aria-label="Search tabs"]');
    await expect(tabSearchDialog).toBeVisible({ timeout: 5000 });

    const searchInput = tabSearchDialog.locator('input.search-tabs-input');
    await expect(searchInput).toBeVisible();

    // Verify tab row exists
    const tabRow = tabSearchDialog.locator('.search-tabs-row').first();
    await expect(tabRow).toBeVisible();

    // Press Escape to dismiss
    await searchInput.press('Escape');
    await expect(tabSearchDialog).not.toBeVisible();
  });
});
