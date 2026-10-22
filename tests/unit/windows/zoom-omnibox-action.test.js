const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Zoom Omnibox Action & Overlay Panel', () => {
  test('omniboxActions source includes zoom-reset logic and conditions', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../src/components/omnibox/omniboxActions.js'), 'utf8');
    assert.match(src, /zoom-reset/, 'omniboxActions must register zoom-reset action');
    assert.match(src, /isZoomed/, 'omniboxActions must check if zoom is not 100%');
    assert.match(src, /zoomType:\s*currentZoom < 1\.0 \? 'zoom-out' : 'zoom-in'/, 'omniboxActions must differentiate zoom-out and zoom-in');
    assert.match(src, /opensPopup:\s*OMNIBOX_POPUP\.ZOOM/, 'omniboxActions must open ZOOM popup');
  });

  test('OmniboxSuffix renders minus and plus magnifier SVG icons', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../src/components/omnibox/OmniboxSuffix.jsx'), 'utf8');
    assert.match(src, /action\.zoomType === 'zoom-out'/, 'OmniboxSuffix must check zoom-out');
    assert.match(src, /action\.zoomType === 'zoom-in'/, 'OmniboxSuffix must check zoom-in');
    assert.match(src, /circle cx="10\.5" cy="10\.5"/, 'OmniboxSuffix renders magnifier circle');
  });

  test('zoomReset overlay component handles minus, plus, and reset actions', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/components/zoomReset.js'), 'utf8');
    assert.match(src, /tabZoomOut/, 'zoomReset component must invoke tabZoomOut');
    assert.match(src, /tabZoomIn/, 'zoomReset component must invoke tabZoomIn');
    assert.match(src, /tabZoomReset/, 'zoomReset component must invoke tabZoomReset');
    assert.match(src, /co-zoom-reset-btn/, 'zoomReset component must render reset button');
    assert.match(src, /co-zoom-percent/, 'zoomReset component must render percentage label');
  });

  test('menus.css contains zoom bubble styles matching design requirements', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../renderer/overlay/styles/menus.css'), 'utf8');
    assert.match(src, /\.co-panel--zoom-bubble/, 'menus.css must define .co-panel--zoom-bubble');
    assert.match(src, /\.co-zoom-reset-btn/, 'menus.css must define .co-zoom-reset-btn');
    assert.match(src, /\.co-zoom-btn/, 'menus.css must define .co-zoom-btn');
    assert.match(src, /\.co-zoom-percent/, 'menus.css must define .co-zoom-percent');
  });
});
