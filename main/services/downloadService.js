const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');

let appInstance = null;
let encryption = null;
const registeredSessions = new WeakSet();
const sessionsByProfileId = new Map();

// id -> { item, record, lastBytes, lastTime, lastBroadcastTime }
const activeDownloads = new Map();

// profileId -> Array<DownloadRecord>
const historyCacheByProfile = new Map();

function init(appObj, encryptionModule) {
    appInstance = appObj || app;
    encryption = encryptionModule;
}

function getApp() {
    return appInstance || app;
}

function getDownloadsFilePath(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    const safeProfileId = String(effectiveProfileId).replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(getApp().getPath('userData'), `downloads-${safeProfileId}.json`);
}

function deduplicateHistory(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const result = [];
    for (const item of list) {
        if (!item || !item.id) continue;
        if (!seen.has(item.id)) {
            seen.add(item.id);
            result.push(item);
        }
    }
    return result;
}

function loadHistory(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    if (historyCacheByProfile.has(effectiveProfileId)) {
        return historyCacheByProfile.get(effectiveProfileId);
    }

    try {
        const filePath = getDownloadsFilePath(effectiveProfileId);
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            let list = [];
            if (parsed && parsed.encrypted !== undefined && encryption) {
                const dec = encryption.decrypt(parsed);
                list = dec ? JSON.parse(dec) : [];
            } else if (Array.isArray(parsed)) {
                list = parsed;
            }
            const deduped = deduplicateHistory(list);
            historyCacheByProfile.set(effectiveProfileId, deduped);
            return deduped;
        }
    } catch (e) {
        console.error('[DownloadService] Failed to load downloads history:', e?.message || e);
    }

    const empty = [];
    historyCacheByProfile.set(effectiveProfileId, empty);
    return empty;
}

function saveHistory(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    try {
        const list = historyCacheByProfile.get(effectiveProfileId) || [];
        const deduped = deduplicateHistory(list);
        historyCacheByProfile.set(effectiveProfileId, deduped);
        const filePath = getDownloadsFilePath(effectiveProfileId);
        if (encryption) {
            const payload = encryption.encrypt(JSON.stringify(deduped));
            fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
        } else {
            fs.writeFileSync(filePath, JSON.stringify(deduped, null, 2), 'utf-8');
        }
    } catch (e) {
        console.error('[DownloadService] Failed to save downloads history:', e?.message || e);
    }
}

function upsertHistoryRecord(profileId, record) {
    if (!record || !record.id) return;
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    const history = loadHistory(effectiveProfileId);
    const existingIndex = history.findIndex(item => item.id === record.id);
    if (existingIndex >= 0) {
        history[existingIndex] = { ...history[existingIndex], ...record };
    } else {
        history.unshift(record);
    }
    if (history.length > 500) history.length = 500;
    saveHistory(effectiveProfileId);
}

function getUnusedFilePath(dir, filename) {
    const safeFilename = filename.replace(/[/\\?%*:|"<>]/g, '_');
    const ext = path.extname(safeFilename);
    const base = path.basename(safeFilename, ext) || 'download';
    let candidate = path.join(dir, safeFilename);
    let counter = 1;
    while (
        fs.existsSync(candidate) ||
        fs.existsSync(candidate + '.invdownload') ||
        fs.existsSync(candidate + '.crdownload')
    ) {
        candidate = path.join(dir, `${base} (${counter})${ext}`);
        counter++;
    }
    return candidate;
}

function isPathInActiveUse(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    for (const entry of activeDownloads.values()) {
        const r = entry?.record;
        if (!r) continue;
        if (r.savePath === filePath || r.tempPath === filePath) return true;
        if ((r.savePath + '.invdownload') === filePath) return true;
        if (r.tempPath && r.tempPath.replace(/\.invdownload$/, '') === filePath) return true;
    }
    return false;
}

function cleanupPartialDownloadFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return;
    const targets = new Set();
    targets.add(filePath);
    targets.add(filePath + '.invdownload');
    targets.add(filePath + '.crdownload');
    if (filePath.endsWith('.invdownload')) {
        targets.add(filePath.slice(0, -'.invdownload'.length));
    }

    for (const p of targets) {
        if (isPathInActiveUse(p)) continue;
        try {
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
            }
        } catch (_) {}
    }
}

async function probeTotalBytes(url, { referrer } = {}) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return 0;
    try {
        let effectiveReferrer = referrer;
        if (!effectiveReferrer) {
            try {
                const u = new URL(url);
                effectiveReferrer = `${u.protocol}//${u.host}/`;
            } catch (_) {}
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        if (effectiveReferrer) {
            headers['Referer'] = effectiveReferrer;
        }

        // Try HEAD first (fastest, lightweight, returns Content-Length without downloading any body)
        try {
            const headCtrl = new AbortController();
            const headTimeout = setTimeout(() => headCtrl.abort(), 2500);
            const headRes = await fetch(url, {
                method: 'HEAD',
                headers,
                signal: headCtrl.signal,
            });
            clearTimeout(headTimeout);
            const cl = headRes.headers.get('content-length');
            if (cl && Number(cl) > 0) {
                return Number(cl);
            }
        } catch (_) {}

        // Fallback: GET with Range: bytes=0-0
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(url, {
            method: 'GET',
            headers: { ...headers, 'Range': 'bytes=0-0' },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        // Try Content-Range first (e.g. bytes 0-0/105748559)
        const contentRange = res.headers.get('content-range');
        if (contentRange) {
            const match = String(contentRange).match(/\/(\d+)$/);
            if (match && Number(match[1]) > 0) {
                return Number(match[1]);
            }
        }

        // Try Content-Length
        const contentLength = res.headers.get('content-length');
        if (contentLength && Number(contentLength) > 0) {
            return Number(contentLength);
        }

        return 0;
    } catch (_) {
        return 0;
    }
}

function broadcastDownloadEvent(channel, data) {
    if (!channel) return;
    for (const context of State.windowContextsById.values()) {
        if (context.window && !context.window.isDestroyed?.() && !context.window.webContents.isDestroyed?.()) {
            try {
                context.window.webContents.send(channel, data);
            } catch (_) {}
        }
        if (context.tabs && typeof context.tabs === 'object') {
            for (const view of Object.values(context.tabs)) {
                if (view?.webContents && !view.webContents.isDestroyed?.()) {
                    try {
                        view.webContents.send(channel, data);
                    } catch (_) {}
                }
            }
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed?.()) {
            try {
                context.chromeShellMenuOverlayView.webContents.send(channel, data);
            } catch (_) {}
        }
        if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed?.()) {
            try {
                context.chromeOverlayView.webContents.send(channel, data);
            } catch (_) {}
        }
    }
    if (State.detachedTabWindows) {
        for (const win of State.detachedTabWindows.values()) {
            if (win && !win.isDestroyed?.() && !win.webContents.isDestroyed?.()) {
                try {
                    win.webContents.send(channel, data);
                } catch (_) {}
            }
        }
    }
}

function registerSession(targetSession, { profileId = null, isStealth = false } = {}) {
    if (!targetSession) return;
    if (profileId) {
        sessionsByProfileId.set(profileId, targetSession);
    }
    if (registeredSessions.has(targetSession)) return;
    registeredSessions.add(targetSession);

    targetSession.on('will-download', (event, item, webContents) => {
        handleWillDownload(item, webContents, { profileId, isStealth, targetSession });
    });
}

function handleWillDownload(item, webContents, { profileId = null, isStealth = false, targetSession = null } = {}) {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalFilename = item.getFilename() || 'download';
    const downloadsFolder = getApp().getPath('downloads');
    const finalSavePath = getUnusedFilePath(downloadsFolder, originalFilename);
    const tempSavePath = finalSavePath + '.invdownload';

    try {
        if (fs.existsSync(tempSavePath)) {
            fs.unlinkSync(tempSavePath);
        }
    } catch (_) {}

    // Instruct Chromium to save to this temporary .invdownload path while in progress (like Chrome .crdownload)
    item.setSavePath(tempSavePath);

    const totalBytes = item.getTotalBytes() || 0;
    const initialReceived = item.getReceivedBytes() || 0;
    const initialPercent = totalBytes > 0 ? Math.round((initialReceived / totalBytes) * 100) : 0;

    let referrer = '';
    try {
        if (webContents && !webContents.isDestroyed()) {
            referrer = webContents.getURL() || '';
        }
    } catch (_) {}

    const urlChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
    const initialDownloadUrl = (urlChain && urlChain.length > 0) ? urlChain[0] : (item.getURL() || '');
    const directServerUrl = (urlChain && urlChain.length > 0) ? urlChain[urlChain.length - 1] : (item.getURL() || '');
    const downloadUrl = initialDownloadUrl || directServerUrl;

    const isCrxPackage = (
        (item.getMimeType() || '').toLowerCase() === 'application/x-chrome-extension' ||
        /\.crx$/i.test(originalFilename) ||
        /clients2\.google\.com\/service\/update2\/crx/i.test(downloadUrl) ||
        /clients2\.googleusercontent\.com\/crx\/blobs/i.test(downloadUrl)
    );

    const record = {
        id,
        filename: path.basename(finalSavePath),
        savePath: finalSavePath,
        tempPath: tempSavePath,
        url: downloadUrl,
        downloadUrl: downloadUrl,
        serverUrl: directServerUrl,
        originalUrl: downloadUrl,
        pageUrl: referrer || (initialDownloadUrl !== directServerUrl ? initialDownloadUrl : ''),
        referrer: referrer || '',
        mimeType: item.getMimeType() || '',
        totalBytes,
        receivedBytes: initialReceived,
        state: 'progressing',
        startTime: Date.now(),
        endTime: null,
        speedBytesPerSec: 0,
        estimatedTimeRemainingSec: null,
        percent: initialPercent,
        isStealth: !!isStealth,
        profileId: profileId || State.defaultProfileId || 'default',
        canResume: item.canResume(),
        errorMessage: null,
    };

    activeDownloads.set(id, {
        item,
        record,
        targetSession,
        lastBytes: initialReceived,
        lastTime: Date.now(),
        lastBroadcastTime: 0,
    });

    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_STARTED || 'downloads:started', record);
    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', record);

    // If total bytes is not provided by will-download, asynchronously probe using Range/HEAD
    if (totalBytes <= 0 && record.url) {
        probeTotalBytes(record.url, { referrer: record.referrer }).then((probedBytes) => {
            if (probedBytes > 0) {
                const active = activeDownloads.get(id);
                if (active && active.record && active.record.totalBytes <= 0) {
                    active.record.totalBytes = probedBytes;
                    if (active.record.receivedBytes > 0) {
                        active.record.percent = Math.min(100, Math.round((active.record.receivedBytes / probedBytes) * 100));
                    }
                    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_PROGRESS || 'downloads:progress', active.record);
                    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', active.record);
                }
            }
        }).catch(() => {});
    }

    item.on('updated', (updateEvent, state) => {
        const active = activeDownloads.get(id);
        if (!active) return;

        const now = Date.now();
        const received = item.getReceivedBytes() || 0;
        let total = item.getTotalBytes() || 0;
        if (total <= 0 && active.record.totalBytes > 0) {
            total = active.record.totalBytes;
        }

        const dt = (now - active.lastTime) / 1000;

        let speed = active.record.speedBytesPerSec;
        if (dt >= 0.4) {
            speed = Math.max(0, Math.round((received - active.lastBytes) / dt));
            active.lastBytes = received;
            active.lastTime = now;
        }

        const chain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
        if (chain.length > 0) {
            const finalChainUrl = chain[chain.length - 1];
            if (finalChainUrl && finalChainUrl !== active.record.serverUrl) {
                active.record.serverUrl = finalChainUrl;
            }
        }

        active.record.receivedBytes = received;
        active.record.totalBytes = total;
        active.record.speedBytesPerSec = speed;
        active.record.canResume = item.canResume();

        if (total > 0) {
            active.record.percent = Math.min(100, Math.round((received / total) * 100));
            if (speed > 0) {
                const remainingBytes = Math.max(0, total - received);
                active.record.estimatedTimeRemainingSec = Math.round(remainingBytes / speed);
            }
        } else {
            active.record.percent = 0;
            active.record.estimatedTimeRemainingSec = null;
        }

        if (state === 'interrupted') {
            active.record.state = item.isPaused() ? 'paused' : 'interrupted';
            if (active.record.state === 'paused') {
                active.record.speedBytesPerSec = 0;
            }
        } else if (state === 'progressing') {
            active.record.state = item.isPaused() ? 'paused' : 'progressing';
            if (active.record.state === 'paused') {
                active.record.speedBytesPerSec = 0;
            }
        }

        const stateChanged = active.record.state !== active.lastState;
        active.lastState = active.record.state;

        // Throttle progress updates to avoid IPC flooding (approx every 100ms), but broadcast immediately on state change
        if (stateChanged || (now - active.lastBroadcastTime >= 100)) {
            active.lastBroadcastTime = now;
            broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_PROGRESS || 'downloads:progress', active.record);
        }
    });

    item.once('done', (doneEvent, state) => {
        if (record.isDoneHandled) return;
        record.isDoneHandled = true;

        const active = activeDownloads.get(id);
        const finalRecord = active ? active.record : record;
        finalRecord.endTime = Date.now();
        finalRecord.speedBytesPerSec = 0;
        finalRecord.estimatedTimeRemainingSec = null;

        if (state === 'completed') {
            finalRecord.state = 'completed';
            const finalBytes = item.getReceivedBytes() || finalRecord.receivedBytes || 0;
            finalRecord.receivedBytes = finalBytes;
            if (finalRecord.totalBytes <= 0) {
                finalRecord.totalBytes = finalBytes;
            }
            finalRecord.percent = 100;

            // Rename .invdownload to the final savePath so it becomes the openable file
            try {
                const tempPath = finalRecord.tempPath || (finalRecord.savePath + '.invdownload');
                if (fs.existsSync(tempPath)) {
                    if (fs.existsSync(finalRecord.savePath)) {
                        try { fs.unlinkSync(finalRecord.savePath); } catch (_) {}
                    }
                    fs.renameSync(tempPath, finalRecord.savePath);
                }
            } catch (renameErr) {
                console.error('[DownloadService] Failed to rename .invdownload to final file:', renameErr);
            }

            // If this was an extension package (.crx), offer seamless installation without conflict
            if (isCrxPackage && fs.existsSync(finalRecord.savePath)) {
                try {
                    const { getExtensionController } = require('../extensions/ExtensionController');
                    const controller = getExtensionController();
                    const safeProf = finalRecord.profileId || State.defaultProfileId || 'default';
                    controller.prepareInstallFromFile(safeProf, finalRecord.savePath).then((prep) => {
                        if (prep && !prep.alreadyInstalled) {
                            const { getWindowContextByEventSender, getWindowContextForShellFallback } = require('../windows/windowContextUtils');
                            const context = (webContents ? getWindowContextByEventSender(webContents) : null) || getWindowContextForShellFallback();
                            if (context) {
                                const overlayManager = require('../windows/overlayManager');
                                overlayManager.showExtensionInstallPromptOverlay(context, prep);
                            }
                        }
                    }).catch((prepErr) => {
                        console.warn('[DownloadService] Direct CRX auto-prompt error:', prepErr?.message || prepErr);
                    });
                } catch (_) {}
            }
        } else {
            // Cancelled, failed, or interrupted and not resumable
            finalRecord.state = state === 'cancelled' ? 'cancelled' : 'failed';
            // Delete partially downloaded .invdownload file from disk immediately to avoid junk
            cleanupPartialDownloadFile(finalRecord.tempPath || finalRecord.savePath);
        }

        activeDownloads.delete(id);

        // Store into persistent history if not a stealth session
        if (!finalRecord.isStealth) {
            upsertHistoryRecord(finalRecord.profileId, finalRecord);
        }

        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_DONE || 'downloads:done', finalRecord);
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', finalRecord);
    });
}

function getAll(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    const active = [];
    const activeIds = new Set();
    for (const entry of activeDownloads.values()) {
        if (!entry.record.isStealth && entry.record.profileId === effectiveProfileId) {
            active.push(entry.record);
            activeIds.add(entry.record.id);
        } else if (entry.record.isStealth) {
            active.push(entry.record);
            activeIds.add(entry.record.id);
        }
    }

    const history = loadHistory(effectiveProfileId);
    // Deduplicate history, filter out actively downloading items, and check file existence on disk
    const dedupedHistory = deduplicateHistory(history).filter(item => !activeIds.has(item.id));
    const enrichedHistory = dedupedHistory.map(item => {
        let fileExists = false;
        if (item.state === 'completed' && item.savePath) {
            try {
                fileExists = fs.existsSync(item.savePath);
            } catch (_) {
                fileExists = false;
            }
        }
        return {
            ...item,
            fileExists,
        };
    });

    return {
        active,
        history: enrichedHistory,
    };
}

function cancelDownload(id) {
    const active = activeDownloads.get(id);
    if (!active) {
        return { success: false, error: 'Download not found or already completed.' };
    }

    // Mark handled so item.once('done') does not re-add or re-broadcast duplicate records
    active.record.isDoneHandled = true;

    try {
        active.item.cancel();
    } catch (_) {}

    // Cleanup partial file immediately
    cleanupPartialDownloadFile(active.record.tempPath || active.record.savePath);

    active.record.state = 'cancelled';
    active.record.endTime = Date.now();
    active.record.speedBytesPerSec = 0;
    active.record.estimatedTimeRemainingSec = null;

    activeDownloads.delete(id);

    if (!active.record.isStealth) {
        upsertHistoryRecord(active.record.profileId, active.record);
    }

    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_DONE || 'downloads:done', active.record);
    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', active.record);

    return { success: true };
}

function pauseDownload(id) {
    const active = activeDownloads.get(id);
    if (!active) return { success: false, error: 'Download not found.' };

    try {
        if (typeof active.item.isPaused === 'function' && !active.item.isPaused()) {
            active.item.pause();
        }
        active.record.state = 'paused';
        active.record.speedBytesPerSec = 0;
        active.record.canResume = typeof active.item.canResume === 'function' ? active.item.canResume() : true;
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_PROGRESS || 'downloads:progress', active.record);
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', active.record);
        return { success: true };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

function resumeDownload(id) {
    const active = activeDownloads.get(id);
    if (!active) return { success: false, error: 'Download not found.' };

    try {
        if (typeof active.item.resume === 'function') {
            active.item.resume();
        }
        active.record.state = 'progressing';
        active.record.canResume = typeof active.item.canResume === 'function' ? active.item.canResume() : true;
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_PROGRESS || 'downloads:progress', active.record);
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated', active.record);
        return { success: true };
    } catch (e) {
        console.error('[DownloadService] Failed to resume download:', e?.message || e);
        return { success: false, error: e?.message || String(e) };
    }
}

function getSessionForProfile(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    if (sessionsByProfileId.has(effectiveProfileId)) {
        return sessionsByProfileId.get(effectiveProfileId);
    }

    try {
        const { session } = require('electron');
        if (session) {
            const partition = `persist:profile-${effectiveProfileId}`;
            const ses = session.fromPartition(partition);
            registerSession(ses, { profileId: effectiveProfileId });
            return ses;
        }
    } catch (_) {}

    try {
        const { session } = require('electron');
        if (session?.defaultSession) {
            registerSession(session.defaultSession, { profileId: effectiveProfileId });
            return session.defaultSession;
        }
    } catch (_) {}

    return null;
}

function retryDownload(id, profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    let history = loadHistory(effectiveProfileId);
    let itemIndex = history.findIndex(entry => entry.id === id);
    let targetProfileId = effectiveProfileId;

    // If not found in effectiveProfileId, search all profile histories
    if (itemIndex < 0) {
        for (const [pId, hist] of historyCacheByProfile.entries()) {
            const idx = hist.findIndex(entry => entry.id === id);
            if (idx >= 0) {
                history = hist;
                itemIndex = idx;
                targetProfileId = pId;
                break;
            }
        }
    }

    if (itemIndex < 0) {
        return { success: false, error: 'Download record not found for retry.' };
    }

    const item = history[itemIndex];
    const targetUrl = item.downloadUrl || item.url || item.serverUrl;
    if (!targetUrl) {
        return { success: false, error: 'Download URL not available for retry.' };
    }

    // Clean up any old partial files synchronously if not actively in use
    if (item.savePath && !isPathInActiveUse(item.savePath)) {
        try { if (fs.existsSync(item.savePath)) fs.unlinkSync(item.savePath); } catch (_) {}
    }
    if (item.tempPath && !isPathInActiveUse(item.tempPath)) {
        try { if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath); } catch (_) {}
    }

    try {
        // Remove the retried item from history so it doesn't linger as duplicate alongside the restarted download
        const updated = history.filter(entry => entry.id !== id);
        historyCacheByProfile.set(targetProfileId, updated);
        saveHistory(targetProfileId);
        broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated');

        const targetSession = getSessionForProfile(item.profileId || targetProfileId);
        if (!targetSession || typeof targetSession.downloadURL !== 'function') {
            return { success: false, error: 'Session not available to restart download.' };
        }

        const options = {};
        if (item.referrer) {
            options.headers = {
                'Referer': item.referrer,
            };
        }

        targetSession.downloadURL(targetUrl, options);
        return { success: true };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

function showInFolder(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return { success: true };
        }
        if (filePath && fs.existsSync(filePath + '.invdownload')) {
            shell.showItemInFolder(filePath + '.invdownload');
            return { success: true };
        }
        // Fallback to downloads folder if file was moved or deleted
        shell.openPath(getApp().getPath('downloads'));
        return { success: true, fallback: true };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

function openFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            shell.openPath(filePath);
            return { success: true };
        }
        return { success: false, error: 'File does not exist on disk.' };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

function removeFromHistory(profileId, id) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    const history = loadHistory(effectiveProfileId);
    const filtered = history.filter(item => item.id !== id);
    historyCacheByProfile.set(effectiveProfileId, filtered);
    saveHistory(effectiveProfileId);
    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated');
    return { success: true };
}

function clearAllHistory(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    historyCacheByProfile.set(effectiveProfileId, []);
    saveHistory(effectiveProfileId);
    broadcastDownloadEvent(C.IPC_EVENT.DOWNLOAD_UPDATED || 'downloads:updated');
    return { success: true };
}

function openDownloadsFolder() {
    try {
        shell.openPath(getApp().getPath('downloads'));
        return { success: true };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    }
}

module.exports = {
    init,
    registerSession,
    getAll,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    retryDownload,
    showInFolder,
    openFile,
    removeFromHistory,
    clearAllHistory,
    openDownloadsFolder,
    getUnusedFilePath,
    cleanupPartialDownloadFile,
    loadHistory,
    saveHistory,
    broadcastDownloadEvent,
};
