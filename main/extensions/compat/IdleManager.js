const { EventEmitter } = require('events');
const { powerMonitor } = require('electron');

/**
 * IdleManager
 * Implements chrome.idle API matching Chromium specification.
 * Uses Electron's native powerMonitor for system idle and lock state detection.
 */
class IdleManager extends EventEmitter {
    constructor() {
        super();
        this.defaultInterval = 60; // seconds
        this.detectionIntervals = new Map(); // extensionId -> interval
        this.lastStates = new Map(); // extensionId -> state
        this._pollTimer = null;
        this._initPowerMonitor();
    }

    _initPowerMonitor() {
        if (!powerMonitor) return;

        powerMonitor.on('lock-screen', () => {
            this._handleGlobalStateChange('locked');
        });

        powerMonitor.on('unlock-screen', () => {
            this._handleGlobalStateChange('active');
        });

        powerMonitor.on('suspend', () => {
            this._handleGlobalStateChange('locked');
        });

        powerMonitor.on('resume', () => {
            this._handleGlobalStateChange('active');
        });
    }

    _ensurePolling() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(() => {
            this._checkIdleStates();
        }, 5000); // Check every 5s to stay lightweight and performant
        if (this._pollTimer.unref) this._pollTimer.unref();
    }

    _checkIdleStates() {
        if (!powerMonitor || typeof powerMonitor.getSystemIdleState !== 'function') return;

        for (const [extId, interval] of this.detectionIntervals.entries()) {
            try {
                const currentState = powerMonitor.getSystemIdleState(interval);
                const lastState = this.lastStates.get(extId) || 'active';
                if (currentState !== lastState) {
                    this.lastStates.set(extId, currentState);
                    this.emit('idle-state-changed', { extensionId: extId, newState: currentState });
                }
            } catch (_) {}
        }
    }

    _handleGlobalStateChange(forcedState) {
        for (const extId of this.detectionIntervals.keys()) {
            this.lastStates.set(extId, forcedState);
            this.emit('idle-state-changed', { extensionId: extId, newState: forcedState });
        }
    }

    queryState(extensionId, detectionIntervalInSeconds) {
        const interval = Math.max(15, Number(detectionIntervalInSeconds) || this.defaultInterval);
        if (powerMonitor && typeof powerMonitor.getSystemIdleState === 'function') {
            try {
                return powerMonitor.getSystemIdleState(interval);
            } catch (err) {
                console.warn('[IdleManager] Failed to getSystemIdleState:', err);
            }
        }
        return 'active';
    }

    setDetectionInterval(extensionId, intervalInSeconds) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        const interval = Math.max(15, Number(intervalInSeconds) || this.defaultInterval);
        this.detectionIntervals.set(cleanId, interval);
        this._ensurePolling();
        return true;
    }

    getAutoLockDelay() {
        // macOS / Linux / Windows system autolock delay
        return 0;
    }
}

let instance = null;
function getIdleManager() {
    if (!instance) {
        instance = new IdleManager();
    }
    return instance;
}

module.exports = {
    IdleManager,
    getIdleManager,
};
