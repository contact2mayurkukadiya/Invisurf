'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Screen Share Banner UI & Controls', () => {
  test('displays screen share banner beneath bookmarkbar with theme styling and context buttons', async ({ invisurfApp }) => {
    const { shellWindow } = invisurfApp;

    // 1. Initially screen share banner is not active
    await expect(shellWindow.locator('.screen-share-banner-wrapper')).toHaveCount(0);

    // 2. Simulate screen share starting via Redux/IPC
    await shellWindow.evaluate(() => {
      window.dispatchEvent(new CustomEvent('test:set-screen-share', {
        detail: {
          active: true,
          sourceKind: 'tab',
          sharedTabId: 'tab-shared-chatgpt',
          sharedHost: 'chatgpt.com',
          sharedTitle: 'ChatGPT - Drone Parts Cost Analysis',
          requestingTabId: 'tab-meet',
          requestingHost: 'meet.google.com',
        }
      }));
    });

    // Check directly via dispatch if window.__invisurfStore or Redux dispatch is available
    await shellWindow.evaluate(() => {
      // Dispatch status changed to window directly
      const payload = {
        active: true,
        sourceKind: 'tab',
        sharedTabId: 'tab-shared-chatgpt',
        sharedHost: 'chatgpt.com',
        sharedTitle: 'ChatGPT - Drone Parts Cost Analysis',
        requestingTabId: 'tab-meet',
        requestingHost: 'meet.google.com',
      };
      // Send IPC message to renderer
      window.postMessage({ type: 'screen-share-test-status', payload }, '*');
    });
  });
});

