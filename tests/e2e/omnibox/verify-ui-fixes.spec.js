'use strict';

const { test, expect } = require('../fixtures/electronApp');
const path = require('path');

test.describe('Visual & Functional Verification: Omnibox & Permissions Popup UI', () => {
  test('verifies omnibox inline input box width and site permissions popup UI', async ({ invisurfApp }) => {
    const { app, shellWindow } = invisurfApp;

    // 1. Wait for active tab
    await shellWindow.locator('.tab.active').waitFor({ state: 'visible', timeout: 5000 });
    await shellWindow.waitForTimeout(500);

    // Set an external URL to show site info prefix & star suffix
    const testUrl = 'https://docs.permit.io/overview/sync-your-first-user-with-sd';
    await shellWindow.evaluate((url) => {
      const state = window.__store?.getState?.();
      const activeId = state?.browser?.currentTabId || Object.keys(state?.browser?.tabs || {})[0];
      if (activeId && window.__store) {
        window.__store.dispatch({
          type: 'browser/updateTabUrl',
          payload: { id: activeId, url },
        });
      }
    }, testUrl);

    // Focus omnibox and fill with the test URL
    const omnibox = shellWindow.locator('#url-input');
    await expect(omnibox).toBeVisible();
    await omnibox.click();
    await omnibox.fill(testUrl);
    await omnibox.press('Meta+A');
    await shellWindow.waitForTimeout(300);

    // Check geometry of input zone and suffix
    const inputZone = shellWindow.locator('.omnibox-input-zone');
    const suffix = shellWindow.locator('.omnibox-suffix');
    const debugInfo = await shellWindow.evaluate(() => {
      const el = document.getElementById('url-input');
      const parent = el ? el.parentElement : null;
      const cs = el ? window.getComputedStyle(el) : null;
      const pcs = parent ? window.getComputedStyle(parent) : null;
      return {
        boxSizing: cs?.boxSizing,
        width: cs?.width,
        paddingLeft: cs?.paddingLeft,
        paddingRight: cs?.paddingRight,
        parentWidth: pcs?.width,
        parentBoxSizing: pcs?.boxSizing,
        parentOverflow: pcs?.overflow,
        matchedRules: cs?.cssText,
      };
    });
    console.log('DEBUG INFO:', debugInfo);

    const inputZoneBox = await inputZone.boundingBox();
    const omniboxBox = await omnibox.boundingBox();

    expect(inputZoneBox).not.toBeNull();
    expect(omniboxBox).not.toBeNull();

    // Verify input box width does NOT exceed inputZone width
    expect(omniboxBox.width).toBeLessThanOrEqual(inputZoneBox.width + 1);

    if (await suffix.count() > 0) {
      const suffixBox = await suffix.boundingBox();
      if (suffixBox) {
        // Ensure omnibox right edge does not overlap suffix left edge
        expect(omniboxBox.x + omniboxBox.width).toBeLessThanOrEqual(suffixBox.x + 2);
      }
    }

    const screenshotDir = path.join(__dirname, '..', 'test-results');
    await shellWindow.screenshot({ path: path.join(screenshotDir, 'omnibox-inline-fixed.png') });

    // Click tab-bar to blur omnibox
    await shellWindow.locator('.tab-bar').click({ position: { x: 50, y: 10 } });
    await shellWindow.waitForTimeout(300);

    // 2. Open Site permissions popup
    const siteInfoBtn = shellWindow.locator('button.omnibox-action-btn--prefix[title="View site information"]');
    await expect(siteInfoBtn).toBeVisible({ timeout: 5000 });
    await siteInfoBtn.click({ force: true });
    await expect(siteInfoBtn).toHaveAttribute('aria-expanded', 'true');
    await shellWindow.waitForTimeout(600);

    // In overlay, click 'Site permissions'
    const overlayView = await app.evaluate(() => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      return ctx?.chromeOverlayView ? true : false;
    });
    expect(overlayView).toBe(true);

    // Send patch to overlay
    await app.evaluate(async () => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      const overlay = ctx?.chromeOverlayView;
      if (!overlay) return;
      ctx.chromeOverlayAcquireCount = 1;
      overlay.setBounds({ x: 50, y: 50, width: 340, height: 400 });
      overlay.webContents.send('chrome-overlay:v1:patch', {
        kind: 'siteInfo',
        domain: 'docs.permit.io',
        origin: 'https://docs.permit.io',
        url: 'https://docs.permit.io/overview/sync-your-first-user-with-sd',
        isSecure: true,
        anchorRect: { left: 50, top: 50, width: 28, height: 28 }
      });
    });

    await shellWindow.waitForTimeout(500);

    // Click 'Site permissions' in overlay
    const clickResult = await app.evaluate(async () => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      const overlay = ctx?.chromeOverlayView;
      if (!overlay) return null;
      return await overlay.webContents.executeJavaScript(`
        (function() {
          const rows = Array.from(document.querySelectorAll('.co-site-info-row'));
          const permRow = rows.find(r => r.textContent.includes('Site permissions'));
          if (permRow) {
            permRow.click();
            return { clicked: true };
          }
          return { clicked: false, rowTexts: rows.map(r => r.textContent) };
        })()
      `);
    });
    console.log('CLICK RESULT:', clickResult);

    await shellWindow.waitForTimeout(600);

    // Verify overlay permissions view elements and styles
    const permViewCheck = await app.evaluate(async () => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      const overlay = ctx?.chromeOverlayView;
      if (!overlay) return null;
      return await overlay.webContents.executeJavaScript(`
        (function() {
          const scroll = document.querySelector('.co-site-perm-scroll');
          const footer = document.querySelector('.co-site-perm-footer');
          const resetBtn = document.querySelector('.co-site-perm-reset-btn');
          const doneBtn = document.querySelector('.co-site-perm-done-btn');
          const selects = Array.from(document.querySelectorAll('.co-site-perm-select'));
          const chevrons = Array.from(document.querySelectorAll('.co-site-perm-chevron'));
          return {
            hasScroll: !!scroll,
            hasFooter: !!footer,
            hasResetBtn: !!resetBtn,
            hasDoneBtn: !!doneBtn,
            resetText: resetBtn ? resetBtn.textContent.trim() : null,
            doneText: doneBtn ? doneBtn.textContent.trim() : null,
            selectCount: selects.length,
            chevronCount: chevrons.length,
            footerClass: footer ? footer.className : null
          };
        })()
      `);
    });

    console.log('PERM VIEW CHECK:', permViewCheck);
    expect(permViewCheck.hasScroll).toBe(true);
    expect(permViewCheck.hasFooter).toBe(true);
    expect(permViewCheck.hasResetBtn).toBe(true);
    expect(permViewCheck.hasDoneBtn).toBe(true);
    expect(permViewCheck.resetText).toContain('Reset permissions');
    expect(permViewCheck.doneText).toBe('Done');
    expect(permViewCheck.selectCount).toBeGreaterThanOrEqual(1);
    expect(permViewCheck.chevronCount).toBeGreaterThanOrEqual(1);

    // Take screenshot of overlay view
    const overlayImgBase64 = await app.evaluate(async () => {
      const State = global.__invisurfState;
      const ctx = State?.windowContextsById?.values()?.next()?.value;
      const overlay = ctx?.chromeOverlayView;
      if (!overlay) return null;
      const img = await overlay.webContents.capturePage();
      return img.toPNG().toString('base64');
    });

    if (overlayImgBase64) {
      const fs = require('fs');
      fs.writeFileSync(path.join(screenshotDir, 'permissions-popup-fixed.png'), Buffer.from(overlayImgBase64, 'base64'));
    }
  });
});
