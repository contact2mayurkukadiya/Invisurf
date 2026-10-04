const { BrowserWindow } = require('electron');
const { EventEmitter } = require('events');

/**
 * IdentityManager
 * Implements chrome.identity:
 * - getRedirectURL
 * - launchWebAuthFlow (real OAuth popup window with redirect capture)
 * - getProfileUserInfo
 */
class IdentityManager extends EventEmitter {
    constructor() {
        super();
        this.activeAuthWindows = new Set();
    }

    getRedirectURL(extensionId, p = '') {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const rel = String(p || '').replace(/^\/+/, '');
        return `https://${cleanId}.chromiumapp.org/${rel}`;
    }

    async launchWebAuthFlow(extensionId, details = {}) {
        const { url, interactive = true } = details;
        if (!url) {
            throw new Error('chrome.identity.launchWebAuthFlow: details.url is required');
        }

        const cleanId = String(extensionId || '').trim().toLowerCase();
        const redirectPrefix = `https://${cleanId}.chromiumapp.org/`;

        return new Promise((resolve, reject) => {
            let finished = false;

            const authWin = new BrowserWindow({
                width: 600,
                height: 720,
                show: interactive !== false,
                title: 'Sign In',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    partition: 'persist:ext-oauth',
                },
            });

            this.activeAuthWindows.add(authWin);

            const checkUrl = (targetUrl) => {
                if (finished || !targetUrl) return;
                if (targetUrl.startsWith(redirectPrefix) || (details.redirect_uri && targetUrl.startsWith(details.redirect_uri))) {
                    finished = true;
                    cleanup();
                    resolve(targetUrl);
                }
            };

            const cleanup = () => {
                this.activeAuthWindows.delete(authWin);
                if (!authWin.isDestroyed()) {
                    authWin.removeAllListeners('closed');
                    authWin.destroy();
                }
            };

            authWin.webContents.on('will-navigate', (e, targetUrl) => {
                checkUrl(targetUrl);
            });

            authWin.webContents.on('will-redirect', (e, targetUrl) => {
                checkUrl(targetUrl);
            });

            authWin.webContents.on('did-navigate', (e, targetUrl) => {
                checkUrl(targetUrl);
            });

            authWin.on('closed', () => {
                this.activeAuthWindows.delete(authWin);
                if (!finished) {
                    finished = true;
                    reject(new Error('The user did not approve access.'));
                }
            });

            authWin.loadURL(url).catch(err => {
                if (!finished) {
                    finished = true;
                    cleanup();
                    reject(err);
                }
            });
        });
    }

    async getProfileUserInfo() {
        return { email: '', id: '' };
    }

    async clearAllCachedAuthTokens() {
        return true;
    }
}

let instance = null;
function getIdentityManager() {
    if (!instance) instance = new IdentityManager();
    return instance;
}

module.exports = {
    IdentityManager,
    getIdentityManager,
};
