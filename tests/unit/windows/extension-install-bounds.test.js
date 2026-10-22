'use strict';

const { setupTestEnvironment } = require('../../helpers/setupUnitTests');
const env = setupTestEnvironment();

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const overlayManager = require('../../../main/windows/overlayManager');
const ExtensionInstaller = require('../../../main/extensions/ExtensionInstaller');

describe('Extension Installation Overlay & Downloader', () => {
  after(() => {
    env.cleanup();
  });

  test('computeMenuOverlayBounds returns full modal viewport bounds for extensionInstallPrompt', () => {
    const mockContext = {
      window: {
        getContentBounds: () => ({ width: 1280, height: 850 }),
        isDestroyed: () => false,
      },
    };

    const bounds = overlayManager.computeMenuOverlayBounds(mockContext, {
      kind: 'extensionInstallPrompt',
      extensionId: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
      name: 'Dark Reader',
    });

    assert.ok(bounds);
    assert.equal(bounds.x, 404);
    assert.equal(bounds.y, 26);
    assert.equal(bounds.width, 472);
    assert.equal(bounds.height, 592);
    assert.equal(bounds.viewportWidth, 1280);
    assert.equal(bounds.viewportHeight, 850);
  });

  test('ExtensionInstaller exports required download and extraction functions', () => {
    assert.equal(typeof ExtensionInstaller.downloadCrxFromWebStore, 'function');
    assert.equal(typeof ExtensionInstaller.resolveGoogleBlobUrl, 'function');
    assert.equal(typeof ExtensionInstaller.extractZipBufferFromCrx, 'function');
    assert.equal(typeof ExtensionInstaller.unpackZipBuffer, 'function');
    assert.equal(typeof ExtensionInstaller.inspectExtractedExtension, 'function');
  });

  test('extractZipBufferFromCrx rejects non-archive buffers cleanly', () => {
    const invalidBuffer = Buffer.from('NOT_A_VALID_CRX_OR_ZIP_FILE');
    assert.throws(() => {
      ExtensionInstaller.extractZipBufferFromCrx(invalidBuffer, 'test');
    }, /Invalid CRX file format/);
  });
});
