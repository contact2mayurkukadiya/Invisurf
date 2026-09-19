/**
 * Cross-platform Native Ghost Mode Router
 */

const { makeGhostWin32, hookChildWindowsWin32, setClickThroughWin32 } = require('./ghost-win32');
const { makeGhostDarwin, setClickThroughDarwin } = require('./ghost-darwin');

function applyGhostMode(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    try {
        const handle = browserWindow.getNativeWindowHandle();
        if (process.platform === 'win32') {
            return makeGhostWin32(handle);
        } else if (process.platform === 'darwin') {
            return makeGhostDarwin(handle);
        }
    } catch (err) {
        console.error('[ghost-native] Failed to apply ghost mode:', err);
    }
    return false;
}

function hookWindowChildren(browserWindow) {
    if (process.platform === 'win32' && browserWindow && !browserWindow.isDestroyed()) {
        try {
            const handle = browserWindow.getNativeWindowHandle();
            return hookChildWindowsWin32(handle);
        } catch (err) {
            console.error('[ghost-native] Failed to hook child windows:', err);
        }
    }
    return false;
}

function setClickThrough(browserWindow, enable) {
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    try {
        const handle = browserWindow.getNativeWindowHandle();
        if (process.platform === 'win32') {
            return setClickThroughWin32(handle, enable);
        } else if (process.platform === 'darwin') {
            return setClickThroughDarwin(handle, enable);
        }
    } catch (err) {
        console.error('[ghost-native] Failed to set click-through:', err);
    }
    return false;
}

module.exports = {
    applyGhostMode,
    hookWindowChildren,
    setClickThrough,
};
