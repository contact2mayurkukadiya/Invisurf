'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PermissionDatabase } = require('../../../main/permissions/PermissionDatabase');

describe('PermissionDatabase', () => {
  let tempDir;
  let storagePath;
  let db;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-perm-db-'));
    storagePath = path.join(tempDir, 'permissions.json');
    db = new PermissionDatabase({ storagePath });
  });

  afterEach(() => {
    if (db) {
      db.destroy();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('initializes with empty data when storage file does not exist', () => {
    assert.equal(db.get('default', 'https://example.com', 'camera'), null);
    assert.deepEqual(db.getAll('default'), []);
  });

  test('sets and gets permission for a valid origin and permission name', () => {
    db.set('default', 'https://google.com', 'camera', 'allow');
    assert.equal(db.get('default', 'https://google.com', 'camera'), 'allow');

    db.set('default', 'https://google.com', 'microphone', 'deny');
    assert.equal(db.get('default', 'https://google.com', 'microphone'), 'deny');
  });

  test('ignores invalid permission names or states', () => {
    db.set('default', 'https://google.com', 'unknown-sensor', 'allow');
    assert.equal(db.get('default', 'https://google.com', 'unknown-sensor'), null);

    db.set('default', 'https://google.com', 'camera', 'invalid-state');
    assert.equal(db.get('default', 'https://google.com', 'camera'), null);

    db.set('default', '', 'camera', 'allow');
    assert.equal(db.get('default', '', 'camera'), null);
  });

  test('persists to disk and reloads on startup', () => {
    db.set('profile-1', 'https://meet.google.com', 'camera', 'allow');
    db.set('profile-1', 'https://meet.google.com', 'microphone', 'allow');
    db.flushToDisk();

    assert.ok(fs.existsSync(storagePath));
    const rawContent = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
    assert.ok(rawContent['profile-1']);
    assert.equal(rawContent['profile-1']['https://meet.google.com'].camera.state, 'allow');

    // Create a new instance pointing to the same file
    const reloadedDb = new PermissionDatabase({ storagePath });
    assert.equal(reloadedDb.get('profile-1', 'https://meet.google.com', 'camera'), 'allow');
    assert.equal(reloadedDb.get('profile-1', 'https://meet.google.com', 'microphone'), 'allow');
    reloadedDb.destroy();
  });

  test('supports ephemeral / incognito profiles strictly in-memory', () => {
    const incognitoId = 'incognito-session-1';
    db.registerEphemeralProfile(incognitoId);

    db.set(incognitoId, 'https://secret.org', 'geolocation', 'deny');
    assert.equal(db.get(incognitoId, 'https://secret.org', 'geolocation'), 'deny');

    db.flushToDisk();

    // Verify it is NOT written to disk
    if (fs.existsSync(storagePath)) {
      const saved = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      assert.equal(saved[incognitoId], undefined);
    }

    // Unregistering clears ephemeral memory
    db.unregisterEphemeralProfile(incognitoId);
    assert.equal(db.get(incognitoId, 'https://secret.org', 'geolocation'), null);
  });

  test('deletes specific permission and cleans up empty origin maps', () => {
    db.set('default', 'https://test.com', 'camera', 'allow');
    db.set('default', 'https://test.com', 'microphone', 'deny');

    const deleted = db.delete('default', 'https://test.com', 'camera');
    assert.equal(deleted, true);
    assert.equal(db.get('default', 'https://test.com', 'camera'), null);
    assert.equal(db.get('default', 'https://test.com', 'microphone'), 'deny');

    // Deleting the last permission cleans origin
    db.delete('default', 'https://test.com', 'microphone');
    assert.deepEqual(db.getAllForOrigin('default', 'https://test.com'), {});
  });

  test('clears origin and clears all profile permissions', () => {
    db.set('default', 'https://site-a.com', 'camera', 'allow');
    db.set('default', 'https://site-b.com', 'microphone', 'allow');

    db.clearOrigin('default', 'https://site-a.com');
    assert.equal(db.get('default', 'https://site-a.com', 'camera'), null);
    assert.equal(db.get('default', 'https://site-b.com', 'microphone'), 'allow');

    db.clearAll('default');
    assert.deepEqual(db.getAll('default'), []);
  });

  test('handles corrupted storage file gracefully without crashing', () => {
    fs.writeFileSync(storagePath, 'CORRUPTED_JSON_DATA{{{', 'utf-8');
    const safeDb = new PermissionDatabase({ storagePath });
    assert.deepEqual(safeDb.getAll('default'), []);
    safeDb.destroy();
  });
});
