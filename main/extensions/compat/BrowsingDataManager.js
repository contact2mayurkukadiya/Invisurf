const { EventEmitter } = require('events');
const { session } = require('electron');
const State = require('../../state');
const { getHistoryManager } = require('./HistoryManager');
const { getDownloadManager } = require('./DownloadManager');

/**
 * BrowsingDataManager
 * Implements chrome.browsingData for clearing cookies, cache, storage, history, and downloads.
 */
class BrowsingDataManager extends EventEmitter {
    constructor() {
        super();
    }

    _resolveSession(profileId) {
        if (!profileId || profileId === State.defaultProfileId) {
            for (const ctx of State.windowContextsById.values()) {
                if (ctx.partition) return session.fromPartition(ctx.partition);
            }
            return session.defaultSession;
        }
        return session.fromPartition(`persist:profile-${profileId}`);
    }

    async settings() {
        return {
            options: {
                since: 0,
            },
            dataToRemove: {
                appcache: true,
                cache: true,
                cacheStorage: true,
                cookies: true,
                downloads: true,
                fileSystems: true,
                formData: true,
                history: true,
                indexedDB: true,
                localStorage: true,
                passwords: true,
                pluginData: true,
                serviceWorkers: true,
                webSQL: true,
            },
            dataRemovalPermitted: {
                appcache: true,
                cache: true,
                cacheStorage: true,
                cookies: true,
                downloads: true,
                fileSystems: true,
                formData: true,
                history: true,
                indexedDB: true,
                localStorage: true,
                passwords: true,
                pluginData: true,
                serviceWorkers: true,
                webSQL: true,
            },
        };
    }

    async remove(profileId, options = {}, dataToRemove = {}) {
        const targetSession = this._resolveSession(profileId);
        const tasks = [];

        // 1. Electron clearStorageData mapping
        const storages = [];
        if (dataToRemove.appcache || dataToRemove.cacheStorage) storages.push('cachestorage');
        if (dataToRemove.cookies) storages.push('cookies');
        if (dataToRemove.fileSystems) storages.push('filesystem');
        if (dataToRemove.indexedDB) storages.push('indexdb');
        if (dataToRemove.localStorage) storages.push('localstorage');
        if (dataToRemove.serviceWorkers) storages.push('serviceworkers');
        if (dataToRemove.webSQL) storages.push('websql');

        if (storages.length > 0 && targetSession?.clearStorageData) {
            const clearOpts = { storages };
            if (Array.isArray(options.origins) && options.origins.length > 0) {
                clearOpts.origins = options.origins;
            }
            tasks.push(targetSession.clearStorageData(clearOpts));
        }

        // 2. HTTP cache
        if (dataToRemove.cache && targetSession?.clearCache) {
            tasks.push(targetSession.clearCache());
        }

        // 3. Passwords / Auth cache
        if (dataToRemove.passwords && targetSession?.clearAuthCache) {
            tasks.push(targetSession.clearAuthCache());
        }

        // 4. History
        if (dataToRemove.history) {
            const histMgr = getHistoryManager();
            if (options.since && Number(options.since) > 0) {
                tasks.push(histMgr.deleteRange({ startTime: options.since, endTime: Date.now() }));
            } else {
                tasks.push(histMgr.deleteAll());
            }
        }

        // 5. Downloads
        if (dataToRemove.downloads) {
            const dlMgr = getDownloadManager();
            tasks.push(dlMgr.erase({}));
        }

        await Promise.allSettled(tasks);
        this.emit('browsing-data-removed', { profileId, options, dataToRemove });
        return { ok: true };
    }

    async removeAppcache(profileId, options) {
        return this.remove(profileId, options, { appcache: true, cacheStorage: true });
    }

    async removeCache(profileId, options) {
        return this.remove(profileId, options, { cache: true, cacheStorage: true });
    }

    async removeCookies(profileId, options) {
        return this.remove(profileId, options, { cookies: true });
    }

    async removeDownloads(profileId, options) {
        return this.remove(profileId, options, { downloads: true });
    }

    async removeFileSystems(profileId, options) {
        return this.remove(profileId, options, { fileSystems: true });
    }

    async removeFormData(profileId, options) {
        return this.remove(profileId, options, { formData: true });
    }

    async removeHistory(profileId, options) {
        return this.remove(profileId, options, { history: true });
    }

    async removeIndexedDB(profileId, options) {
        return this.remove(profileId, options, { indexedDB: true });
    }

    async removeLocalStorage(profileId, options) {
        return this.remove(profileId, options, { localStorage: true });
    }

    async removePasswords(profileId, options) {
        return this.remove(profileId, options, { passwords: true });
    }

    async removePluginData(profileId, options) {
        return this.remove(profileId, options, { pluginData: true });
    }

    async removeServiceWorkers(profileId, options) {
        return this.remove(profileId, options, { serviceWorkers: true });
    }

    async removeWebSQL(profileId, options) {
        return this.remove(profileId, options, { webSQL: true });
    }
}

let instance = null;
function getBrowsingDataManager() {
    if (!instance) {
        instance = new BrowsingDataManager();
    }
    return instance;
}

module.exports = {
    BrowsingDataManager,
    getBrowsingDataManager,
};
