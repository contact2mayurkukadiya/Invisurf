'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const State = require('../../../main/state');
const profileService = require('../../../main/services/profileService');

describe('ProfileService', () => {
  beforeEach(() => {
    State.profilesById.clear();
    State.defaultProfileId = null;
  });

  afterEach(() => {
    State.profilesById.clear();
    State.defaultProfileId = null;
  });

  after(() => {
    env.cleanup();
  });

  test('ensureProfile registers a valid profile and assigns default ID', () => {
    const profile = profileService.ensureProfile('work-profile', 'Work Browser');
    assert.ok(profile);
    assert.equal(profile.profileId, 'work-profile');
    assert.equal(profile.displayName, 'Work Browser');
    assert.equal(State.defaultProfileId, 'work-profile');

    // Adding second profile does not overwrite defaultProfileId
    const profile2 = profileService.ensureProfile('personal', 'Personal');
    assert.equal(State.defaultProfileId, 'work-profile');
    assert.equal(State.profilesById.size, 2);
  });

  test('ensureProfile sanitizes profile IDs with special characters', () => {
    const profile = profileService.ensureProfile('user/profile:test#1');
    assert.equal(profile.profileId, 'user_profile_test_1');
  });

  test('ensureProfile returns null for empty/invalid profile IDs', () => {
    assert.equal(profileService.ensureProfile(''), null);
    assert.equal(profileService.ensureProfile(null), null);
    assert.equal(profileService.ensureProfile('   '), null);
  });

  test('saveProfiles encrypts and writes profiles to disk, and loadProfiles restores them', () => {
    profileService.ensureProfile('p1', 'Profile One');
    profileService.ensureProfile('p2', 'Profile Two');
    profileService.saveProfiles();

    const loaded = profileService.loadProfiles();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].displayName, 'Profile One');
    assert.equal(loaded[1].displayName, 'Profile Two');
  });

  test('loadProfiles gracefully handles missing file or corrupt JSON', () => {
    const profilesPath = profileService.getProfilesPath();
    if (fs.existsSync(profilesPath)) fs.unlinkSync(profilesPath);

    assert.deepEqual(profileService.loadProfiles(), []);

    // Corrupt JSON
    fs.writeFileSync(profilesPath, 'INVALID_JSON_CORRUPT', 'utf-8');
    assert.deepEqual(profileService.loadProfiles(), []);
  });

  test('validateAvatarDataUrl validates supported image types and rejects invalid data', () => {
    // Valid 1x1 transparent PNG data URL
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const result = profileService.validateAvatarDataUrl(validPng);
    assert.equal(result.ok, true);
    assert.ok(result.buf);

    // Invalid format
    assert.equal(profileService.validateAvatarDataUrl('not-a-data-url').ok, false);
    assert.equal(profileService.validateAvatarDataUrl('data:text/plain;base64,hello').ok, false);
    assert.equal(profileService.validateAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4=').ok, false);
  });

  test('setProfileAvatarFromDataUrl saves avatar to disk and updates profile metadata', () => {
    profileService.ensureProfile('avatar-test', 'Avatar User');
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const saveResult = profileService.setProfileAvatarFromDataUrl('avatar-test', validPng);
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.profile.hasCustomAvatar, true);
    assert.equal(saveResult.profile.avatarExt, 'png');

    // Retrieve avatar data URL
    const dataUrl = profileService.getProfileAvatarDataUrl('avatar-test');
    assert.ok(dataUrl);
    assert.ok(dataUrl.startsWith('data:image/png;base64,'));

    // Cleanup avatar files
    profileService.removeAvatarFilesForProfile('avatar-test');
    assert.equal(profileService.getProfileAvatarDataUrl('avatar-test'), null);
  });

  test('setProfileAvatarFromDataUrl fails when profile is not registered', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const result = profileService.setProfileAvatarFromDataUrl('unknown-id', validPng);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Profile not found');
  });
});
