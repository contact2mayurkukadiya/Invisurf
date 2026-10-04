const { EventEmitter } = require('events');

/**
 * WebNavigationManager
 * Tracks frame navigation lifecycle and emits chrome.webNavigation events.
 */
class WebNavigationManager extends EventEmitter {
    _createDetails(tabId, url, frame = null) {
        return {
            tabId: Number(tabId),
            url: url || '',
            processId: frame?.processId || 0,
            frameId: frame?.frameToken ? 1 : 0,
            parentFrameId: -1,
            timeStamp: Date.now(),
        };
    }

    onBeforeNavigate(tabId, url, frame = null) {
        const details = this._createDetails(tabId, url, frame);
        this.emit('nav-event', { eventName: 'chrome.webNavigation.onBeforeNavigate', details });
    }

    onCommitted(tabId, url, frame = null) {
        const details = this._createDetails(tabId, url, frame);
        details.transitionType = 'link';
        details.transitionQualifiers = [];
        this.emit('nav-event', { eventName: 'chrome.webNavigation.onCommitted', details });
    }

    onDOMContentLoaded(tabId, url, frame = null) {
        const details = this._createDetails(tabId, url, frame);
        this.emit('nav-event', { eventName: 'chrome.webNavigation.onDOMContentLoaded', details });
    }

    onCompleted(tabId, url, frame = null) {
        const details = this._createDetails(tabId, url, frame);
        this.emit('nav-event', { eventName: 'chrome.webNavigation.onCompleted', details });
    }

    onErrorOccurred(tabId, url, error = '') {
        const details = this._createDetails(tabId, url);
        details.error = String(error || 'net::ERR_FAILED');
        this.emit('nav-event', { eventName: 'chrome.webNavigation.onErrorOccurred', details });
    }
}

// Singleton
let instance = null;
function getWebNavigationManager() {
    if (!instance) {
        instance = new WebNavigationManager();
    }
    return instance;
}

module.exports = {
    WebNavigationManager,
    getWebNavigationManager,
};
