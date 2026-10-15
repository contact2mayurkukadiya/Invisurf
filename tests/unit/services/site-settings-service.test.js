'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

require('../../helpers/setupUnitTests');

const { PermissionDatabase } = require('../../../main/permissions/PermissionDatabase');
const { PermissionPromptQueue } = require('../../../main/permissions/PermissionPromptQueue');
const { PermissionController } = require('../../../main/permissions/PermissionController');
const siteSettingsService = require('../../../main/services/siteSettingsService');

describe('SiteSettingsService', () => {
  let tempDir;
  let testDb;
  let testQueue;
  let testController;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-site-settings-test-'));
    testDb = new PermissionDatabase({
      storagePath: path.join(tempDir, 'permissions.json'),
    });
    testQueue = new PermissionPromptQueue({ timeoutMs: 500 });
    testController = new PermissionController(testDb, testQueue);
    siteSettingsService.controller = testController;
  });

  afterEach(() => {
    try {
      testDb.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('getOriginState returns standardized permission metadata with prompt default', () => {
    const profileId = 'prof-site-1';
    const state = siteSettingsService.getOriginState(profileId, 'https://example.com');

    assert.equal(state.origin, 'https://example.com');
    assert.ok(Array.isArray(state.permissions));
    assert.ok(state.permissions.length >= 5);

    const camera = state.permissions.find((p) => p.name === 'camera');
    assert.ok(camera);
    assert.equal(camera.state, 'prompt');
    assert.ok(camera.label);
    assert.ok(camera.icon);
  });

  test('getOriginState returns empty for invalid origin', () => {
    const emptyState = siteSettingsService.getOriginState('prof-1', '');
    assert.equal(emptyState.origin, '');
    assert.deepEqual(emptyState.permissions, []);

    const nullState = siteSettingsService.getOriginState('prof-1', null);
    assert.equal(nullState.origin, '');
    assert.deepEqual(nullState.permissions, []);
  });

  test('setOriginPermission updates state and reflects in getOriginState', () => {
    const profileId = 'prof-site-2';
    const origin = 'https://app.slack.com';

    const setRes = siteSettingsService.setOriginPermission(profileId, origin, 'notifications', 'allow');
    assert.equal(setRes, true);

    const state = siteSettingsService.getOriginState(profileId, origin);
    const notifs = state.permissions.find((p) => p.name === 'notifications');
    assert.equal(notifs.state, 'allow');
    assert.ok(notifs.lastUpdated > 0);
  });

  test('deletePermission removes single permission override', () => {
    const profileId = 'prof-site-3';
    const origin = 'https://meet.google.com';

    siteSettingsService.setOriginPermission(profileId, origin, 'camera', 'allow');
    siteSettingsService.setOriginPermission(profileId, origin, 'microphone', 'deny');

    const before = siteSettingsService.getOriginState(profileId, origin);
    assert.equal(before.permissions.find((p) => p.name === 'camera').state, 'allow');
    assert.equal(before.permissions.find((p) => p.name === 'microphone').state, 'deny');

    siteSettingsService.deletePermission(profileId, origin, 'camera');

    const after = siteSettingsService.getOriginState(profileId, origin);
    assert.equal(after.permissions.find((p) => p.name === 'camera').state, 'prompt');
    assert.equal(after.permissions.find((p) => p.name === 'microphone').state, 'deny');
  });

  test('resetOrigin clears all permissions for that origin', () => {
    const profileId = 'prof-site-4';
    const origin = 'https://zoom.us';

    siteSettingsService.setOriginPermission(profileId, origin, 'camera', 'allow');
    siteSettingsService.setOriginPermission(profileId, origin, 'microphone', 'allow');

    siteSettingsService.resetOrigin(profileId, origin);

    const state = siteSettingsService.getOriginState(profileId, origin);
    assert.equal(state.permissions.find((p) => p.name === 'camera').state, 'prompt');
    assert.equal(state.permissions.find((p) => p.name === 'microphone').state, 'prompt');
  });

  test('getAllPermissions and clearAllPermissions manage profile-level permissions', () => {
    const profileId = 'prof-site-5';

    siteSettingsService.setOriginPermission(profileId, 'https://alpha.com', 'geolocation', 'allow');
    siteSettingsService.setOriginPermission(profileId, 'https://beta.com', 'notifications', 'deny');

    const all = siteSettingsService.getAllPermissions(profileId);
    assert.equal(all.length, 2);

    siteSettingsService.clearAllPermissions(profileId);
    const afterClear = siteSettingsService.getAllPermissions(profileId);
    assert.equal(afterClear.length, 0);
  });
});
