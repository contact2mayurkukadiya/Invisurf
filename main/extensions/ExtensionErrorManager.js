const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { BrowserWindow } = require('electron');
const ExtensionStorage = require('./ExtensionStorage');

const MAX_ERRORS_PER_EXT = 100;
const MAX_MESSAGE_LEN = 2048;
const MAX_STACK_LEN = 8192;
const MAX_SOURCE_LEN = 512;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_REPORTS_PER_WINDOW = 10;
const BROADCAST_DEBOUNCE_MS = 150;

function broadcastToShellWindows(channel, data) {
    try {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (win?.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send(channel, data);
            }
        }
    } catch (_) {}
}

class ExtensionErrorManager extends EventEmitter {
    constructor() {
        super();
        /** Map of extensionId -> Array<ExtensionErrorRecord> */
        this.errors = new Map();
        /** Map of extensionId -> Map<fingerprint, ExtensionErrorRecord> */
        this.errorIndex = new Map();
        /** Map of extensionId -> { windowStart: number, count: number } */
        this.rateLimits = new Map();
    }

    /**
     * Sanitizes and bounds input fields to prevent DoS or memory issues.
     */
    _sanitizeInput(raw) {
        let message = String(raw?.message || 'Unknown extension error').trim();
        if (message.length > MAX_MESSAGE_LEN) {
            message = message.slice(0, MAX_MESSAGE_LEN) + '... [truncated]';
        }

        let stack = String(raw?.stack || '').trim();
        if (stack.length > MAX_STACK_LEN) {
            stack = stack.slice(0, MAX_STACK_LEN) + '\n... [stack truncated]';
        }

        let source = String(raw?.source || raw?.filename || '').trim();
        // Clean common protocol prefixes from source paths
        source = source.replace(/^(chrome-extension:\/\/[^/]+\/|invisurf-ext:\/\/[^/]+\/|file:\/\/)/, '');
        if (source.length > MAX_SOURCE_LEN) {
            source = source.slice(0, MAX_SOURCE_LEN);
        }

        const lineno = Number.isInteger(raw?.lineno) && raw.lineno > 0 ? raw.lineno : 0;
        const colno = Number.isInteger(raw?.colno) && raw.colno > 0 ? raw.colno : 0;

        const type = raw?.type === 'manifest' ? 'manifest' : 'runtime';
        const context = ['service_worker', 'popup', 'options', 'content_script', 'system'].includes(raw?.context)
            ? raw.context
            : 'runtime';

        return {
            message,
            stack,
            source,
            lineno,
            colno,
            type,
            context,
        };
    }

    /**
     * Generates a stable deduplication fingerprint.
     */
    _createFingerprint(sanitized) {
        return `${sanitized.type}|${sanitized.context}|${sanitized.source}|${sanitized.lineno}|${sanitized.colno}|${sanitized.message}`;
    }

    /**
     * Rate limiter to prevent infinite error loops from overwhelming the process.
     */
    _isRateLimited(extensionId) {
        const now = Date.now();
        let tracker = this.rateLimits.get(extensionId);
        if (!tracker || (now - tracker.windowStart) > RATE_LIMIT_WINDOW_MS) {
            tracker = { windowStart: now, count: 0 };
            this.rateLimits.set(extensionId, tracker);
        }

        if (tracker.count >= MAX_REPORTS_PER_WINDOW) {
            return true;
        }
        tracker.count++;
        return false;
    }

    /**
     * Reports an error for a given extension.
     */
    reportError(extensionId, rawPayload) {
        if (!extensionId) return null;
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        if (!cleanId) return null;

        if (this._isRateLimited(cleanId)) {
            return null;
        }

        const sanitized = this._sanitizeInput(rawPayload);
        const fingerprint = this._createFingerprint(sanitized);

        if (!this.errors.has(cleanId)) {
            this.errors.set(cleanId, []);
            this.errorIndex.set(cleanId, new Map());
        }

        const extErrors = this.errors.get(cleanId);
        const extIndex = this.errorIndex.get(cleanId);
        const now = Date.now();

        if (extIndex.has(fingerprint)) {
            // Deduplicate: increment occurrence count and update timestamp
            const existing = extIndex.get(fingerprint);
            existing.count = (existing.count || 1) + 1;
            existing.lastSeen = now;
            this._notifyUpdate(cleanId);
            return existing;
        }

        // New distinct error
        const record = {
            id: `err_${now}_${Math.random().toString(36).substring(2, 8)}`,
            extensionId: cleanId,
            timestamp: now,
            lastSeen: now,
            count: 1,
            ...sanitized,
        };

        // Ring buffer check: evict oldest if at capacity
        if (extErrors.length >= MAX_ERRORS_PER_EXT) {
            const evicted = extErrors.pop();
            if (evicted) {
                const evictedFp = this._createFingerprint(evicted);
                extIndex.delete(evictedFp);
            }
        }

        extErrors.unshift(record);
        extIndex.set(fingerprint, record);

        this._notifyUpdate(cleanId);
        return record;
    }

    _notifyUpdate(extensionId) {
        if (!this._debounceTimers) this._debounceTimers = new Map();
        if (this._debounceTimers.has(extensionId)) {
            clearTimeout(this._debounceTimers.get(extensionId));
        }
        const timer = setTimeout(() => {
            this._debounceTimers.delete(extensionId);
            const totalCount = this.getErrorCount(extensionId);
            this.emit('errors-updated', { extensionId, totalCount });
            broadcastToShellWindows('extensions:errors-updated', { extensionId, totalCount });
            broadcastToShellWindows('extensions:updated', {});
        }, BROADCAST_DEBOUNCE_MS);
        this._debounceTimers.set(extensionId, timer);
    }

    /**
     * Gets all error records for an extension (newest first).
     */
    getErrors(extensionId) {
        if (!extensionId) return [];
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const extErrors = this.errors.get(cleanId);
        if (!extErrors) return [];
        return extErrors.map(e => ({ ...e }));
    }

    /**
     * Gets total distinct error count for an extension.
     */
    getErrorCount(extensionId) {
        if (!extensionId) return 0;
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        return this.errors.get(cleanId)?.length || 0;
    }

    /**
     * Clears all errors for an extension (e.g. "Clear all" button, reload, or uninstall).
     */
    clearErrors(extensionId) {
        if (!extensionId) return;
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        this.errors.delete(cleanId);
        this.errorIndex.delete(cleanId);
        this.rateLimits.delete(cleanId);
        this._notifyUpdate(cleanId);
    }

    /**
     * Clears a single error by record ID.
     */
    clearError(extensionId, errorId) {
        if (!extensionId || !errorId) return false;
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const extErrors = this.errors.get(cleanId);
        const extIndex = this.errorIndex.get(cleanId);
        if (!extErrors || !extIndex) return false;

        const idx = extErrors.findIndex(e => e.id === errorId);
        if (idx !== -1) {
            const removed = extErrors.splice(idx, 1)[0];
            const fp = this._createFingerprint(removed);
            extIndex.delete(fp);
            this._notifyUpdate(cleanId);
            return true;
        }
        return false;
    }

    /**
     * Resets tracking state for an extension (used on reload/uninstall).
     */
    resetExtension(extensionId) {
        this.clearErrors(extensionId);
    }

    /**
     * Safely reads and extracts 3 lines before & after the failing line for code preview.
     * Guaranteed path traversal security (constrained within ext.path).
     */
    getCodeSnippet(extensionId, relativeSourcePath, targetLine) {
        if (!extensionId || !relativeSourcePath) {
            return { error: 'Invalid parameters' };
        }
        const cleanId = ExtensionStorage.sanitizeExtensionId(extensionId);
        const ext = ExtensionStorage.findExtension(cleanId);
        if (!ext?.path) {
            return { error: 'Extension directory not found' };
        }

        // Clean source path and strip query strings or hash
        const cleanSource = String(relativeSourcePath)
            .split('?')[0]
            .split('#')[0]
            .replace(/^[/\\]+/, '');

        const extRoot = path.resolve(ext.path);
        const resolvedPath = path.resolve(extRoot, cleanSource);

        // Path Traversal Security Guard: target MUST be strictly inside extRoot
        if (!resolvedPath.startsWith(extRoot + path.sep) && resolvedPath !== extRoot) {
            return { error: 'Access denied: Target path outside extension root' };
        }

        if (!fs.existsSync(resolvedPath)) {
            return { error: `File not found: ${cleanSource}` };
        }

        try {
            const stat = fs.statSync(resolvedPath);
            // Cap to max 2 MB to prevent reading huge assets or bundles
            if (stat.size > 2 * 1024 * 1024) {
                return { error: 'File too large for code preview (>2MB)' };
            }

            const content = fs.readFileSync(resolvedPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            const lineNum = Math.max(1, parseInt(targetLine, 10) || 1);

            const startLine = Math.max(1, lineNum - 3);
            const endLine = Math.min(lines.length, lineNum + 3);

            const snippetLines = [];
            for (let i = startLine; i <= endLine; i++) {
                snippetLines.push({
                    lineNum: i,
                    content: lines[i - 1].slice(0, 500), // truncate ultra-long lines
                    isTarget: i === lineNum,
                });
            }

            return {
                lines: snippetLines,
                totalLines: lines.length,
                highlightLine: lineNum,
                error: null,
            };
        } catch (err) {
            return { error: err?.message || 'Failed to read source file' };
        }
    }
}

// Global Singleton
let _instance = null;
function getExtensionErrorManager() {
    if (!_instance) {
        _instance = new ExtensionErrorManager();
    }
    return _instance;
}

module.exports = {
    ExtensionErrorManager,
    getExtensionErrorManager,
};
