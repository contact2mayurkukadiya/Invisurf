'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const encryption = require('../../../encryption');

describe('Security & Encryption', () => {
  test('encrypts and decrypts strings correctly', () => {
    const original = JSON.stringify({ user: 'alice', token: 'secret-token-123' });
    const payload = encryption.encrypt(original);

    assert.ok(payload);
    assert.equal(payload.encrypted, true);
    assert.ok(payload.data);

    const decrypted = encryption.decrypt(payload);
    assert.equal(decrypted, original);
  });

  test('handles empty or falsy text gracefully', () => {
    assert.equal(encryption.encrypt(''), '');
    assert.equal(encryption.encrypt(null), '');
    assert.equal(encryption.encrypt(undefined), '');
  });

  test('decrypts unencrypted legacy payload via fallback', () => {
    const rawData = { bookmarks: ['a', 'b'] };
    const result = encryption.decrypt(rawData);
    assert.deepEqual(result, rawData);

    const stringFallback = encryption.decrypt('plain-text-data');
    assert.equal(stringFallback, 'plain-text-data');

    assert.equal(encryption.decrypt(null), '');
  });

  test('handles corrupt ciphertext gracefully without crashing', () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const corruptedPayload = {
        encrypted: true,
        type: 'FALLBACK',
        iv: '0123456789abcdef0123456789abcdef',
        authTag: '0123456789abcdef0123456789abcdef',
        data: 'bad-hex-data-1234',
      };

      const result = encryption.decrypt(corruptedPayload);
      assert.equal(result, '');
    } finally {
      console.error = origError;
    }
  });

  test('handles corrupt authTag gracefully without crashing', () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const payload = encryption.encrypt('sensitive user profile data');
      if (payload && payload.authTag) {
        // Corrupt the authTag
        payload.authTag = '00000000000000000000000000000000';
        const result = encryption.decrypt(payload);
        assert.equal(result, '');
      }
    } finally {
      console.error = origError;
    }
  });
});
