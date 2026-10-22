const { EventEmitter } = require('events');

/**
 * AlarmManager
 * Implements chrome.alarms for scheduling periodic tasks and one-off timers.
 * Emits 'alarm-triggered' which IpcBridge forwards to extension service workers.
 */
class AlarmManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map of extensionId -> Map<alarmName, { name, scheduledTime, periodInMinutes, timerId }>
         */
        this.alarms = new Map();
    }

    _getExtMap(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        if (!this.alarms.has(cleanId)) {
            this.alarms.set(cleanId, new Map());
        }
        return this.alarms.get(cleanId);
    }

    create(extensionId, name = '', alarmInfo = {}) {
        const extMap = this._getExtMap(extensionId);
        const alarmName = String(name || '');

        // Clear existing if any
        this.clear(extensionId, alarmName);

        const now = Date.now();
        let scheduledTime = now;
        let delayMs = 0;

        if (alarmInfo.when) {
            scheduledTime = alarmInfo.when;
            delayMs = Math.max(0, scheduledTime - now);
        } else if (alarmInfo.delayInMinutes) {
            delayMs = Math.max(0, alarmInfo.delayInMinutes * 60 * 1000);
            scheduledTime = now + delayMs;
        } else if (alarmInfo.periodInMinutes) {
            delayMs = Math.max(0, alarmInfo.periodInMinutes * 60 * 1000);
            scheduledTime = now + delayMs;
        }

        const periodInMinutes = alarmInfo.periodInMinutes || null;

        const timerId = setTimeout(() => {
            this._fireAlarm(extensionId, alarmName, periodInMinutes);
        }, delayMs);

        extMap.set(alarmName, {
            name: alarmName,
            scheduledTime,
            periodInMinutes,
            timerId,
        });
    }

    _fireAlarm(extensionId, alarmName, periodInMinutes) {
        const extMap = this._getExtMap(extensionId);
        const entry = extMap.get(alarmName);
        if (!entry) return;

        const alarmObj = {
            name: alarmName,
            scheduledTime: entry.scheduledTime,
            periodInMinutes: entry.periodInMinutes,
        };

        this.emit('alarm-triggered', {
            extensionId,
            alarm: alarmObj,
        });

        // If repeating alarm, schedule next period
        if (periodInMinutes && periodInMinutes > 0) {
            const periodMs = periodInMinutes * 60 * 1000;
            entry.scheduledTime = Date.now() + periodMs;
            entry.timerId = setTimeout(() => {
                this._fireAlarm(extensionId, alarmName, periodInMinutes);
            }, periodMs);
        } else {
            extMap.delete(alarmName);
        }
    }

    get(extensionId, name = '') {
        const extMap = this._getExtMap(extensionId);
        const entry = extMap.get(String(name || ''));
        if (!entry) return null;
        return {
            name: entry.name,
            scheduledTime: entry.scheduledTime,
            periodInMinutes: entry.periodInMinutes,
        };
    }

    getAll(extensionId) {
        const extMap = this._getExtMap(extensionId);
        return Array.from(extMap.values()).map(e => ({
            name: e.name,
            scheduledTime: e.scheduledTime,
            periodInMinutes: e.periodInMinutes,
        }));
    }

    clear(extensionId, name = '') {
        const extMap = this._getExtMap(extensionId);
        const alarmName = String(name || '');
        const entry = extMap.get(alarmName);
        if (entry) {
            clearTimeout(entry.timerId);
            extMap.delete(alarmName);
            return true;
        }
        return false;
    }

    clearAll(extensionId) {
        const extMap = this._getExtMap(extensionId);
        for (const entry of extMap.values()) {
            clearTimeout(entry.timerId);
        }
        const hadAny = extMap.size > 0;
        extMap.clear();
        return hadAny;
    }
}

// Singleton
let instance = null;
function getAlarmManager() {
    if (!instance) {
        instance = new AlarmManager();
    }
    return instance;
}

module.exports = {
    AlarmManager,
    getAlarmManager,
};
