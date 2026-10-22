const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const ExtensionStorage = require('../ExtensionStorage');

/**
 * StorageManager
 * Implements chrome.storage.local, chrome.storage.sync, and chrome.storage.session
 * with persistent JSON disk storage and cross-context onChanged notifications.
 */
class StorageManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Memory cache: Map<`${profileId}:${extensionId}:${area}`, Record<string, any>>
         */
        this.cache = new Map();
        /**
         * Debounce timers for disk persistence: Map<`${profileId}:${extensionId}`, NodeJS.Timeout>
         */
        this.saveTimers = new Map();
    }

    _getStorageDir(profileId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const dir = path.join(ExtensionStorage.getProfileExtensionsDir(pId), 'storage');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    _getStorageFilePath(profileId, extensionId) {
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        return path.join(this._getStorageDir(profileId), `${cleanExtId}.json`);
    }

    _getCacheKey(profileId, extensionId, area) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        return `${pId}:${cleanExtId}:${area || 'local'}`;
    }

    /**
     * Loads storage object from disk for an extension.
     */
    _loadFromDisk(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const filePath = this._getStorageFilePath(pId, cleanExtId);

        let data = { local: {}, sync: {}, session: {} };
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    data.local = parsed.local && typeof parsed.local === 'object' ? parsed.local : {};
                    data.sync = parsed.sync && typeof parsed.sync === 'object' ? parsed.sync : {};
                }
            } catch (err) {
                console.warn(`[StorageManager] Failed to read storage for ${cleanExtId}:`, err?.message || err);
            }
        }

        this.cache.set(this._getCacheKey(pId, cleanExtId, 'local'), data.local);
        this.cache.set(this._getCacheKey(pId, cleanExtId, 'sync'), data.sync);
        if (!this.cache.has(this._getCacheKey(pId, cleanExtId, 'session'))) {
            this.cache.set(this._getCacheKey(pId, cleanExtId, 'session'), {});
        }
    }

    /**
     * Ensures memory cache is loaded for given profile, extension, and area.
     */
    _getAreaStore(profileId, extensionId, area = 'local') {
        const key = this._getCacheKey(profileId, extensionId, area);
        if (!this.cache.has(key)) {
            this._loadFromDisk(profileId, extensionId);
        }
        return this.cache.get(key) || {};
    }

    /**
     * Schedules writing local & sync storage to disk.
     */
    _scheduleSave(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const timerKey = `${pId}:${cleanExtId}`;

        if (this.saveTimers.has(timerKey)) {
            clearTimeout(this.saveTimers.get(timerKey));
        }

        const timer = setTimeout(() => {
            this.saveTimers.delete(timerKey);
            this._flushToDisk(pId, cleanExtId);
        }, 150);

        this.saveTimers.set(timerKey, timer);
    }

    _flushToDisk(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanExtId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const filePath = this._getStorageFilePath(pId, cleanExtId);

        const local = this.cache.get(this._getCacheKey(pId, cleanExtId, 'local')) || {};
        const sync = this.cache.get(this._getCacheKey(pId, cleanExtId, 'sync')) || {};

        try {
            const tempPath = `${filePath}.tmp.${Date.now()}`;
            fs.writeFileSync(tempPath, JSON.stringify({ local, sync }, null, 2), 'utf-8');
            fs.renameSync(tempPath, filePath);
        } catch (err) {
            console.error(`[StorageManager] Failed to flush storage to disk for ${cleanExtId}:`, err?.message || err);
        }
    }

    /**
     * chrome.storage.<area>.get(keys)
     */
    async get(profileId, extensionId, area = 'local', keys = null) {
        const store = this._getAreaStore(profileId, extensionId, area);

        if (keys === null || keys === undefined) {
            return { ...store };
        }

        if (typeof keys === 'string') {
            return { [keys]: store[keys] !== undefined ? store[keys] : undefined };
        }

        if (Array.isArray(keys)) {
            const result = {};
            for (const key of keys) {
                if (typeof key === 'string' && store[key] !== undefined) {
                    result[key] = store[key];
                }
            }
            return result;
        }

        if (typeof keys === 'object') {
            const result = {};
            for (const [key, defaultVal] of Object.entries(keys)) {
                result[key] = store[key] !== undefined ? store[key] : defaultVal;
            }
            return result;
        }

        return { ...store };
    }

    /**
     * chrome.storage.<area>.set(items)
     */
    async set(profileId, extensionId, area = 'local', items = {}) {
        if (!items || typeof items !== 'object') return;
        const store = this._getAreaStore(profileId, extensionId, area);
        const changes = {};

        for (const [key, newValue] of Object.entries(items)) {
            const oldValue = store[key];
            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                store[key] = newValue;
                changes[key] = { oldValue, newValue };
            }
        }

        if (Object.keys(changes).length > 0) {
            if (area !== 'session') {
                this._scheduleSave(profileId, extensionId);
            }
            this.emit('storage-changed', {
                profileId: ExtensionStorage.safeProfileId(profileId),
                extensionId: ExtensionStorage.sanitizeExtensionId(extensionId),
                areaName: area,
                changes,
            });
        }
    }

    /**
     * chrome.storage.<area>.remove(keys)
     */
    async remove(profileId, extensionId, area = 'local', keys) {
        const store = this._getAreaStore(profileId, extensionId, area);
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes = {};

        for (const key of keyList) {
            if (typeof key === 'string' && store[key] !== undefined) {
                const oldValue = store[key];
                delete store[key];
                changes[key] = { oldValue, newValue: undefined };
            }
        }

        if (Object.keys(changes).length > 0) {
            if (area !== 'session') {
                this._scheduleSave(profileId, extensionId);
            }
            this.emit('storage-changed', {
                profileId: ExtensionStorage.safeProfileId(profileId),
                extensionId: ExtensionStorage.sanitizeExtensionId(extensionId),
                areaName: area,
                changes,
            });
        }
    }

    /**
     * chrome.storage.<area>.clear()
     */
    async clear(profileId, extensionId, area = 'local') {
        const store = this._getAreaStore(profileId, extensionId, area);
        const changes = {};

        for (const key of Object.keys(store)) {
            changes[key] = { oldValue: store[key], newValue: undefined };
            delete store[key];
        }

        if (Object.keys(changes).length > 0) {
            if (area !== 'session') {
                this._scheduleSave(profileId, extensionId);
            }
            this.emit('storage-changed', {
                profileId: ExtensionStorage.safeProfileId(profileId),
                extensionId: ExtensionStorage.sanitizeExtensionId(extensionId),
                areaName: area,
                changes,
            });
        }
    }

    /**
     * chrome.storage.<area>.getBytesInUse(keys)
     */
    async getBytesInUse(profileId, extensionId, area = 'local', keys = null) {
        const data = await this.get(profileId, extensionId, area, keys);
        return Buffer.byteLength(JSON.stringify(data), 'utf-8');
    }
}

// Singleton
let instance = null;
function getStorageManager() {
    if (!instance) {
        instance = new StorageManager();
    }
    return instance;
}

module.exports = {
    StorageManager,
    getStorageManager,
};
