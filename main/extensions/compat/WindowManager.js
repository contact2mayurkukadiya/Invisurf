const { BrowserWindow } = require('electron');
const State = require('../../state');

/**
 * WindowManager
 * Bridges chrome.windows API to Electron BrowserWindow instances.
 */
class WindowManager {
    _formatWindow(win, context = null) {
        if (!win || win.isDestroyed()) return null;

        const bounds = win.getBounds();
        let state = 'normal';
        if (win.isFullScreen()) state = 'fullscreen';
        else if (win.isMaximized()) state = 'maximized';
        else if (win.isMinimized()) state = 'minimized';

        return {
            id: win.id,
            focused: win.isFocused(),
            top: bounds.y,
            left: bounds.x,
            width: bounds.width,
            height: bounds.height,
            type: 'normal',
            state,
            alwaysOnTop: win.isAlwaysOnTop(),
            incognito: !!context?.stealthWindow,
        };
    }

    async get(windowId, queryOptions = {}) {
        const win = BrowserWindow.fromId(Number(windowId));
        if (!win || win.isDestroyed()) {
            throw new Error(`No window with id: ${windowId}`);
        }
        const ctx = State.windowContextsById.get(win.id);
        const w = this._formatWindow(win, ctx);

        if (queryOptions.populate) {
            const { getTabRegistry } = require('./TabRegistry');
            w.tabs = await getTabRegistry().query({ windowId: win.id });
        }

        return w;
    }

    async getCurrent(queryOptions = {}, sender = {}) {
        let win = null;
        if (sender.senderWebContents && !sender.senderWebContents.isDestroyed()) {
            const { getWindowContextByEventSender } = require('../../windows/windowContextUtils');
            const ctx = getWindowContextByEventSender(sender.senderWebContents);
            if (ctx?.window && !ctx.window.isDestroyed()) {
                win = ctx.window;
            } else {
                win = BrowserWindow.fromWebContents(sender.senderWebContents);
            }
        }
        if (!win) {
            win = BrowserWindow.getFocusedWindow();
        }
        if (!win) {
            const { getFocusedShellWindow } = require('../../windows/windowContextUtils');
            win = getFocusedShellWindow();
        }
        if (!win && State.windowContextsById.size > 0) {
            win = State.windowContextsById.values().next().value?.window;
        }
        if (!win && State.mainWindow && !State.mainWindow.isDestroyed()) {
            win = State.mainWindow;
        }

        if (!win || win.isDestroyed()) return null;
        return this.get(win.id, queryOptions);
    }

    async getAll(queryOptions = {}) {
        const results = [];
        for (const [winId, ctx] of State.windowContextsById.entries()) {
            if (ctx?.window && !ctx.window.isDestroyed()) {
                const w = await this.get(winId, queryOptions).catch(() => null);
                if (w) results.push(w);
            }
        }
        return results;
    }

    async create(createData = {}, sender = {}) {
        const windowMgr = require('../../windows/windowManager');
        const urls = Array.isArray(createData.url)
            ? createData.url
            : (createData.url ? [createData.url] : []);
        let extensionId = sender?.extensionId || null;
        if (!extensionId && sender?.senderWebContents && !sender.senderWebContents.isDestroyed()) {
            try {
                const { getExtensionIdFromUrl } = require('../ExtensionSecurity');
                extensionId = getExtensionIdFromUrl(sender.senderWebContents.getURL());
            } catch (_) {}
        }
        const profileId = sender?.profileId || State.defaultProfileId;

        const ctx = windowMgr.createWindow({ profileId });
        const win = ctx?.window;
        if (!win || win.isDestroyed()) {
            throw new Error('Failed to create window');
        }

        if (createData.width && createData.height) {
            win.setBounds({
                x: createData.left || 100,
                y: createData.top || 100,
                width: createData.width,
                height: createData.height,
            });
        }
        if (createData.focused !== false) {
            win.focus();
        }

        if (urls.length > 0) {
            const { getTabRegistry } = require('./TabRegistry');
            const tabReg = getTabRegistry();
            for (const u of urls) {
                await tabReg.create({ url: u, windowId: win.id }, { ...sender, extensionId });
            }
        }

        return this.get(win.id, {});
    }


    async update(windowId, updateInfo = {}) {
        let win = null;
        if (windowId === -2 || windowId === 'current') {
            win = BrowserWindow.getFocusedWindow() || State.mainWindow;
        } else {
            win = BrowserWindow.fromId(Number(windowId));
        }
        if (!win && State.windowContextsById.has(Number(windowId))) {
            win = State.windowContextsById.get(Number(windowId)).window;
        }
        if (!win || win.isDestroyed()) {
            const { getFocusedShellWindow } = require('../../windows/windowContextUtils');
            win = getFocusedShellWindow() || State.mainWindow;
        }
        if (!win || win.isDestroyed()) {
            throw new Error(`No window with id: ${windowId}`);
        }

        const bounds = win.getBounds();
        if (updateInfo.left !== undefined) bounds.x = updateInfo.left;
        if (updateInfo.top !== undefined) bounds.y = updateInfo.top;
        if (updateInfo.width !== undefined) bounds.width = updateInfo.width;
        if (updateInfo.height !== undefined) bounds.height = updateInfo.height;

        win.setBounds(bounds);

        if (updateInfo.focused) win.focus();
        if (updateInfo.state === 'minimized') win.minimize();
        else if (updateInfo.state === 'maximized') win.maximize();
        else if (updateInfo.state === 'fullscreen') win.setFullScreen(true);
        else if (updateInfo.state === 'normal') {
            if (win.isFullScreen()) win.setFullScreen(false);
            if (win.isMaximized()) win.unmaximize();
            if (win.isMinimized()) win.restore();
        }

        return this.get(win.id, {});
    }

    async remove(windowId) {
        const win = BrowserWindow.fromId(Number(windowId));
        if (win && !win.isDestroyed()) {
            win.close();
        }
    }
}

// Singleton
let instance = null;
function getWindowManager() {
    if (!instance) {
        instance = new WindowManager();
    }
    return instance;
}

module.exports = {
    WindowManager,
    getWindowManager,
};
