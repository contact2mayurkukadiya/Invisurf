const { EventEmitter } = require('events');
const { shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * DownloadManager
 * Complete implementation of chrome.downloads API for InviSurf extensions.
 * Bridges Electron's session will-download / DownloadItem lifecycle to Chrome extension format.
 */
class DownloadManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map of downloadId (integer) -> DownloadItemInfo
         */
        this.downloads = new Map();
        /**
         * Map of downloadId -> native Electron DownloadItem
         */
        this.activeItems = new Map();
        this.nextDownloadId = 1;
        this.attachedSessions = new WeakSet();
    }

    /**
     * Attaches DownloadManager to an Electron session.
     */
    attachToSession(ses) {
        if (!ses || this.attachedSessions.has(ses)) return;
        this.attachedSessions.add(ses);

        ses.on('will-download', (event, item, webContents) => {
            const id = this.nextDownloadId++;
            this.activeItems.set(id, item);

            const startTime = new Date().toISOString();
            const filename = item.getFilename();
            const savePath = item.getSavePath() || path.join(app.getPath('downloads'), filename);

            const downloadItemInfo = {
                id,
                url: item.getURL(),
                finalUrl: item.getURL(),
                filename: savePath,
                danger: 'safe',
                mime: item.getMimeType() || 'application/octet-stream',
                startTime,
                endTime: null,
                state: 'in_progress',
                paused: item.isPaused(),
                canResume: item.canResume(),
                error: null,
                bytesReceived: item.getReceivedBytes(),
                totalBytes: item.getTotalBytes(),
                fileSize: item.getTotalBytes(),
                exists: true,
            };

            this.downloads.set(id, downloadItemInfo);
            this.emit('download-created', downloadItemInfo);

            item.on('updated', (updateEvent, state) => {
                const prev = this.downloads.get(id);
                if (!prev) return;

                const isPaused = state === 'interrupted' || item.isPaused();
                const delta = {};

                if (prev.bytesReceived !== item.getReceivedBytes()) {
                    delta.bytesReceived = { previous: prev.bytesReceived, current: item.getReceivedBytes() };
                    prev.bytesReceived = item.getReceivedBytes();
                }
                if (prev.totalBytes !== item.getTotalBytes() && item.getTotalBytes() > 0) {
                    delta.totalBytes = { previous: prev.totalBytes, current: item.getTotalBytes() };
                    prev.totalBytes = item.getTotalBytes();
                    prev.fileSize = item.getTotalBytes();
                }
                if (prev.paused !== isPaused) {
                    delta.paused = { previous: prev.paused, current: isPaused };
                    prev.paused = isPaused;
                }
                if (prev.canResume !== item.canResume()) {
                    delta.canResume = { previous: prev.canResume, current: item.canResume() };
                    prev.canResume = item.canResume();
                }

                if (Object.keys(delta).length > 0) {
                    delta.id = id;
                    this.emit('download-changed', delta);
                }
            });

            item.once('done', (doneEvent, state) => {
                const prev = this.downloads.get(id);
                this.activeItems.delete(id);
                if (!prev) return;

                prev.endTime = new Date().toISOString();
                prev.bytesReceived = item.getReceivedBytes();
                prev.totalBytes = item.getTotalBytes();
                prev.fileSize = item.getTotalBytes();

                if (prev.filename && prev.filename.endsWith('.invdownload')) {
                    prev.filename = prev.filename.slice(0, -'.invdownload'.length);
                }

                let finalState = 'complete';
                let error = null;
                if (state === 'cancelled') {
                    finalState = 'interrupted';
                    error = 'USER_CANCELED';
                } else if (state === 'interrupted') {
                    finalState = 'interrupted';
                    error = 'NETWORK_FAILED';
                }

                const delta = {
                    id,
                    state: { previous: prev.state, current: finalState },
                    endTime: { previous: null, current: prev.endTime },
                };
                if (error) {
                    delta.error = { previous: null, current: error };
                    prev.error = error;
                }
                prev.state = finalState;

                this.emit('download-changed', delta);
            });
        });
    }

    /**
     * chrome.downloads.download({ url, filename, conflictAction, saveAs })
     */
    async download(session, options = {}) {
        if (!options.url) {
            throw new Error('URL is required for download');
        }

        const id = this.nextDownloadId++;
        const targetFilename = options.filename ? path.basename(options.filename) : 'download';
        const targetDir = app.getPath('downloads');
        const defaultSavePath = path.join(targetDir, targetFilename);

        const downloadInfo = {
            id,
            url: options.url,
            finalUrl: options.url,
            filename: defaultSavePath,
            danger: 'safe',
            mime: 'application/octet-stream',
            startTime: new Date().toISOString(),
            endTime: null,
            state: 'in_progress',
            paused: false,
            canResume: false,
            error: null,
            bytesReceived: 0,
            totalBytes: -1,
            fileSize: -1,
            exists: true,
        };

        this.downloads.set(id, downloadInfo);
        this.emit('download-created', downloadInfo);

        if (session && typeof session.downloadURL === 'function') {
            session.downloadURL(options.url);
        }

        return id;
    }

    /**
     * chrome.downloads.search(query)
     */
    search(query = {}) {
        let list = Array.from(this.downloads.values());

        if (query.id != null) {
            const qId = Number(query.id);
            list = list.filter(d => d.id === qId);
        }
        if (query.url != null) {
            list = list.filter(d => d.url === query.url);
        }
        if (query.filename != null) {
            list = list.filter(d => d.filename === query.filename);
        }
        if (query.filenameRegex != null) {
            try {
                const rx = new RegExp(query.filenameRegex, 'i');
                list = list.filter(d => rx.test(d.filename));
            } catch (_) { }
        }
        if (query.urlRegex != null) {
            try {
                const rx = new RegExp(query.urlRegex, 'i');
                list = list.filter(d => rx.test(d.url));
            } catch (_) { }
        }
        if (query.state != null) {
            list = list.filter(d => d.state === query.state);
        }
        if (query.paused != null) {
            list = list.filter(d => d.paused === !!query.paused);
        }
        if (query.danger != null) {
            list = list.filter(d => d.danger === query.danger);
        }
        if (query.mime != null) {
            list = list.filter(d => d.mime === query.mime);
        }

        if (query.orderBy && Array.isArray(query.orderBy)) {
            for (const orderField of query.orderBy) {
                const desc = orderField.startsWith('-');
                const field = desc ? orderField.substring(1) : orderField;
                list.sort((a, b) => {
                    const valA = a[field] ?? '';
                    const valB = b[field] ?? '';
                    if (valA < valB) return desc ? 1 : -1;
                    if (valA > valB) return desc ? -1 : 1;
                    return 0;
                });
            }
        } else {
            // Default sort: newest first
            list.sort((a, b) => (b.id - a.id));
        }

        if (query.limit != null && Number(query.limit) > 0) {
            list = list.slice(0, Number(query.limit));
        }

        return list;
    }

    /**
     * chrome.downloads.pause(downloadId)
     */
    pause(downloadId) {
        const item = this.activeItems.get(Number(downloadId));
        if (item && !item.isPaused()) {
            item.pause();
            return true;
        }
        return false;
    }

    /**
     * chrome.downloads.resume(downloadId)
     */
    resume(downloadId) {
        const item = this.activeItems.get(Number(downloadId));
        if (item && item.canResume()) {
            item.resume();
            return true;
        }
        return false;
    }

    /**
     * chrome.downloads.cancel(downloadId)
     */
    cancel(downloadId) {
        const item = this.activeItems.get(Number(downloadId));
        if (item) {
            item.cancel();
            return true;
        }
        return false;
    }

    /**
     * chrome.downloads.show(downloadId)
     */
    show(downloadId) {
        const d = this.downloads.get(Number(downloadId));
        if (d && d.filename) {
            shell.showItemInFolder(d.filename);
            return true;
        }
        return false;
    }

    /**
     * chrome.downloads.open(downloadId)
     */
    open(downloadId) {
        const d = this.downloads.get(Number(downloadId));
        if (d && d.filename && fs.existsSync(d.filename)) {
            shell.openPath(d.filename);
            return true;
        }
        return false;
    }

    /**
     * chrome.downloads.erase(query)
     */
    erase(query = {}) {
        const matches = this.search(query);
        const erasedIds = [];
        for (const item of matches) {
            this.downloads.delete(item.id);
            this.activeItems.delete(item.id);
            erasedIds.push(item.id);
            this.emit('download-erased', item.id);
        }
        return erasedIds;
    }
}

// Singleton
let instance = null;
function getDownloadManager() {
    if (!instance) {
        instance = new DownloadManager();
    }
    return instance;
}

module.exports = {
    DownloadManager,
    getDownloadManager,
};
