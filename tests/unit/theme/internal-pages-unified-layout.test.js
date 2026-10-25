'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Internal Pages Unified Header & Sidebar Layout (Playwright Automated Test)', () => {
  const pages = [
    { name: 'downloads', file: 'renderer/dist/downloads.html', title: 'Downloads', placeholder: 'Search download history', hasSidebar: false },
    { name: 'history', file: 'renderer/dist/history.html', title: 'History', placeholder: 'Search history', hasSidebar: true, sidebarSelector: '.h-sidebar' },
    { name: 'bookmark', file: 'renderer/dist/bookmark.html', title: 'Bookmarks', placeholder: 'Search bookmarks', hasSidebar: true, sidebarSelector: '.b-sidebar' },
    { name: 'settings', file: 'renderer/dist/settings.html', title: 'Settings', placeholder: 'Search settings', hasSidebar: true, sidebarSelector: '.settings-sidebar' },
    { name: 'extensions', file: 'renderer/dist/extensions.html', title: 'Extensions', placeholder: 'Search extensions', hasSidebar: true, sidebarSelector: '.extensions-sidebar' },
  ];

  let browser;

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  for (const p of pages) {
    const fileUrl = 'file://' + path.resolve(__dirname, '../../..', p.file);

    test(`${p.name}: renders unified header (logo, title, search box)`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(fileUrl);

      // Verify header container
      const header = await page.waitForSelector('.internal-page-header', { timeout: 3000 });
      assert.ok(header, `${p.name} must render .internal-page-header`);

      const headerHeight = await page.evaluate(() => {
        const h = document.querySelector('.internal-page-header');
        return h ? getComputedStyle(h).height : null;
      });
      assert.equal(headerHeight, '56px', `${p.name} header height must be 56px`);

      // Verify left side: logo and title
      const logo = await page.$('.internal-page-header__logo');
      assert.ok(logo, `${p.name} must render header logo`);

      const titleText = await page.$eval('.internal-page-header__title', (el) => el.textContent.trim());
      assert.equal(titleText, p.title, `${p.name} header title must be "${p.title}"`);

      // Verify center: search box and input
      const searchBox = await page.$('.internal-page-header__search-box');
      assert.ok(searchBox, `${p.name} must render search box`);

      const input = await page.$('.internal-page-header__search-input');
      assert.ok(input, `${p.name} must render search input`);

      const placeholder = await input.getAttribute('placeholder');
      assert.equal(placeholder, p.placeholder, `${p.name} search placeholder must match`);

      // Test typing and clearing in search box
      await input.fill('test search query');
      const clearBtn = await page.waitForSelector('.internal-page-header__search-clear-btn', { timeout: 1000 });
      assert.ok(clearBtn, `${p.name} search clear button must appear when text is typed`);

      await clearBtn.click();
      const val = await input.inputValue();
      assert.equal(val, '', `${p.name} clicking clear button must clear search input`);

      await ctx.close();
    });

    if (p.hasSidebar) {
      test(`${p.name}: left sidebar width is exactly 256px`, async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        await page.goto(fileUrl);

        const sidebar = await page.waitForSelector(p.sidebarSelector, { timeout: 3000 });
        assert.ok(sidebar, `${p.name} must render sidebar ${p.sidebarSelector}`);

        const width = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return Math.round(el.getBoundingClientRect().width);
        }, p.sidebarSelector);

        assert.equal(width, 256, `${p.name} sidebar width must be exactly 256px (was ${width}px)`);

        await ctx.close();
      });
    }
  }

  test('closes browser instance', async () => {
    if (browser) await browser.close();
  });
});
