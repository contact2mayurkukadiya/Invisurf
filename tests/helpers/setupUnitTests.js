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
      on: () => { },
      removeListener: () => { },
    },
    ipcMain: new EventEmitter(),
    clipboard: {
      readText: () => '',
      writeText: () => { },
    },
    Menu: {
      buildFromTemplate: () => ({ popup: () => { } }),
    },
    screen: {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 25, width: 1440, height: 875 },
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      }),
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 25, width: 1440, height: 875 },
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      }),
    },
    WebContentsView: class MockWebContentsView {
      constructor() {
        this.webContents = new EventEmitter();
        this.webContents.loadURL = async () => { };
        this.webContents.send = () => { };
        this.webContents.setZoomFactor = () => { };
        this.webContents.isDestroyed = () => false;
        this.webContents.setWindowOpenHandler = () => { };
        this.webContents.executeJavaScript = async () => '';
        this.webContents.getUserAgent = () => 'Chrome/130';
        this.webContents.getURL = () => '';
        this.webContents.disableDeviceEmulation = () => { };
        this.webContents.capturePage = async () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 1000, height: 800 }),
          toJPEG: () => Buffer.from('fake-jpeg-data'),
          toPNG: () => Buffer.from('fake-png-data'),
          crop: () => ({
            isEmpty: () => false,
            toJPEG: () => Buffer.from('fake-jpeg-data'),
            toPNG: () => Buffer.from('fake-png-data'),
          }),
        });
        this.webContents.session = {
          cookies: {
            get: async () => [],
            set: async () => { },
            remove: async () => { },
          },
        };
      }
      setBackgroundColor() { }
      setBounds() { }
      getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
      setVisible() { }
    },
    BaseWindow: class MockBaseWindow {
      constructor() {
        this.contentView = {
          addChildView: () => { },
          removeChildView: () => { },
        };
      }
    },
    session: {
      defaultSession: {
        cookies: {
          get: async () => [],
          remove: async () => { },
          on: () => { },
        },
      },
      fromPartition: (partition) => ({
        partition,
        cookies: {
          get: async () => [],
          remove: async () => { },
          on: () => { },
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
      } catch (_) { }
    },
  };
}

module.exports = { setupTestEnvironment };
