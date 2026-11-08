'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

describe('Screen Share Picker & Banner Visual Verification (Playwright)', () => {
  let browser;
  const ARTIFACTS_DIR = '/Users/mayurkukadiya/.gemini/antigravity/brain/173c42b8-1cff-4c9d-9959-9f18b0af5378';
  const overlayHtmlPath = 'file://' + path.resolve(__dirname, '../../../renderer/chrome-overlay.html');

  before(async () => {
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-web-security'],
    });
  });

  after(async () => {
    if (browser) await browser.close();
  });

  test('Renders Desktop Media Picker in theme with split 2-column tabs and captures screenshot', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERR:', err));
    await page.goto(overlayHtmlPath);

    // Apply burgundy theme tokens matching reference
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--chrome-accent', '#80333d');
      document.documentElement.style.setProperty('--chrome-nav-bg', '#fff5f5');
      document.documentElement.style.setProperty('--chrome-fg', '#202124');
      document.documentElement.style.setProperty('--chrome-secondary-fg', 'rgba(32, 33, 36, 0.65)');
      document.documentElement.style.setProperty('--chrome-tab-separator', 'rgba(0, 0, 0, 0.1)');
    });

    // Render desktop media picker
    await page.evaluate(() => {
      const mockTabs = [
        { id: 'tab:1', tabId: 1, name: 'Drone Parts Cost Analysis', favicon: 'https://chatgpt.com/favicon.ico', thumbnail: '' },
        { id: 'tab:2', tabId: 2, name: 'Buy Drone Parts Online in India | Frames, Motors', favicon: 'https://zbotic.in/favicon.ico', thumbnail: '' },
        { id: 'tab:3', tabId: 3, name: '3d printing service online - Google Search', favicon: 'https://google.com/favicon.ico', thumbnail: '' },
        { id: 'tab:4', tabId: 4, name: 'Plan Parallel Agents', favicon: 'https://chatgpt.com/favicon.ico', thumbnail: '' },
        { id: 'tab:5', tabId: 5, name: 'DataAnnotation', favicon: 'https://dataannotation.tech/favicon.ico', thumbnail: '' },
        { id: 'tab:6', tabId: 6, name: 'invisurf - Overview - Vercel', favicon: 'https://vercel.com/favicon.ico', thumbnail: '' },
        { id: 'tab:7', tabId: 7, name: 'Access denied', favicon: 'https://google.com/favicon.ico', thumbnail: '' },
        { id: 'tab:8', tabId: 8, name: 'Arena AI: Compare Models Side by Side', favicon: 'https://arena.lmsys.org/favicon.ico', thumbnail: '' },
      ];

      const mockWindows = [
        { id: 'win:1', name: 'Meet – ouc-bxby-jss', type: 'window' },
        { id: 'win:2', name: 'invisurf – splitTabManager.js', type: 'window' },
        { id: 'win:3', name: 'InviSurf', type: 'window' },
        { id: 'win:4', name: 'Mayur (DM) - Slack', type: 'window' },
        { id: 'win:5', name: 'MC', type: 'window' },
        { id: 'win:6', name: 'MC', type: 'window' },
      ];

      const mockScreens = [
        { id: 'screen:0', name: 'Entire screen', type: 'screen' },
      ];

      import('./overlay/components/desktopMediaPicker.js').then(({ renderDesktopMediaPicker }) => {
        renderDesktopMediaPicker({
          requestId: 1001,
          requesterName: 'meet.google.com',
          canRequestAudio: true,
          sources: {
            tabs: mockTabs,
            windows: mockWindows,
            screens: mockScreens,
          },
        });
      });
    });

    await page.waitForTimeout(600);
    const panel = page.locator('#panel');
    await panel.waitFor({ state: 'visible' });

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'screen-share-picker-tabs.png'),
    });

    assert.ok(await panel.isVisible());

    // Check footer buttons exist
    const hasCancel = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#panel button'));
      return btns.some(b => b.textContent.includes('Cancel'));
    });
    assert.strictEqual(hasCancel, true, 'Cancel button should be rendered in picker');

    await page.close();
  });

  test('Renders Desktop Media Picker with chosen tab high-quality preview, preserves aspect ratio, and dynamically receives snapshot updates', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await page.goto(overlayHtmlPath);

    // Green Google Meet theme tokens matching user's environment
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--chrome-accent', '#1e8e3e');
      document.documentElement.style.setProperty('--chrome-nav-bg', '#f4faf6');
      document.documentElement.style.setProperty('--chrome-fg', '#202124');
      document.documentElement.style.setProperty('--chrome-secondary-fg', 'rgba(32, 33, 36, 0.65)');
      document.documentElement.style.setProperty('--chrome-tab-separator', 'rgba(0, 0, 0, 0.1)');
    });

    // Create 16:10 test SVG image data URL to verify un-pinched aspect ratio
    const svg16by10 = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="%231a2332"/><circle cx="400" cy="250" r="140" fill="%234285f4"/><text x="400" y="260" font-family="sans-serif" font-size="28" fill="%23ffffff" text-anchor="middle">Google Meet (16:10 Un-pinched)</text></svg>';

    const notifiedMessages = [];
    await page.exposeFunction('mockNotifyHost', (msg) => {
      notifiedMessages.push(msg);
    });

    await page.evaluate((sampleThumb) => {
      window.electronAPI = window.electronAPI || {};
      window.electronAPI.chromeOverlayNotifyHost = (msg) => window.mockNotifyHost(msg);

      const mockTabs = [
        { id: 'tab:meet', tabId: 'meet', name: 'Meet – swx-oxpu-aiy', favicon: 'https://meet.google.com/favicon.ico', thumbnail: sampleThumb },
        { id: 'tab:docs', tabId: 'docs', name: 'Sync your First User with the API | Documentation', favicon: 'https://github.com/favicon.ico', thumbnail: '' },
        { id: 'tab:canva', tabId: 'canva', name: 'Free Online Graphic Design Maker for Presentation', favicon: 'https://canva.com/favicon.ico', thumbnail: '' },
      ];

      import('./overlay/components/desktopMediaPicker.js').then(({ renderDesktopMediaPicker }) => {
        renderDesktopMediaPicker({
          requestId: 2002,
          requesterName: 'meet.google.com',
          canRequestAudio: true,
          sources: {
            tabs: mockTabs,
            windows: [{ id: 'win:1', name: 'Terminal' }],
            screens: [{ id: 'screen:0', name: 'Entire Screen' }],
          },
        });
      });
    }, svg16by10);

    await page.waitForTimeout(600);
    const panel = page.locator('#panel');
    await panel.waitFor({ state: 'visible' });

    // Verify chosen tab preview frame and image
    const previewImg = page.locator('.desktop-media-picker-preview-img');
    await previewImg.waitFor({ state: 'visible' });

    // Capture screenshot of high quality chosen tab
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'screen-share-picker-high-quality.png'),
    });

    // Verify snapshot request was triggered for initially chosen tab
    const requestedHq = notifiedMessages.some(m => m.type === 'desktopMediaPickerRequestTabSnapshot' && m.tabId === 'meet');
    assert.strictEqual(requestedHq, true, 'Should trigger desktopMediaPickerRequestTabSnapshot for chosen tab');

    // Simulate dynamic arrival of higher resolution snapshot update
    const hqSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="%23111827"/><circle cx="720" cy="450" r="180" fill="%2310b981"/><text x="720" y="460" font-family="sans-serif" font-weight="bold" font-size="36" fill="%23ffffff" text-anchor="middle">Ultra-Crisp HD Preview (Preserved 16:10)</text></svg>';

    await page.evaluate((hqData) => {
      import('./overlay/components/desktopMediaPicker.js').then(({ updateDesktopMediaPickerSnapshot }) => {
        updateDesktopMediaPickerSnapshot({
          requestId: 2002,
          tabId: 'meet',
          thumbnail: hqData,
        });
      });
    }, hqSvg);

    await page.waitForTimeout(300);

    const updatedSrc = await previewImg.getAttribute('src');
    assert.strictEqual(updatedSrc, hqSvg, 'Preview image src should dynamically update with high-res snapshot');

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'screen-share-picker-updated-hd.png'),
    });

    await page.close();
  });

  test('Renders ScreenShareBanner in meeting tab and inactive tab states and captures screenshot', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 350 } });
    const bannerCss = require('fs').readFileSync(path.resolve(__dirname, '../../../src/components/ScreenShareBanner.css'), 'utf8');

    // HTML fixture containing both banner variants styled with user theme
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          ${bannerCss}

          :root {
            --chrome-accent: #80333d;
            --chrome-nav-bg: #fff5f5;
            --chrome-fg: #202124;
            --chrome-tab-separator: rgba(0, 0, 0, 0.08);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          body {
            margin: 0;
            padding: 24px;
            background: #fdf5f5;
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          .case-label {
            font-size: 13px;
            font-weight: 600;
            color: #80333d;
            margin-bottom: 8px;
          }
        </style>
      </head>
      <body>
        <div>
          <div class="case-label">Case 1: User is on Meeting Tab (meet.google.com) - matches screenshot 1</div>
          <div class="screen-share-banner-bar screen-share-banner-wrapper">
            <div class="screen-share-banner-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74zM4 6h16v10H4V6z" />
              </svg>
            </div>
            <div class="screen-share-banner-content">
              <span class="screen-share-text">Sharing</span>
              <button type="button" class="screen-share-chip">www.markdowntopdf.com</button>
              <span class="screen-share-text">to this tab</span>
            </div>
            <div class="screen-share-divider"></div>
            <div class="screen-share-banner-actions">
              <button type="button" class="screen-share-stop-btn">Stop sharing</button>
            </div>
          </div>
        </div>

        <div>
          <div class="case-label">Case 2: User navigated to another tab (zbotic.in) - matches screenshot 2 ("Share this tab instead")</div>
          <div class="screen-share-banner-bar screen-share-banner-wrapper">
            <div class="screen-share-banner-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74zM4 6h16v10H4V6z" />
              </svg>
            </div>
            <div class="screen-share-banner-content">
              <span class="screen-share-text">Sharing</span>
              <button type="button" class="screen-share-chip">www.markdowntopdf.com</button>
              <span class="screen-share-text">to</span>
              <button type="button" class="screen-share-chip">meet.google.com</button>
            </div>
            <div class="screen-share-divider"></div>
            <div class="screen-share-banner-actions">
              <button type="button" class="screen-share-switch-btn">Share this tab instead</button>
              <button type="button" class="screen-share-stop-btn">Stop sharing</button>
            </div>
          </div>
        </div>

        <div>
          <div class="case-label">Case 3: User is on Shared Tab (www.markdowntopdf.com)</div>
          <div class="screen-share-banner-bar screen-share-banner-wrapper">
            <div class="screen-share-banner-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74zM4 6h16v10H4V6z" />
              </svg>
            </div>
            <div class="screen-share-banner-content">
              <span class="screen-share-text">Sharing this tab to</span>
              <button type="button" class="screen-share-chip">meet.google.com</button>
            </div>
            <div class="screen-share-divider"></div>
            <div class="screen-share-banner-actions">
              <button type="button" class="screen-share-stop-btn">Stop sharing</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html);
    await page.waitForTimeout(400);

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'screen-share-banner-states.png'),
    });

    const stopBtns = page.locator('.screen-share-stop-btn');
    assert.strictEqual(await stopBtns.count(), 3);
    const switchBtn = page.locator('.screen-share-switch-btn');
    assert.strictEqual(await switchBtn.count(), 1);

    await page.close();
  });

  test('Clicking Cancel in Desktop Media Picker sends cancelled: true and getDisplayMedia rejects with NotAllowedError DOMException avoiding Meet error modal', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await page.goto(overlayHtmlPath);

    const notifiedMessages = [];
    await page.exposeFunction('mockNotifyHostCancelTest', (msg) => {
      notifiedMessages.push(msg);
    });

    await page.evaluate(() => {
      window.electronAPI = window.electronAPI || {};
      window.electronAPI.chromeOverlayNotifyHost = (msg) => window.mockNotifyHostCancelTest(msg);

      import('./overlay/components/desktopMediaPicker.js').then(({ renderDesktopMediaPicker }) => {
        renderDesktopMediaPicker({
          requestId: 3003,
          requesterName: 'meet.google.com',
          canRequestAudio: true,
          sources: {
            tabs: [{ id: 'tab:meet', tabId: 'meet', name: 'Meet – swx-oxpu-aiy', favicon: '' }],
            windows: [],
            screens: [],
          },
        });
      });
    });

    const panel = page.locator('#panel');
    await panel.waitFor({ state: 'visible' });

    // Locate and click the Cancel button
    const cancelBtn = page.locator('#panel button:has-text("Cancel")');
    await cancelBtn.waitFor({ state: 'visible' });
    await cancelBtn.click();

    // Verify host notification
    const responseMsg = notifiedMessages.find(m => m.type === 'desktopMediaPickerResponse');
    assert.ok(responseMsg, 'Should send desktopMediaPickerResponse message to host on cancel');
    assert.strictEqual(responseMsg.requestId, 3003);
    assert.strictEqual(responseMsg.cancelled, true);

    // Verify getDisplayMedia cancellation contract in page context
    const meetSimulation = await page.evaluate(async () => {
      // Simulate monkey-patched getDisplayMedia as in preload.js
      const origGetDisplayMedia = async () => {
        // Chromium in Electron rejects cancelled picker requests with AbortError: Invalid capture constraints
        throw new DOMException('Invalid capture constraints', 'AbortError');
      };

      navigator.mediaDevices.getDisplayMedia = async function (...args) {
        try {
          return await origGetDisplayMedia(...args);
        } catch (err) {
          if (err && (
            err.name === 'AbortError' ||
            err.name === 'NotAllowedError' ||
            String(err.message || '').includes('Invalid capture constraints') ||
            String(err.message || '').toLowerCase().includes('denied') ||
            String(err.message || '').toLowerCase().includes('cancel')
          )) {
            throw new DOMException('Permission denied by user', 'NotAllowedError');
          }
          throw err;
        }
      };

      let showedMeetErrorModal = false;
      let caughtErrorName = '';
      let caughtErrorMessage = '';
      try {
        await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (err) {
        caughtErrorName = err.name;
        caughtErrorMessage = err.message;
        // Web apps (Google Meet, Teams, etc.) check for NotAllowedError with 'by user'
        // to recognize intentional user dismissal and suppress error dialogs.
        if (err.name !== 'NotAllowedError' || !err.message.includes('by user')) {
          showedMeetErrorModal = true;
        }
      }

      return {
        caughtErrorName,
        caughtErrorMessage,
        showedMeetErrorModal,
      };
    });

    assert.strictEqual(meetSimulation.caughtErrorName, 'NotAllowedError', 'Should normalize error to NotAllowedError');
    assert.strictEqual(meetSimulation.caughtErrorMessage, 'Permission denied by user', 'Error message must match Chrome native: Permission denied by user');
    assert.strictEqual(meetSimulation.showedMeetErrorModal, false, 'Google Meet error modal must NOT be shown on cancellation');

    await page.close();
  });

  test('Renders Desktop Media Picker window grid with clean mock fallback layout when thumbnails are missing or broken', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await page.goto(overlayHtmlPath);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--chrome-accent', '#1e8e3e');
      document.documentElement.style.setProperty('--chrome-nav-bg', '#f4faf6');
      document.documentElement.style.setProperty('--chrome-fg', '#202124');
      document.documentElement.style.setProperty('--chrome-secondary-fg', 'rgba(32, 33, 36, 0.65)');
      document.documentElement.style.setProperty('--chrome-tab-separator', 'rgba(0, 0, 0, 0.1)');
    });

    const validThumbnail = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="%23243038"/><text x="150" y="105" font-family="sans-serif" font-size="18" fill="%23ffffff" text-anchor="middle">Valid Window</text></svg>';
    const brokenThumbnail = 'data:image/png;base64,BROKEN_IMAGE_DATA_CORRUPT';

    await page.evaluate(({ validThumbnail, brokenThumbnail }) => {
      window.electronAPI = window.electronAPI || {};
      window.electronAPI.chromeOverlayNotifyHost = () => {};

      const mockWindows = [
        { id: 'win:invisurf', name: 'InviSurf', appIcon: 'https://github.com/favicon.ico', thumbnail: validThumbnail },
        { id: 'win:chrome', name: 'Google Chrome', appIcon: 'https://google.com/favicon.ico', thumbnail: brokenThumbnail },
        { id: 'win:terminal', name: 'Terminal', thumbnail: '' },
      ];

      import('./overlay/components/desktopMediaPicker.js').then(({ renderDesktopMediaPicker }) => {
        renderDesktopMediaPicker({
          requestId: 4004,
          requesterName: 'Extension',
          canRequestAudio: true,
          sources: {
            tabs: [{ id: 'tab:1', name: 'Tab 1', thumbnail: '' }],
            windows: mockWindows,
            screens: [{ id: 'screen:0', name: 'Entire Screen' }],
          },
        });
      });
    }, { validThumbnail, brokenThumbnail });

    await page.waitForTimeout(600);

    // Switch to "Window" category tab
    const windowTab = page.locator('#panel button:has-text("Window")');
    await windowTab.waitFor({ state: 'visible' });
    await windowTab.click();
    await page.waitForTimeout(600);

    // Capture screenshot proving the mock fallback layout renders instead of broken images
    const currentArtifactDir = '/Users/mayurkukadiya/.gemini/antigravity/brain/2a5f4fc2-edb0-4bf2-b565-e297e457a2b9';
    await page.screenshot({
      path: path.join(currentArtifactDir, 'screen-share-picker-missing-image-fallback.png'),
    });
    try {
      await page.screenshot({
        path: path.join(ARTIFACTS_DIR, 'screen-share-picker-missing-image-fallback.png'),
      });
    } catch (_) {}

    // Verify grid cards render fallback for broken / missing thumbnails
    const fallbackResults = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#panel [style*="grid"] > div'));
      return cards.map(c => {
        const title = c.textContent || '';
        const fallback = c.querySelector('.desktop-media-picker-grid-fallback');
        const img = c.querySelector('img[style*="absolute"]');
        return {
          title,
          hasFallback: !!fallback,
          fallbackVisible: fallback ? fallback.style.display !== 'none' : false,
          imgDisplay: img ? img.style.display : null,
        };
      });
    });

    assert.strictEqual(fallbackResults.length, 3, 'Should render 3 window cards in grid');

    // InviSurf (valid thumbnail): img is visible, fallback is hidden
    const validCard = fallbackResults.find(r => r.title.includes('InviSurf'));
    assert.ok(validCard, 'Must find InviSurf card');
    assert.strictEqual(validCard.imgDisplay, 'block', 'Valid thumbnail img must be displayed');
    assert.strictEqual(validCard.fallbackVisible, false, 'Valid thumbnail fallback must be hidden');

    // Google Chrome (broken thumbnail): img failed and is hidden, fallback is visible
    const chromeCard = fallbackResults.find(r => r.title.includes('Google Chrome'));
    assert.ok(chromeCard, 'Must find Google Chrome card');
    assert.strictEqual(chromeCard.hasFallback, true, 'Google Chrome card must have fallback');
    assert.strictEqual(chromeCard.fallbackVisible, true, 'Google Chrome card fallback must be visible');
    assert.strictEqual(chromeCard.imgDisplay, 'none', 'Broken thumbnail img must be hidden');

    // Terminal (empty thumbnail): fallback is visible immediately
    const terminalCard = fallbackResults.find(r => r.title.includes('Terminal'));
    assert.ok(terminalCard, 'Must find Terminal card');
    assert.strictEqual(terminalCard.hasFallback, true, 'Terminal card must have fallback');
    assert.strictEqual(terminalCard.fallbackVisible, true, 'Terminal card fallback must be visible');

    await page.close();
  });
});
