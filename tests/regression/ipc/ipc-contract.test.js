'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C_CJS = require('../../../src/constants/conditionStrings.cjs');

describe('IPC Contract Regression', () => {
  test('conditionStrings.cjs defines critical IPC events', () => {
    assert.ok(C_CJS.IPC_EVENT, 'IPC_EVENT must be defined');
    assert.ok(C_CJS.IPC_EVENT.THEME_APPLY, 'THEME_APPLY event channel must exist');
    assert.ok(C_CJS.IPC_EVENT.CHROME_OVERLAY_PATCH, 'CHROME_OVERLAY_PATCH event channel must exist');
  });

  test('conditionStrings.cjs defines critical IPC invoke channels', () => {
    assert.ok(C_CJS.IPC_INVOKE, 'IPC_INVOKE must be defined');
    assert.ok(C_CJS.IPC_INVOKE.SETTINGS_UPDATE, 'SETTINGS_UPDATE invoke channel must exist');
  });

  test('conditionStrings.cjs defines encryption storage modes', () => {
    assert.ok(C_CJS.ENCRYPTION_STORAGE);
    assert.equal(C_CJS.ENCRYPTION_STORAGE.SAFE_STORAGE, 'safeStorage');
    assert.equal(C_CJS.ENCRYPTION_STORAGE.FALLBACK, 'fallback');
  });

  test('conditionStrings.cjs defines window and tab platforms', () => {
    assert.ok(C_CJS.PLATFORM);
    assert.equal(C_CJS.PLATFORM.DARWIN, 'darwin');
    assert.equal(C_CJS.PLATFORM.WIN32, 'win32');
  });
});
