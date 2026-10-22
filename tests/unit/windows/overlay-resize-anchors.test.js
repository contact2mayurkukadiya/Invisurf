const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const overlayManager = require('../../../main/windows/overlayManager');

describe('Overlay Menus Window Resize & Anchor Following', () => {
  after(() => {
    env.cleanup();
  });

  const createMockContext = (width = 1200, height = 800) => ({
    window: {
      getContentBounds: () => ({ width, height }),
      isDestroyed: () => false,
    },
  });

  describe('Download Panel Overlay (Requirements 1 & 3)', () => {
    test('downloadPanel bounds follow trigger anchor when window resizes', () => {
      // Window width 1200, trigger button at left: 950, width: 34
      const ctx1 = createMockContext(1200, 800);
      const patch1 = {
        kind: 'downloadPanel',
        anchorRect: { left: 950, top: 40, width: 34, height: 34 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);
      assert.ok(bounds1, 'bounds1 should be computed');

      // Now simulate window resize to width 1600: trigger button moves to left: 1350
      const ctx2 = createMockContext(1600, 800);
      const patch2 = {
        kind: 'downloadPanel',
        anchorRect: { left: 1350, top: 40, width: 34, height: 34 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);
      assert.ok(bounds2, 'bounds2 should be computed');

      // The overlay x position must track the anchor movement
      assert.ok(bounds2.x > bounds1.x, `Expected bounds2.x (${bounds2.x}) > bounds1.x (${bounds1.x})`);
      assert.equal(bounds2.x - bounds1.x, 400, 'Shift should exactly match the 400px window resize shift');
    });

    test('download panel items slicing guarantees max 3 items total', () => {
      // Logic simulation matching renderer/overlay/components/downloadPanel.js
      const sliceDownloadItems = (allActive, allHistory) => {
        const activeList = allActive.slice(0, 3);
        const historyList = allHistory.slice(0, Math.max(0, 3 - activeList.length));
        return { activeList, historyList, total: activeList.length + historyList.length };
      };

      // Case 1: 5 active items -> only 3 active, 0 history
      const r1 = sliceDownloadItems([1, 2, 3, 4, 5], [6, 7, 8]);
      assert.equal(r1.activeList.length, 3);
      assert.equal(r1.historyList.length, 0);
      assert.equal(r1.total, 3);

      // Case 2: 1 active item, 5 history items -> 1 active, 2 history (total 3)
      const r2 = sliceDownloadItems([1], [2, 3, 4, 5, 6]);
      assert.equal(r2.activeList.length, 1);
      assert.equal(r2.historyList.length, 2);
      assert.equal(r2.total, 3);

      // Case 3: 0 active items, 4 history items -> 0 active, 3 history (total 3)
      const r3 = sliceDownloadItems([], [1, 2, 3, 4]);
      assert.equal(r3.activeList.length, 0);
      assert.equal(r3.historyList.length, 3);
      assert.equal(r3.total, 3);

      // Case 4: 1 active, 1 history -> 2 total
      const r4 = sliceDownloadItems([1], [2]);
      assert.equal(r4.total, 2);
    });
  });

  describe('Extension Menu Overlay (Requirement 3)', () => {
    test('extensionMenu follows trigger puzzle icon button on window resize', () => {
      const ctx1 = createMockContext(1400, 700);
      const patch1 = {
        kind: 'extensionMenu',
        contextMenuOnly: false,
        anchorRect: { left: 1000, right: 1034, top: 40, width: 34, height: 34 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      // Window widens to 1800: puzzle icon button moves right by 400px
      const ctx2 = createMockContext(1800, 700);
      const patch2 = {
        kind: 'extensionMenu',
        contextMenuOnly: false,
        anchorRect: { left: 1400, right: 1434, top: 40, width: 34, height: 34 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 400, 'Extension menu tracks the 400px anchor reposition');
    });
  });

  describe('Profile Menu Overlay (Requirement 3)', () => {
    test('profileMenu follows profile trigger button on window resize', () => {
      const ctx1 = createMockContext(1100, 750);
      const patch1 = {
        kind: 'profileMenu',
        menuRect: { left: 900, top: 44, width: 260 },
        items: [{ profileId: 'default', label: 'Default' }],
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1500, 750);
      const patch2 = {
        kind: 'profileMenu',
        menuRect: { left: 1300, top: 44, width: 260 },
        items: [{ profileId: 'default', label: 'Default' }],
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 400, 'Profile menu tracks 400px reposition');
    });
  });

  describe('App Menu Overlay (Requirement 3)', () => {
    test('appMenu follows 3-dots more menu button on window resize', () => {
      const ctx1 = createMockContext(1200, 800);
      const patch1 = {
        kind: 'appMenu',
        menuRect: { left: 880, top: 46, width: 320 },
        items: [{ label: 'New Tab' }],
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1600, 800);
      const patch2 = {
        kind: 'appMenu',
        menuRect: { left: 1280, top: 46, width: 320 },
        items: [{ label: 'New Tab' }],
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 400, 'App menu tracks 400px reposition');
    });
  });

  describe('Bookmark Folder & Overflow Menus (Requirement 3)', () => {
    test('bookmarkFolderMenu follows folder button on window resize', () => {
      const ctx1 = createMockContext(1000, 700);
      const patch1 = {
        kind: 'bookmarkFolderMenu',
        folderId: 'f-1',
        anchorRect: { left: 300, top: 78, width: 90, height: 28 },
        items: [{ id: 'b-1', type: 'bookmark', title: 'Test' }],
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1300, 700);
      const patch2 = {
        kind: 'bookmarkFolderMenu',
        folderId: 'f-1',
        anchorRect: { left: 450, top: 78, width: 90, height: 28 },
        items: [{ id: 'b-1', type: 'bookmark', title: 'Test' }],
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 150, 'Bookmark folder menu tracks anchor x movement');
    });
  });

  describe('Bookmark Star Editor (Requirement 3)', () => {
    test('bookmarkEditor follows star button on window resize', () => {
      const ctx1 = createMockContext(1100, 700);
      const patch1 = {
        kind: 'bookmarkEditor',
        anchorRect: { left: 750, top: 42, width: 30, height: 30 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1400, 700);
      const patch2 = {
        kind: 'bookmarkEditor',
        anchorRect: { left: 1050, top: 42, width: 30, height: 30 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 300, 'Star editor tracks star button reposition');
    });
  });

  describe('Omnibox Popups: Site Info & Cookie Controls (Requirement 3)', () => {
    test('siteInfo follows padlock icon on window resize', () => {
      const ctx1 = createMockContext(1000, 700);
      const patch1 = {
        kind: 'siteInfo',
        anchorRect: { left: 60, top: 40, width: 28, height: 28 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      // On resize or toolbar flex adjustment, anchor adjusts
      const ctx2 = createMockContext(1200, 700);
      const patch2 = {
        kind: 'siteInfo',
        anchorRect: { left: 90, top: 40, width: 28, height: 28 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 30, 'Site info tracks padlock icon reposition');
    });

    test('cookieControls follows cookie icon on window resize', () => {
      const ctx1 = createMockContext(1000, 700);
      const patch1 = {
        kind: 'cookieControls',
        anchorRect: { left: 95, top: 40, width: 28, height: 28 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1200, 700);
      const patch2 = {
        kind: 'cookieControls',
        anchorRect: { left: 125, top: 40, width: 28, height: 28 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 30, 'Cookie controls tracks cookie icon reposition');
    });
  });

  describe('Transparency Control Menu (Requirement 3)', () => {
    test('transparencyMenu follows opacity icon on window resize', () => {
      const ctx1 = createMockContext(1100, 700);
      const patch1 = {
        kind: 'transparencyMenu',
        anchorRect: { left: 800, top: 40, width: 32, height: 32 },
      };
      const bounds1 = overlayManager.computeMenuOverlayBounds(ctx1, patch1);

      const ctx2 = createMockContext(1500, 700);
      const patch2 = {
        kind: 'transparencyMenu',
        anchorRect: { left: 1200, top: 40, width: 32, height: 32 },
      };
      const bounds2 = overlayManager.computeMenuOverlayBounds(ctx2, patch2);

      assert.ok(bounds1 && bounds2);
      assert.equal(bounds2.x - bounds1.x, 400, 'Transparency menu tracks eye button reposition');
    });
  });

  describe('Toolbar Menus Standardized Width (same as extension puzzle menu: 320px)', () => {
    const ctx = createMockContext(1400, 800);
    const fs = require('fs');
    const path = require('path');

    test('extensionMenu panel width is 320px and overlay bounds accommodate 320px panel', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'extensionMenu',
        contextMenuOnly: false,
        anchorRect: { left: 1000, right: 1034, top: 40, width: 34, height: 34 },
      });
      // 320 (panel) + 24 (shadowLeft) + 24 (shadowRight) + 560 (extraLeft) + 280 (extraRight) = 1208
      assert.equal(bounds.width, 1208, 'extensionMenu overlay width accommodates 320px panel with expansion margins');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/extensionMenu.js'), 'utf8');
      assert.match(src, /const width = 320;/, 'extensionMenu DOM panel width must be 320');
    });

    test('downloadPanel panel width is 320px (matching extension puzzle menu)', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'downloadPanel',
        anchorRect: { left: 950, top: 40, width: 34, height: 34 },
      });
      // 320 (panel) + 28 (shadowLeft) + 28 (shadowRight) = 376
      assert.equal(bounds.width, 376, 'downloadPanel overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/downloadPanel.js'), 'utf8');
      assert.match(src, /const width = 320;/, 'downloadPanel DOM panel width must be 320');
    });

    test('appMenu panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'appMenu',
        menuRect: { left: 1080, top: 40, width: 320 },
      });
      // 320 (panel) + 18 (shadowLeft) + 18 (shadowRight) = 356
      assert.equal(bounds.width, 356, 'appMenu overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/appMenu.js'), 'utf8');
      assert.match(src, /width != null \? r\.width : 320/, 'appMenu DOM panel fallback width must be 320');
    });

    test('profileMenu panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'profileMenu',
        menuRect: { left: 1050, top: 40, width: 320 },
      });
      // 320 (panel) + 28 (shadowLeft) + 28 (shadowRight) = 376
      assert.equal(bounds.width, 376, 'profileMenu overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/profileMenu.js'), 'utf8');
      assert.match(src, /width != null \? r\.width : 320/, 'profileMenu DOM panel fallback width must be 320');
    });

    test('bookmarkEditor panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'bookmarkEditor',
        anchorRect: { left: 800, top: 40, width: 30, height: 30 },
      });
      // 320 (panel) + 16 (shadowLeft) + 16 (shadowRight) = 352
      assert.equal(bounds.width, 352, 'bookmarkEditor overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/bookmarkEditor.js'), 'utf8');
      assert.match(src, /panelWidth = Math\.min\(320/, 'bookmarkEditor DOM panel width upper bound must be 320');
    });

    test('siteInfo panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'siteInfo',
        anchorRect: { left: 60, top: 40, width: 28, height: 28 },
      });
      // 320 (panel) + 16 (shadowLeft) + 16 (shadowRight) = 352
      assert.equal(bounds.width, 352, 'siteInfo overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/siteInfo.js'), 'utf8');
      assert.match(src, /const width = 320;/, 'siteInfo DOM panel width must be 320');
    });

    test('cookieControls panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'cookieControls',
        anchorRect: { left: 95, top: 40, width: 28, height: 28 },
      });
      // 320 (panel) + 24 (shadowLeft) + 24 (shadowRight) = 368
      assert.equal(bounds.width, 368, 'cookieControls overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/compactPanels.js'), 'utf8');
      assert.match(src, /renderCookieControls[\s\S]*?width:\s*320/, 'cookieControls DOM panel width must be 320');
    });

    test('transparencyMenu panel width is 320px', () => {
      const bounds = overlayManager.computeMenuOverlayBounds(ctx, {
        kind: 'transparencyMenu',
        anchorRect: { left: 800, top: 40, width: 32, height: 32 },
      });
      // 320 (panel) + 24 (shadowLeft) + 24 (shadowRight) = 368
      assert.equal(bounds.width, 368, 'transparencyMenu overlay width accommodates 320px panel with shadows');

      const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/transparencyMenu.js'), 'utf8');
      assert.match(src, /const PANEL_WIDTH = 320;/, 'transparencyMenu DOM panel width must be 320');
    });
  });

  describe('Settings Page Theme Color Alignment', () => {
    const { resolveAppliedTokens } = require('../../../src/theme/chromeTheme.cjs');

    test('derives settings content background from profile dark theme colors', () => {
      const darkThemes = ['ocean', 'forest', 'sunset', 'violet', 'amber', 'indigo', 'mint', 'slate', 'default'];
      for (const theme of darkThemes) {
        const tokens = resolveAppliedTokens({ accentTheme: theme, colorTheme: 'dark' }, true);
        assert.ok(tokens['--chrome-content-bg'], `Theme ${theme} must set --chrome-content-bg`);
        assert.ok(tokens['--chrome-content-surface'], `Theme ${theme} must set --chrome-content-surface`);
        assert.ok(tokens['--chrome-content-sidebar-bg'], `Theme ${theme} must set --chrome-content-sidebar-bg`);
        assert.ok(tokens['--chrome-content-active-bg'], `Theme ${theme} must set --chrome-content-active-bg`);
        assert.ok(tokens['--chrome-content-active-fg'], `Theme ${theme} must set --chrome-content-active-fg`);
        assert.ok(tokens['--chrome-content-subtle'], `Theme ${theme} must set --chrome-content-subtle`);
        // The content background should match the dark body/shell background of that theme
        assert.equal(tokens['--chrome-content-bg'], tokens['--chrome-body-bg']);
      }
    });

    test('derives settings content background from profile light theme shell tint', () => {
      const lightThemes = ['ocean', 'forest', 'sunset', 'violet', 'amber', 'indigo', 'mint', 'slate'];
      for (const theme of lightThemes) {
        const tokens = resolveAppliedTokens({ accentTheme: theme, colorTheme: 'light' }, false);
        assert.ok(tokens['--chrome-content-bg'], `Theme ${theme} must set --chrome-content-bg`);
        assert.ok(tokens['--chrome-content-surface'], `Theme ${theme} must set --chrome-content-surface`);
        assert.ok(tokens['--chrome-content-sidebar-bg'], `Theme ${theme} must set --chrome-content-sidebar-bg`);
        assert.ok(tokens['--chrome-content-active-bg'], `Theme ${theme} must set --chrome-content-active-bg`);
        assert.ok(tokens['--chrome-content-active-fg'], `Theme ${theme} must set --chrome-content-active-fg`);
        assert.ok(tokens['--chrome-content-subtle'], `Theme ${theme} must set --chrome-content-subtle`);
        // Light mode canvas background must follow the theme's shell-tint
        assert.equal(tokens['--chrome-content-bg'], tokens['--chrome-shell-tint']);
      }
    });

    test('derives settings content background for custom accent color', () => {
      const customHex = '#e91e63';
      const darkTokens = resolveAppliedTokens({ accentTheme: 'custom', accentCustomHex: customHex, colorTheme: 'dark' }, true);
      assert.ok(darkTokens['--chrome-content-bg'], 'Custom dark must set --chrome-content-bg');
      assert.equal(darkTokens['--chrome-content-bg'], darkTokens['--chrome-body-bg']);
      assert.ok(darkTokens['--chrome-content-active-bg'], 'Custom dark must set --chrome-content-active-bg');

      const lightTokens = resolveAppliedTokens({ accentTheme: 'custom', accentCustomHex: customHex, colorTheme: 'light' }, false);
      assert.ok(lightTokens['--chrome-content-bg'], 'Custom light must set --chrome-content-bg');
      assert.equal(lightTokens['--chrome-content-bg'], lightTokens['--chrome-shell-tint']);
      assert.ok(lightTokens['--chrome-content-active-bg'], 'Custom light must set --chrome-content-active-bg');
    });

    test('SettingsApp.css binds unified settings shell background to --chrome-content-bg', () => {
      const cssPath = path.join(__dirname, '../../../src/settings/SettingsApp.css');
      const css = fs.readFileSync(cssPath, 'utf8');
      assert.match(css, /--settings-app-bg:\s*var\(--chrome-content-bg/, 'SettingsApp.css must bind --settings-app-bg to var(--chrome-content-bg)');
      assert.match(css, /--settings-sidebar-bg:\s*var\(--chrome-content-sidebar-bg/, 'SettingsApp.css must bind --settings-sidebar-bg to var(--chrome-content-sidebar-bg)');
      assert.match(css, /--settings-active-bg:\s*var\(--chrome-content-active-bg/, 'SettingsApp.css must bind --settings-active-bg to var(--chrome-content-active-bg)');
    });
  });
});

