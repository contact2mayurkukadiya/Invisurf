const { EventEmitter } = require('events');
const { getTabRegistry } = require('./TabRegistry');

/**
 * WebRequestManager
 * Implements chrome.webRequest events:
 * - onBeforeRequest (coordinated via DNR or direct)
 * - onBeforeSendHeaders
 * - onSendHeaders
 * - onHeadersReceived
 * - onResponseStarted
 * - onBeforeRedirect
 * - onCompleted
 * - onErrorOccurred
 */
class WebRequestManager extends EventEmitter {
    constructor() {
        super();
        this.attachedSessions = new WeakSet();
    }

    /**
     * Converts an Electron webRequest details object into a Chrome webRequest details object.
     */
    _formatDetails(details) {
        let tabId = -1;
        if (details.webContentsId != null) {
            tabId = Number(details.webContentsId);
        } else if (details.webContents?.id != null) {
            tabId = Number(details.webContents.id);
        }

        const electronType = (details.resourceType || 'other').toLowerCase();
        const type = electronType === 'xhr' ? 'xmlhttprequest' : electronType;

        return {
            requestId: String(details.id || `${Date.now()}_${Math.random()}`),
            url: details.url,
            method: details.method || 'GET',
            frameId: 0,
            parentFrameId: -1,
            tabId: tabId >= 0 ? tabId : -1,
            type,
            timeStamp: Date.now(),
            initiator: details.initiator || '',
            requestHeaders: details.requestHeaders || {},
            responseHeaders: details.responseHeaders || {},
            statusCode: details.statusCode || 200,
            statusLine: details.statusLine || 'HTTP/1.1 200 OK',
            error: details.error || '',
        };
    }

    /**
     * Attaches to an Electron session to forward webRequest events.
     */
    attachToSession(ses) {
        if (!ses || this.attachedSessions.has(ses)) return;
        this.attachedSessions.add(ses);

        const filter = { urls: ['http://*/*', 'https://*/*'] };

        try {
            ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
                if (this._isInternal(details.url)) return callback({});
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onBeforeSendHeaders',
                    details: this._formatDetails(details),
                });
                callback({});
            });
        } catch (_) {}

        try {
            ses.webRequest.onSendHeaders(filter, (details) => {
                if (this._isInternal(details.url)) return;
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onSendHeaders',
                    details: this._formatDetails(details),
                });
            });
        } catch (_) {}

        try {
            ses.webRequest.onHeadersReceived(filter, (details, callback) => {
                if (this._isInternal(details.url)) return callback({});
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onHeadersReceived',
                    details: this._formatDetails(details),
                });
                callback({});
            });
        } catch (_) {}

        try {
            ses.webRequest.onResponseStarted(filter, (details) => {
                if (this._isInternal(details.url)) return;
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onResponseStarted',
                    details: this._formatDetails(details),
                });
            });
        } catch (_) {}

        try {
            ses.webRequest.onBeforeRedirect(filter, (details) => {
                if (this._isInternal(details.url)) return;
                const formatted = this._formatDetails(details);
                formatted.redirectUrl = details.redirectURL;
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onBeforeRedirect',
                    details: formatted,
                });
            });
        } catch (_) {}

        try {
            ses.webRequest.onCompleted(filter, (details) => {
                if (this._isInternal(details.url)) return;
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onCompleted',
                    details: this._formatDetails(details),
                });
            });
        } catch (_) {}

        try {
            ses.webRequest.onErrorOccurred(filter, (details) => {
                if (this._isInternal(details.url)) return;
                this.emit('web-request-event', {
                    eventName: 'chrome.webRequest.onErrorOccurred',
                    details: this._formatDetails(details),
                });
            });
        } catch (_) {}
    }

    _isInternal(url) {
        return (
            typeof url === 'string' &&
            (url.startsWith('app://') ||
             url.startsWith('chrome-extension://') ||
             url.startsWith('invisurf-ext://'))
        );
    }

    /**
     * Called by DeclarativeNetRequestManager during onBeforeRequest so we don't conflict with Electron's single-listener rule.
     */
    forwardBeforeRequest(details) {
        if (this._isInternal(details.url)) return;
        this.emit('web-request-event', {
            eventName: 'chrome.webRequest.onBeforeRequest',
            details: this._formatDetails(details),
        });
    }
}

// Singleton
let instance = null;
function getWebRequestManager() {
    if (!instance) {
        instance = new WebRequestManager();
    }
    return instance;
}

module.exports = {
    WebRequestManager,
    getWebRequestManager,
};
