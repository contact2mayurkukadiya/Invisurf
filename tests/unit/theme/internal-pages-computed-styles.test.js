'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Internal Pages Real Computed CSS Colors (Playwright Automated Test)', () => {
  const LIGHT_RGB = 'rgb(247, 248, 249)'; // #f7f8f9
  const DARK_RGB = 'rgb(18, 19, 22)';     // #121316

  const pages = [
    { name: 'downloads', file: 'renderer/dist/downloads.html' },
    { name: 'history', file: 'renderer/dist/history.html' },
    { name: 'bookmark', file: 'renderer/dist/bookmark.html' },
    { name: 'settings', file: 'renderer/dist/settings.html' },
    { name: 'extensions', file: 'renderer/dist/extensions.html' },
    { name: 'newtab', file: 'renderer/dist/newtab.html' },
  ];

  let browser;

  test('launches browser instance', async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    assert.ok(browser);
  });

  for (const pageInfo of pages) {
    const fileUrl = 'file://' + path.resolve(__dirname, '../../..', pageInfo.file);

    test(`${pageInfo.name} computes to neutral light (#f7f8f9) in light mode`, async () => {
      const ctx = await browser.newContext({ colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await ctx.close();
      assert.equal(bg, LIGHT_RGB, `${pageInfo.name} light mode background must be ${LIGHT_RGB}`);
    });

    test(`${pageInfo.name} computes to neutral black (#121316) in dark mode`, async () => {
      const ctx = await browser.newContext({ colorScheme: 'dark' });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await ctx.close();
      assert.equal(bg, DARK_RGB, `${pageInfo.name} dark mode background must be ${DARK_RGB}`);
    });

    test(`${pageInfo.name} obeys forced light appearance ([data-forced-appearance="light"])`, async () => {
      const ctx = await browser.newContext({ colorScheme: 'dark' });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.evaluate(() => document.documentElement.setAttribute('data-forced-appearance', 'light'));
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await ctx.close();
      assert.equal(bg, LIGHT_RGB, `${pageInfo.name} forced light background must be ${LIGHT_RGB}`);
    });

    test(`${pageInfo.name} obeys forced dark appearance ([data-forced-appearance="dark"])`, async () => {
      const ctx = await browser.newContext({ colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(fileUrl);
      await page.evaluate(() => document.documentElement.setAttribute('data-forced-appearance', 'dark'));
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await ctx.close();
      assert.equal(bg, DARK_RGB, `${pageInfo.name} forced dark background must be ${DARK_RGB}`);
    });
  }

  test('shuts down browser instance', async () => {
    if (browser) {
      await browser.close();
    }
  });
});
