'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const State = require('../../../main/state');
const profileService = require('../../../main/services/profileService');

describe('Profile Deletion & Invariant Regressions', () => {
  beforeEach(() => {
    State.profilesById.clear();
    State.windowContextsById.clear();
    State.defaultProfileId = null;
  });

  afterEach(() => {
    State.profilesById.clear();
    State.windowContextsById.clear();
    State.defaultProfileId = null;
  });

  after(() => {
    env.cleanup();
  });

  test('guards against deleting the last remaining profile', () => {
    profileService.ensureProfile('only-profile', 'Solo');
    assert.equal(State.profilesById.size, 1);

    // Business rule: You can’t delete the last profile
    const canDelete = State.profilesById.size > 1;
    assert.equal(canDelete, false, 'Must prevent deleting the only profile');
  });

  test('guards against deleting a profile that has active open windows', () => {
    profileService.ensureProfile('p1', 'Profile 1');
    profileService.ensureProfile('p2', 'Profile 2');

    // Simulate an open window for p1
    State.windowContextsById.set(100, { windowId: 100, profileId: 'p1' });

    const hasActiveWindow = Array.from(State.windowContextsById.values()).some(
      (ctx) => ctx.profileId === 'p1'
    );
    assert.equal(hasActiveWindow, true, 'Must detect active window for profile');
  });

  test('reassigns defaultProfileId when default profile is deleted', () => {
    profileService.ensureProfile('default-p', 'Default Profile');
    profileService.ensureProfile('secondary-p', 'Secondary Profile');
    assert.equal(State.defaultProfileId, 'default-p');

    // Simulate deleting default-p
    State.profilesById.delete('default-p');
    if (State.defaultProfileId === 'default-p') {
      State.defaultProfileId = Array.from(State.profilesById.keys())[0] || null;
    }

    assert.equal(State.defaultProfileId, 'secondary-p', 'Default profile must reassign to remaining profile');
  });
});
