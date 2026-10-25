'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Enterprise Test Setup for InviSurf Unit Tests
 * Mocks Electron runtime modules when running outside Electron binary
 */
function setupTestEnvironment() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-unit-test-'));

  const electronMock = {
    app: {
      getPath: (name) => {
        if (name === 'userData') return tempUserData;
        if (name === 'appData') return tempUserData;
        if (name === 'temp') return os.tmpdir();
        return tempUserData;
      },
      getAppPath: () => path.resolve(__dirname, '..', '..'),
      getName: () => 'InviSurf',
      getVersion: () => '1.0.0',
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (str) => Buffer.from(str),
      decryptString: (buf) => buf.toString(),
    },
    BrowserWindow: {
      getAllWindows: () => [],
      fromWebContents: () => null,
      fromId: () => null,
      getFocusedWindow: () => null,
    },
    nativeTheme: {
      shouldUseDarkColors: true,
      themeSource: 'system',
      on: () => {},
      removeListener: () => {},
    },
    ipcMain: new EventEmitter(),
    clipboard: {
      readText: () => '',
      writeText: () => {},
    },
    Menu: {
      buildFromTemplate: () => ({ popup: () => {} }),
    },
    WebContentsView: class MockWebContentsView {
      constructor() {
        this.webContents = new EventEmitter();
        this.webContents.loadURL = async () => {};
        this.webContents.send = () => {};
        this.webContents.setZoomFactor = () => {};
        this.webContents.isDestroyed = () => false;
      }
      setBackgroundColor() {}
      setBounds() {}
      setVisible() {}
    },
    BaseWindow: class MockBaseWindow {
      constructor() {
        this.contentView = {
          addChildView: () => {},
          removeChildView: () => {},
        };
      }
    },
    session: {
      defaultSession: {
        cookies: {
          get: async () => [],
          remove: async () => {},
          on: () => {},
        },
      },
      fromPartition: (partition) => ({
        partition,
        cookies: {
          get: async () => [],
          remove: async () => {},
          on: () => {},
        },
      }),
    },
  };

  try {
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath,
      filename: electronPath,
      loaded: true,
      exports: electronMock,
    };
  } catch (err) {
    console.warn('[setupTestEnvironment] Could not mock electron:', err.message);
  }

  return {
    tempUserData,
    cleanup: () => {
      try {
        fs.rmSync(tempUserData, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

module.exports = { setupTestEnvironment };
