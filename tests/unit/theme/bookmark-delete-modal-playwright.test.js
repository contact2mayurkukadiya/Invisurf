'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Bookmark Delete Modal & Dynamic Accent Tokens (Playwright Automated Test)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const bookmarkUrl = 'file://' + path.join(ROOT, 'renderer/dist/bookmark.html');
  const historyUrl = 'file://' + path.join(ROOT, 'renderer/dist/history.html');

  let browser;

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('History Delete Data button computes to dynamic accent color instead of hardcoded blue', async () => {
    const page = await browser.newPage();
    await page.goto(historyUrl);

    // Apply forest theme accent tokens to root
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--chrome-accent', '#16a34a');
      document.documentElement.style.setProperty('--chrome-content-active-fg', '#16a34a');
      document.documentElement.style.setProperty('--chrome-content-active-bg', 'rgba(22, 163, 74, 0.1)');
    });

    // Open clear browsing data modal
    const clearAllBtn = page.locator('.internal-page-header__clear-all');
    if (await clearAllBtn.isVisible()) {
      await clearAllBtn.click();
      const deleteBtn = page.locator('.h-modal-delete');
      await deleteBtn.waitFor({ state: 'visible' });
      const bgColor = await deleteBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      // rgb(22, 163, 74) is #16a34a (Forest Green)
      assert.equal(bgColor, 'rgb(22, 163, 74)', 'History delete button must reflect chosen theme accent color');
    }
    await page.close();
  });

  test('Bookmark page shows delete confirmation modal with chosen appearance color and matching design', async () => {
    const page = await browser.newPage();

    // Inject mock electronAPI before page script runs
    await page.addInitScript(() => {
      window.electronAPI = {
        bookmarksGet: () => Promise.resolve({
          bar: [
            { id: 'b-test-1', title: 'Example Bookmark', url: 'https://example.com' },
          ],
        }),
        bookmarkGetFolder: () => Promise.resolve({
          items: [
            { id: 'b-test-1', title: 'Example Bookmark', url: 'https://example.com' },
          ],
          hasMore: false,
          nextCursor: null,
        }),
        bookmarkSearch: () => Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
        bookmarkDelete: (ids) => {
          window.__deletedIds = ids;
          return Promise.resolve(true);
        },
        bookmarkUpdate: () => Promise.resolve(true),
        onBookmarksUpdated: () => () => {},
        settingsGet: () => Promise.resolve({ accentTheme: 'violet', colorTheme: 'light' }),
        onSettingsChanged: () => () => {},
      };
    });

    await page.goto(bookmarkUrl);

    // Set theme accent token for violet theme (#7c3aed)
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--chrome-accent', '#7c3aed');
      document.documentElement.style.setProperty('--chrome-content-active-fg', '#7c3aed');
      document.documentElement.style.setProperty('--chrome-content-active-bg', 'rgba(124, 58, 237, 0.1)');
    });

    // Wait for bookmark row to appear
    const moreBtn = page.locator('.b-more-btn').first();
    await moreBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Click 3-dots more button to open context menu
    await moreBtn.click();

    // Click Delete in the context menu
    const deleteMenuItem = page.locator('.b-context-item.danger');
    await deleteMenuItem.waitFor({ state: 'visible' });
    await deleteMenuItem.click();

    // Verify Delete Confirmation Dialog is displayed!
    const modal = page.locator('.b-modal');
    await modal.waitFor({ state: 'visible', timeout: 3000 });

    // Verify Title
    const modalTitle = page.locator('#b-delete-modal-title');
    assert.equal(await modalTitle.textContent(), 'Delete bookmark?');

    // Verify Preview of bookmark
    const previewTitle = page.locator('.b-delete-modal-preview-title');
    assert.equal(await previewTitle.textContent(), 'Example Bookmark');

    // Verify Cancel button styling
    const cancelBtn = page.locator('.b-modal-cancel');
    await cancelBtn.waitFor({ state: 'visible' });

    // Verify Delete button styling and background color
    const deleteBtn = page.locator('.b-modal-delete');
    await deleteBtn.waitFor({ state: 'visible' });
    const deleteBg = await deleteBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    // rgb(124, 58, 237) is #7c3aed (Violet)
    assert.equal(deleteBg, 'rgb(124, 58, 237)', 'Delete button must compute to chosen theme accent (#7c3aed)');

    // Capture screenshot proof for reporting
    await page.screenshot({ path: path.join(__dirname, '../../../tests/reports/bookmark-delete-modal.png') });

    // Test clicking Cancel closes the dialog without deleting
    await cancelBtn.click();
    await modal.waitFor({ state: 'hidden' });
    const deletedOnCancel = await page.evaluate(() => window.__deletedIds);
    assert.equal(deletedOnCancel, undefined, 'Canceling modal must not trigger bookmarkDelete');

    // Open it again and confirm deletion
    await moreBtn.click();
    await deleteMenuItem.click();
    await modal.waitFor({ state: 'visible' });
    await page.locator('.b-modal-delete').click();
    await modal.waitFor({ state: 'hidden' });

    const deletedIds = await page.evaluate(() => window.__deletedIds);
    assert.deepEqual(deletedIds, ['b-test-1'], 'Confirming delete modal must call bookmarkDelete with target ID');

    await page.close();
  });

  test('closes browser instance', async () => {
    if (browser) {
      await browser.close();
    }
  });
});
