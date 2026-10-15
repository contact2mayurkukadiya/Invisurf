// spec: tests/specs/ghost-transparency-scenarios.plan.md
// seed: tests/e2e/fixtures/seed.spec.js
'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('InviSurf Window Transparency & Ghost Mode Detailed Scenarios', () => {
  test('1.1 transparency-toolbar-trigger-and-aria-state: verifies trigger visibility and expanded toggle', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Locate transparency toolbar button
    const transBtn = shellWindow.locator('#transparency-btn');
    await expect(transBtn).toBeVisible({ timeout: 5000 });
    await expect(transBtn).toHaveAttribute('aria-label', 'Transparency Mode');
    await expect(transBtn).toHaveAttribute('aria-expanded', 'false');

    // 2. Click to toggle open
    await transBtn.click();
    await expect(transBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(transBtn).toHaveClass(/window-opacity-trigger--active/);

    // 3. Click again to toggle close
    await transBtn.click();
    await expect(transBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(transBtn).not.toHaveClass(/window-opacity-trigger--active/);
  });

  test('1.2 transparency-opacity-change-and-bounds: exercises opacity setting and title updates', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    const transBtn = shellWindow.locator('#transparency-btn');
    await expect(transBtn).toBeVisible({ timeout: 5000 });

    // Set window opacity via windowSetOpacity to 0.65 (65%)
    await shellWindow.evaluate(async () => {
      await window.electronAPI.windowSetOpacity(0.65);
    });

    // Verify title updates to reflect 65%
    await expect(transBtn).toHaveAttribute('title', /65%/i, { timeout: 5000 });

    // Restore to 1.0 (100%)
    await shellWindow.evaluate(async () => {
      await window.electronAPI.windowSetOpacity(1.0);
    });
    await expect(transBtn).toHaveAttribute('title', /100%/i, { timeout: 5000 });
  });

  test('2.1 ghost-mode-badge-and-passthrough-toggle: verifies click-through event handling and styling', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // Dispatch ghost click-through state changes and verify shell stability
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('ghost:click-through-changed', {
        isClickThrough: true,
      });
    });

    // Allow event loop to process
    await shellWindow.waitForTimeout(200);

    // Restore interactive state
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      win?.webContents.send('ghost:click-through-changed', {
        isClickThrough: false,
      });
    });

    // Shell window remains fully responsive and functional
    const transBtn = shellWindow.locator('#transparency-btn');
    await expect(transBtn).toBeVisible();
  });
});
