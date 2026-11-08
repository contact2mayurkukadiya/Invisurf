'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('New Tab Page Omnibox Instant Focus', () => {
  test('main/ui/shortcuts.js focuses shell WebContents immediately on newTab shortcut', () => {
    const shortcutsSource = fs.readFileSync(
      path.join(__dirname, '../../../main/ui/shortcuts.js'),
      'utf8'
    );
    assert.match(
      shortcutsSource,
      /matchesShortcut\(input,\s*shortcuts\.newTab\)/,
      'shortcuts.js must match newTab'
    );
    assert.match(
      shortcutsSource,
      /shell\.focus\(\)/,
      'shortcuts.js must immediately focus the shell webContents on newTab'
    );
  });

  test('main/windows/tabManager.js calls sendOmniboxFocusToShell when activating blank/NTP tab', () => {
    const tabManagerSource = fs.readFileSync(
      path.join(__dirname, '../../../main/windows/tabManager.js'),
      'utf8'
    );
    assert.match(
      tabManagerSource,
      /if\s*\(blankActive\s*&&\s*!context\.isInitialGhostSpawn\)\s*\{[\s\S]*?sendOmniboxFocusToShell\(context,\s*id,\s*false,\s*false\);/,
      'tabManager.js must invoke sendOmniboxFocusToShell when activating a blank/NTP tab'
    );
  });

  test('useOmniboxController.js activates omnibox focus and suppresses premature overlay on new tab', () => {
    const controllerSource = fs.readFileSync(
      path.join(__dirname, '../../../src/components/omnibox/useOmniboxController.js'),
      'utf8'
    );
    assert.match(
      controllerSource,
      /if\s*\(!currentTabId\s*\|\|\s*!tab\?\.isNewTab\)\s*return\s*undefined;[\s\S]*?aOnlyFocusUntilUserEditRef\.current\s*=\s*true;[\s\S]*?suppressOverlayOnNextAFocusRef\.current\s*=\s*true;[\s\S]*?setIsFocused\(true\);/,
      'useOmniboxController must set aOnlyFocusUntilUserEditRef, suppressOverlayOnNextAFocusRef, and setIsFocused(true) on blank tab'
    );
    assert.match(
      controllerSource,
      /input\.focus\(\{\s*preventScroll:\s*true\s*\}\);/,
      'useOmniboxController must focus input synchronously'
    );
  });

  test('useOmniboxController.js onRequestFocus applies focus immediately without double RAF delay', () => {
    const controllerSource = fs.readFileSync(
      path.join(__dirname, '../../../src/components/omnibox/useOmniboxController.js'),
      'utf8'
    );
    assert.match(
      controllerSource,
      /const\s+applyFocus\s*=\s*\(\)\s*=>\s*\{[\s\S]*?input\.focus\(\{ preventScroll: true \}\);[\s\S]*?applyFocus\(\);[\s\S]*?requestAnimationFrame\(applyFocus\);/,
      'onRequestFocus must apply focus synchronously and schedule one fallback RAF'
    );
  });
});
