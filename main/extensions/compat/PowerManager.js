const { EventEmitter } = require('events');
const { powerSaveBlocker } = require('electron');

/**
 * PowerManager
 * Implements chrome.power API matching Chromium specification.
 * Maps requestKeepAwake to Electron's powerSaveBlocker.
 */
class PowerManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map<extensionId, { blockerId, level }>
         */
        this.activeBlockers = new Map();
    }

    requestKeepAwake(extensionId, level = 'system') {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        this.releaseKeepAwake(cleanId);

        const electronType = level === 'display' ? 'prevent-display-sleep' : 'prevent-app-suspension';

        try {
            if (powerSaveBlocker && typeof powerSaveBlocker.start === 'function') {
                const blockerId = powerSaveBlocker.start(electronType);
                this.activeBlockers.set(cleanId, { blockerId, level });
                return true;
            }
        } catch (err) {
            console.warn('[PowerManager] Failed to start powerSaveBlocker:', err);
        }
        return false;
    }

    releaseKeepAwake(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const entry = this.activeBlockers.get(cleanId);
        if (entry) {
            try {
                if (powerSaveBlocker && typeof powerSaveBlocker.stop === 'function') {
                    if (powerSaveBlocker.isStarted(entry.blockerId)) {
                        powerSaveBlocker.stop(entry.blockerId);
                    }
                }
            } catch (err) {
                console.warn('[PowerManager] Failed to stop powerSaveBlocker:', err);
            }
            this.activeBlockers.delete(cleanId);
        }
        return true;
    }

    getBlockerInfo(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        return this.activeBlockers.get(cleanId) || null;
    }
}

let instance = null;
function getPowerManager() {
    if (!instance) {
        instance = new PowerManager();
    }
    return instance;
}

module.exports = {
    PowerManager,
    getPowerManager,
};
