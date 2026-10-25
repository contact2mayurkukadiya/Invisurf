'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const settingsService = require('../../../main/services/settingsService');
const { SETTINGS_DEFAULTS } = require('../../../main/constants/defaults');

describe('SettingsService', () => {
  after(() => {
    env.cleanup();
  });

  test('normalizeColorTheme validates allowed theme values', () => {
    assert.equal(settingsService.normalizeColorTheme('automatic'), 'automatic');
    assert.equal(settingsService.normalizeColorTheme('dark'), 'dark');
    assert.equal(settingsService.normalizeColorTheme('light'), 'light');
    assert.equal(settingsService.normalizeColorTheme('invalid-theme'), 'automatic');
    assert.equal(settingsService.normalizeColorTheme(null), 'automatic');
    assert.equal(settingsService.normalizeColorTheme(undefined), 'automatic');
  });

  test('normalizeProfileId sanitizes profile identifiers', () => {
    assert.equal(settingsService.normalizeProfileId('profile 123'), 'profile_123');
    assert.equal(settingsService.normalizeProfileId('user/profile:test!'), 'user_profile_test_');
    assert.equal(settingsService.normalizeProfileId(''), '');
    assert.equal(settingsService.normalizeProfileId(null), '');
  });

  test('colorThemeSettingToElectronSource maps themes to electron system settings', () => {
    assert.equal(settingsService.colorThemeSettingToElectronSource('dark'), 'dark');
    assert.equal(settingsService.colorThemeSettingToElectronSource('light'), 'light');
    assert.equal(settingsService.colorThemeSettingToElectronSource('automatic'), 'system');
  });

  test('loadSettings returns normalized defaults when settings file does not exist', () => {
    const settings = settingsService.loadSettings();
    assert.ok(settings);
    assert.equal(settings.colorTheme, 'automatic');
    assert.ok(settings.cookieConfig);
  });

  test('saveSettings persists configuration and loadSettings merges custom values', () => {
    const custom = {
      ...SETTINGS_DEFAULTS,
      colorTheme: 'dark',
      searchEngine: 'duckduckgo',
      defaultZoom: 1.25,
    };

    settingsService.saveSettings(custom);

    const reloaded = settingsService.loadSettings();
    assert.equal(reloaded.colorTheme, 'dark');
    assert.equal(reloaded.searchEngine, 'duckduckgo');
    assert.equal(reloaded.defaultZoom, 1.25);
  });

  test('updateCookieConfigForProfile stores profile-specific cookie settings', () => {
    const profileId = 'work_profile';
    const patch = { globalPolicy: 'block_third_party' };

    const updated = settingsService.updateCookieConfigForProfile(profileId, patch);
    assert.equal(updated.globalPolicy, 'block_third_party');

    const loaded = settingsService.loadSettings(profileId);
    assert.ok(loaded.cookieConfigByProfile[profileId]);
    assert.equal(loaded.cookieConfigByProfile[profileId].globalPolicy, 'block_third_party');
  });

  test('handles corrupted settings.json gracefully and falls back to defaults', () => {
    const settingsPath = settingsService.getSettingsPath();
    fs.writeFileSync(settingsPath, 'NOT_VALID_JSON{', 'utf-8');

    const origError = console.error;
    console.error = () => {};
    try {
      const fallback = settingsService.loadSettings();
      assert.ok(fallback);
      assert.equal(fallback.colorTheme, 'automatic');
    } finally {
      console.error = origError;
    }
  });
});
