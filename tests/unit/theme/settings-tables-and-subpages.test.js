'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Settings Tables and Subpages Layout & Sorting (Playwright Automated Test)', () => {
  let browser;
  const fileUrl = 'file://' + path.resolve(__dirname, '../../../renderer/dist/settings.html');

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  test('Cookies and other site data: renders stacked header and search toolbar', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(fileUrl);

    // Navigate to privacy/cookies
    await page.waitForSelector('.settings-sidebar-item', { timeout: 3000 });
    // Click on Privacy and security
    const privacyBtn = await page.locator('.settings-sidebar-item', { hasText: 'Privacy and security' });
    await privacyBtn.click();

    // Click on Cookies and other site data
    const cookiesLink = await page.locator('.settings-link-row', { hasText: 'Cookies and other site data' });
    await cookiesLink.click();

    // Verify stacked header
    const headerTitle = await page.locator('.settings-subpage-heading-text h2').textContent();
    assert.equal(headerTitle.trim(), 'Cookies and other site data');

    const headerDesc = await page.locator('.settings-subpage-heading-text p').textContent();
    assert.ok(headerDesc.includes('cookies'), 'Header subtitle must explain cookies');

    // Verify search toolbar
    const searchInput = await page.locator('.cookies-toolbar .cookies-search input');
    assert.ok(await searchInput.isVisible(), 'Cookies subpage must render search input in toolbar');

    // Verify "See all site data and permissions" link row is present
    const allLink = await page.locator('.cookie-site-data-link button');
    assert.ok(await allLink.isVisible(), 'Must render link to all site data');

    await ctx.close();
  });

  test('Cookies and site data: renders unified toolbar and sortable table', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // Mock cookieAPI with mock sites
    await page.addInitScript(() => {
      window.cookieAPI = {
        getCookieSummary: async () => [
          { domain: 'zebra.com', count: 5, storageBytes: 2048 },
          { domain: 'alpha.com', count: 12, storageBytes: 8192 },
          { domain: 'middle.org', count: 2, storageBytes: 512 },
        ],
        deleteCookiesForDomain: async () => ({ ok: true }),
        clearAllSiteData: async () => ({ ok: true }),
      };
    });

    await page.goto(fileUrl);
    await page.waitForSelector('.settings-sidebar-item', { timeout: 3000 });

    // Navigate to Privacy -> Cookies -> All cookies
    await page.locator('.settings-sidebar-item', { hasText: 'Privacy and security' }).click();
    await page.locator('.settings-link-row', { hasText: 'Cookies and other site data' }).click();
    await page.locator('.cookie-site-data-link button').click();

    // Verify header title and subtitle
    const title = await page.locator('.settings-subpage-heading-text h2').textContent();
    assert.equal(title.trim(), 'Cookies and site data');

    // Verify toolbar buttons
    const refreshBtn = await page.locator('.cookies-toolbar-button', { hasText: 'Refresh' });
    assert.ok(await refreshBtn.isVisible(), 'Refresh button must be visible');

    const clearAllBtn = await page.locator('.cookies-toolbar-button', { hasText: 'Clear all' });
    assert.ok(await clearAllBtn.isVisible(), 'Clear all button must be visible');

    // Verify table card and header columns
    const tableHeaders = await page.locator('.cookies-table--header span[role="columnheader"]').allTextContents();
    assert.ok(tableHeaders.some(h => h.includes('Site Origin')), 'Header must have Site Origin');
    assert.ok(tableHeaders.some(h => h.includes('Cookies')), 'Header must have Cookies');
    assert.ok(tableHeaders.some(h => h.includes('Storage')), 'Header must have Storage');

    // Verify default sort by domain asc: alpha.com, middle.org, zebra.com
    let rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['alpha.com', 'middle.org', 'zebra.com'], 'Default sort should be domain asc');

    // Click Site Origin header -> sort desc
    const siteHeader = await page.locator('.table-header-col--sortable', { hasText: 'Site Origin' });
    await siteHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['zebra.com', 'middle.org', 'alpha.com'], 'Site Origin click toggles to desc');

    // Click Cookies header -> sort count asc: middle (2), zebra (5), alpha (12)
    const cookiesColHeader = await page.locator('.table-header-col--sortable', { hasText: 'Cookies' });
    await cookiesColHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['middle.org', 'zebra.com', 'alpha.com'], 'Cookies header sorts count asc');

    // Click Cookies header again -> sort count desc: alpha (12), zebra (5), middle (2)
    await cookiesColHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['alpha.com', 'zebra.com', 'middle.org'], 'Cookies header click toggles to count desc');

    // Click Storage header -> sort storageBytes asc: middle (512), zebra (2048), alpha (8192)
    const storageColHeader = await page.locator('.table-header-col--sortable', { hasText: 'Storage' });
    await storageColHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['middle.org', 'zebra.com', 'alpha.com'], 'Storage header sorts bytes asc');

    await ctx.close();
  });

  test('Site settings and permissions: renders unified toolbar and sortable table', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // Mock permissions API with mock items
    await page.addInitScript(() => {
      window.permissionAPI = {
        getAll: async () => [
          {
            origin: 'https://z-site.com',
            permissions: {
              camera: { state: 'allow', lastUpdated: Date.now() },
            },
          },
          {
            origin: 'https://a-site.com',
            permissions: {
              microphone: { state: 'deny', lastUpdated: Date.now() },
            },
          },
          {
            origin: 'https://m-site.com',
            permissions: {
              geolocation: { state: 'prompt', lastUpdated: Date.now() },
            },
          },
        ],
        resetPermission: async () => ({ ok: true }),
        resetAll: async () => ({ ok: true }),
      };
    });

    await page.goto(fileUrl);
    await page.waitForSelector('.settings-sidebar-item', { timeout: 3000 });

    // Navigate to Privacy -> Site settings and permissions
    await page.locator('.settings-sidebar-item', { hasText: 'Privacy and security' }).click();
    await page.locator('.settings-link-row', { hasText: 'Site settings and permissions' }).click();

    // Verify header title and subtitle
    const title = await page.locator('.settings-subpage-heading-text h2').textContent();
    assert.equal(title.trim(), 'Site settings and permissions');

    // Verify toolbar
    const searchInput = await page.locator('.cookies-toolbar .cookies-search input');
    assert.ok(await searchInput.isVisible(), 'Permissions search input must be visible');

    const refreshBtn = await page.locator('.cookies-toolbar-button', { hasText: 'Refresh' });
    assert.ok(await refreshBtn.isVisible(), 'Refresh button must be visible');

    const clearAllBtn = await page.locator('.cookies-toolbar-button', { hasText: 'Clear all' });
    assert.ok(await clearAllBtn.isVisible(), 'Clear all button must be visible');

    // Verify table headers
    const tableHeaders = await page.locator('.cookies-table--header span[role="columnheader"]').allTextContents();
    assert.ok(tableHeaders.some(h => h.includes('Site Origin')), 'Header must have Site Origin');
    assert.ok(tableHeaders.some(h => h.includes('Permission')), 'Header must have Permission');
    assert.ok(tableHeaders.some(h => h.includes('Status')), 'Header must have Status');

    // Verify default sort by origin asc: a-site, m-site, z-site
    let rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['https://a-site.com', 'https://m-site.com', 'https://z-site.com'], 'Default sort should be origin asc');

    // Click Site Origin header -> sort desc: z-site, m-site, a-site
    const originHeader = await page.locator('.table-header-col--sortable', { hasText: 'Site Origin' });
    await originHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['https://z-site.com', 'https://m-site.com', 'https://a-site.com'], 'Site Origin click toggles to desc');

    // Click Permission header -> Camera (z), Geolocation (m), Microphone (a)
    const permColHeader = await page.locator('.table-header-col--sortable', { hasText: 'Permission' });
    await permColHeader.click();
    rows = await page.locator('.cookies-table--row .cookies-site span:nth-child(2)').allTextContents();
    assert.deepEqual(rows, ['https://z-site.com', 'https://m-site.com', 'https://a-site.com'], 'Permission header sorts by permName asc');

    await ctx.close();
  });

  test('closes browser instance', async () => {
    if (browser) {
      await browser.close();
    }
  });
});
