const path = require('path');
const DEFAULT_PRELOAD = path.join(__dirname, '..', 'preload.js');
const EXTENSION_PRELOAD = path.join(__dirname, 'extensionPreload.js');

function buildSecureWebPreferences(options = {}) {
    const {
        partition,
        preload = DEFAULT_PRELOAD,
        additional = {},
    } = options;

    const prefs = {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        sandbox: true,
        nodeIntegrationInSubFrames: false,
        preload,
        ...additional,
    };

    if (partition !== undefined && partition !== null) {
        prefs.partition = partition;
    }

    return prefs;
}

function buildExtensionWebPreferences(options = {}) {
    const {
        partition,
        preload = EXTENSION_PRELOAD,
        additional = {},
    } = options;

    const prefs = {
        nodeIntegration: false,
        contextIsolation: false,
        enableRemoteModule: false,
        sandbox: false,
        nodeIntegrationInSubFrames: false,
        preload,
        ...additional,
    };

    if (partition !== undefined && partition !== null) {
        prefs.partition = partition;
    }

    return prefs;
}

module.exports = {
    DEFAULT_PRELOAD,
    buildSecureWebPreferences,
    buildExtensionWebPreferences,
};
