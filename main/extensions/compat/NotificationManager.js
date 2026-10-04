const { Notification } = require('electron');
const { EventEmitter } = require('events');

/**
 * NotificationManager
 * Bridges chrome.notifications to Electron's native Notification module.
 */
class NotificationManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map of notificationId -> Notification instance
         */
        this.activeNotifications = new Map();
        this.nextId = 1;
    }

    async create(extensionId, notificationId = '', options = {}) {
        const id = notificationId || `notif_${this.nextId++}`;

        // Clear existing if any
        this.clear(extensionId, id);

        if (!Notification.isSupported()) {
            return id;
        }

        try {
            const notif = new Notification({
                title: options.title || '',
                body: options.message || '',
                silent: !!options.silent,
            });

            notif.on('click', () => {
                this.emit('notification-clicked', { extensionId, notificationId: id });
            });

            notif.on('close', () => {
                this.activeNotifications.delete(id);
                this.emit('notification-closed', { extensionId, notificationId: id, byUser: true });
            });

            notif.show();
            this.activeNotifications.set(id, notif);
        } catch (err) {
            console.warn('[NotificationManager] Failed to show notification:', err?.message || err);
        }

        return id;
    }

    async clear(extensionId, notificationId) {
        const notif = this.activeNotifications.get(notificationId);
        if (notif) {
            try {
                notif.close();
            } catch (_) {}
            this.activeNotifications.delete(notificationId);
            return true;
        }
        return false;
    }

    async getAll(extensionId) {
        const result = {};
        for (const id of this.activeNotifications.keys()) {
            result[id] = true;
        }
        return result;
    }
}

// Singleton
let instance = null;
function getNotificationManager() {
    if (!instance) {
        instance = new NotificationManager();
    }
    return instance;
}

module.exports = {
    NotificationManager,
    getNotificationManager,
};
