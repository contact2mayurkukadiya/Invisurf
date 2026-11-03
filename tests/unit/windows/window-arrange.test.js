const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { calculateWindowArrangeBounds, arrangeWindow } = require('../../../main/windows/windowManager');
const overlayManager = require('../../../main/windows/overlayManager');
const { DEFAULT_SHORTCUTS, SHELL_MENU_OVERLAY_KINDS } = require('../../../main/constants/defaults');

describe('Window Arrangement Sizing, Bounds & Presets', () => {
  after(() => {
    env.cleanup();
  });
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  test('calculateWindowArrangeBounds returns correct bounds for all halves', () => {
    const left = calculateWindowArrangeBounds(workArea, 'leftHalf');
    assert.deepEqual(left, { x: 0, y: 25, width: 720, height: 875 });

    const right = calculateWindowArrangeBounds(workArea, 'rightHalf');
    assert.deepEqual(right, { x: 720, y: 25, width: 720, height: 875 });

    const center = calculateWindowArrangeBounds(workArea, 'centerHalf');
    assert.deepEqual(center, { x: 360, y: 25, width: 720, height: 875 });

    const top = calculateWindowArrangeBounds(workArea, 'topHalf');
    assert.deepEqual(top, { x: 0, y: 25, width: 1440, height: 438 });

    const bottom = calculateWindowArrangeBounds(workArea, 'bottomHalf');
    assert.deepEqual(bottom, { x: 0, y: 463, width: 1440, height: 437 });
  });

  test('calculateWindowArrangeBounds returns correct bounds for all quarters', () => {
    const tl = calculateWindowArrangeBounds(workArea, 'topLeft');
    assert.deepEqual(tl, { x: 0, y: 25, width: 720, height: 438 });

    const tr = calculateWindowArrangeBounds(workArea, 'topRight');
    assert.deepEqual(tr, { x: 720, y: 25, width: 720, height: 438 });

    const bl = calculateWindowArrangeBounds(workArea, 'bottomLeft');
    assert.deepEqual(bl, { x: 0, y: 463, width: 720, height: 437 });

    const br = calculateWindowArrangeBounds(workArea, 'bottomRight');
    assert.deepEqual(br, { x: 720, y: 463, width: 720, height: 437 });
  });

  test('calculateWindowArrangeBounds returns correct bounds for all thirds', () => {
    const firstThird = calculateWindowArrangeBounds(workArea, 'firstThird');
    assert.deepEqual(firstThird, { x: 0, y: 25, width: 480, height: 875 });

    const centerThird = calculateWindowArrangeBounds(workArea, 'centerThird');
    assert.deepEqual(centerThird, { x: 480, y: 25, width: 480, height: 875 });

    const lastThird = calculateWindowArrangeBounds(workArea, 'lastThird');
    assert.deepEqual(lastThird, { x: 960, y: 25, width: 480, height: 875 });

    const firstTwo = calculateWindowArrangeBounds(workArea, 'firstTwoThirds');
    assert.deepEqual(firstTwo, { x: 0, y: 25, width: 960, height: 875 });

    const lastTwo = calculateWindowArrangeBounds(workArea, 'lastTwoThirds');
    assert.deepEqual(lastTwo, { x: 480, y: 25, width: 960, height: 875 });
  });

  test('arrangeWindow applies bounds to BrowserWindow', () => {
    let capturedBounds = null;
    let unmaximized = false;
    let fullscreenExited = false;

    const mockWin = {
      isDestroyed: () => false,
      isFullScreen: () => true,
      setFullScreen: (fsVal) => { if (!fsVal) fullscreenExited = true; },
      isMaximized: () => true,
      unmaximize: () => { unmaximized = true; },
      isMinimized: () => false,
      getBounds: () => ({ x: 100, y: 100, width: 800, height: 600 }),
      setBounds: (b) => { capturedBounds = b; },
    };

    const ok = arrangeWindow(mockWin, 'leftHalf');
    assert.equal(ok, true);
    assert.equal(unmaximized, true);
    assert.equal(fullscreenExited, true);
    assert.ok(capturedBounds);
    assert.equal(capturedBounds.width, Math.round(capturedBounds.width));
  });

  test('SHELL_MENU_OVERLAY_KINDS includes windowArrangeMenu', () => {
    assert.equal(SHELL_MENU_OVERLAY_KINDS.has('windowArrangeMenu'), true);
  });

  test('computeMenuOverlayBounds accommodates windowArrangeMenu', () => {
    const mockContext = {
      window: {
        isDestroyed: () => false,
        getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      },
    };
    const bounds = overlayManager.computeMenuOverlayBounds(mockContext, {
      kind: 'windowArrangeMenu',
      anchorRect: { left: 900, top: 40, width: 32, height: 32 },
    });
    assert.ok(bounds);
    assert.ok(bounds.width >= 260);
    assert.ok(bounds.height >= 400);
  });

  test('SHORTCUT_DEFINITIONS includes Window Arrangement category with 14 items', () => {
    const settingsSrc = fs.readFileSync(path.join(__dirname, '../../../src/constants/settings.js'), 'utf8');
    assert.match(settingsSrc, /category:\s*'Window Arrangement'/, 'Window Arrangement category exists in settings.js');

    const expectedIds = [
      'windowArrangeLeftHalf',
      'windowArrangeRightHalf',
      'windowArrangeCenterHalf',
      'windowArrangeTopHalf',
      'windowArrangeBottomHalf',
      'windowArrangeTopLeft',
      'windowArrangeTopRight',
      'windowArrangeBottomLeft',
      'windowArrangeBottomRight',
      'windowArrangeFirstThird',
      'windowArrangeCenterThird',
      'windowArrangeLastThird',
      'windowArrangeFirstTwoThirds',
      'windowArrangeLastTwoThirds',
    ];

    for (const id of expectedIds) {
      assert.match(settingsSrc, new RegExp(`id:\\s*'${id}'`), `settings.js includes ${id}`);
      assert.ok(DEFAULT_SHORTCUTS[id], `DEFAULT_SHORTCUTS includes ${id}`);
    }
  });

  test('shortcutUtils source formats arrows with compact triangle symbols on Mac', () => {
    const utilsSrc = fs.readFileSync(path.join(__dirname, '../../../src/utils/shortcutUtils.js'), 'utf8');
    assert.match(utilsSrc, /triangles \? '▲' : '↑'/, 'shortcutUtils formats Up arrow');
    assert.match(utilsSrc, /triangles \? '▼' : '↓'/, 'shortcutUtils formats Down arrow');
    assert.match(utilsSrc, /triangles \? '◀' : '←'/, 'shortcutUtils formats Left arrow');
    assert.match(utilsSrc, /triangles \? '▶' : '→'/, 'shortcutUtils formats Right arrow');
  });
});
