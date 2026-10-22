'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildSecureWebPreferences, buildExtensionWebPreferences, DEFAULT_PRELOAD } = require('../../../runtime/webPreferences');

describe('Runtime Secure WebPreferences', () => {
  test('enforces strict enterprise sandbox defaults', () => {
    const prefs = buildSecureWebPreferences();

    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.enableRemoteModule, false);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegrationInSubFrames, false);
    assert.equal(prefs.preload, DEFAULT_PRELOAD);
    assert.ok(DEFAULT_PRELOAD.endsWith('preload.js'));
    assert.equal(prefs.partition, undefined);
  });

  test('attaches partition string when specified', () => {
    const prefs = buildSecureWebPreferences({ partition: 'persist:profile-work' });
    assert.equal(prefs.partition, 'persist:profile-work');

    const nullPartition = buildSecureWebPreferences({ partition: null });
    assert.equal(nullPartition.partition, undefined);
  });

  test('allows custom preload path and merges additional options', () => {
    const customPreload = path.join(__dirname, 'custom-preload.js');
    const prefs = buildSecureWebPreferences({
      preload: customPreload,
      additional: {
        spellcheck: false,
        zoomFactor: 1.25,
      },
    });

    assert.equal(prefs.preload, customPreload);
    assert.equal(prefs.spellcheck, false);
    assert.equal(prefs.zoomFactor, 1.25);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
  });

  test('enforces sandbox and disables nodeIntegration for extensions', () => {
    const extPrefs = buildExtensionWebPreferences();

    assert.equal(extPrefs.sandbox, true);
    assert.equal(extPrefs.nodeIntegration, false);
    assert.equal(extPrefs.enableRemoteModule, false);
    assert.equal(extPrefs.nodeIntegrationInSubFrames, false);
    assert.ok(extPrefs.preload.endsWith('extensionPreload.js'));
  });
});
