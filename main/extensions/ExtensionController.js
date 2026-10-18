const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const ExtensionStorage = require('./ExtensionStorage');
const ExtensionInstaller = require('./ExtensionInstaller');
const { sanitizeExtensionId } = ExtensionStorage;

class ExtensionController extends EventEmitter {
    constructor() {
        super();
        /** Map of profileId -> Electron.Session */
        this.activeSessions = new Map();
        /** Map of profileId -> Map<extensionId, Electron.Extension> */
        this.loadedExtensions = new Map();
        /** Map of installToken -> pending install data */
        this.pendingInstalls = new Map();
        /** Map of `${profileId}:${extensionId}` -> WebContentsView (MV3 Background host) */
        this.backgroundHosts = new Map();
    }

    unloadProfile(profileId) {
        if (!profileId) return;
        const pId = ExtensionStorage.safeProfileId(profileId);
        for (const [key, view] of Array.from(this.backgroundHosts.entries())) {
            if (key.startsWith(`${pId}:`)) {
                try {
                    if (!view.webContents.isDestroyed()) {
                        view.webContents.close();
                    }
                } catch (_) {}
                this.backgroundHosts.delete(key);
            }
        }
        this.activeSessions.delete(pId);
        this.loadedExtensions.delete(pId);
        this.pendingInstalls.delete(pId);
    }

    /**
     * Associates an Electron session with a profile and loads its enabled extensions.
     */
    async registerSession(profileId, electronSession) {
        if (!profileId || !electronSession) return;
        const pId = ExtensionStorage.safeProfileId(profileId);
        this.activeSessions.set(pId, electronSession);

        try {
            const { getIpcBridge } = require('./compat/IpcBridge');
            getIpcBridge().attachToSession(electronSession);
        } catch (_) {}

        try {
            const { getDeclarativeNetRequestManager } = require('./compat/DeclarativeNetRequestManager');
            getDeclarativeNetRequestManager().attachToSession(electronSession);
        } catch (_) {}

        try {
            const { getDownloadManager } = require('./compat/DownloadManager');
            getDownloadManager().attachToSession(electronSession);
        } catch (_) {}

        try {
            const { getWebRequestManager } = require('./compat/WebRequestManager');
            getWebRequestManager().attachToSession(electronSession);
        } catch (_) {}

        if (!this.loadedExtensions.has(pId)) {
            this.loadedExtensions.set(pId, new Map());
        }

        const state = ExtensionStorage.readState(pId);
        const profileLoadedMap = this.loadedExtensions.get(pId);
        let stateDirty = false;

        for (const [extensionId, extData] of Object.entries(state)) {
            if (extData.enabled && extData.path) {
                try {
                    if (fs.existsSync(extData.path)) {
                        const ExtensionInstaller = require('./ExtensionInstaller');
                        ExtensionInstaller.ensureExtensionPolyfills(extData.path, extensionId);
                        const loaded = await electronSession.extensions.loadExtension(extData.path);
                        profileLoadedMap.set(extensionId, loaded);
                        this._loadStaticRulesets(extensionId, extData.path);
                        if (loaded?.id && extData.runtimeId !== loaded.id) {
                            extData.runtimeId = loaded.id;
                            stateDirty = true;
                        }
                        await this.ensureBackgroundHost(pId, extensionId, extData.path, electronSession);
                        console.log(`[ExtensionController] Loaded extension "${extData.name}" (${extensionId}, runtimeId: ${loaded?.id}) for profile ${pId}`);
                    } else {
                        console.warn(`[ExtensionController] Path not found for extension ${extensionId}: ${extData.path}`);
                    }
                } catch (loadErr) {
                    try {
                        const { getExtensionErrorManager } = require('./ExtensionErrorManager');
                        getExtensionErrorManager().reportError(extensionId, {
                            message: `Failed to load extension: ${loadErr?.message || loadErr}`,
                            stack: loadErr?.stack || '',
                            source: 'manifest.json',
                            type: 'manifest',
                            context: 'system'
                        });
                    } catch (_) {}
                    console.error(`[ExtensionController] Failed to load extension ${extensionId} for profile ${pId}:`, loadErr?.message || loadErr);
                }
            }
        }

        if (stateDirty) {
            ExtensionStorage.writeState(pId, state);
        }

        this.emit('extensions-updated', { profileId: pId });
    }

    /**
     * Ensures an MV3 extension's background host WebContentsView is instantiated and active.
     */
    async ensureBackgroundHost(profileId, extensionId, extPath, electronSession) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        if (!cleanId) return null;

        const hostKey = `${pId}:${cleanId}`;
        const existingView = this.backgroundHosts.get(hostKey);
        if (existingView) {
            try {
                if (!existingView.webContents.isDestroyed()) {
                    return existingView;
                }
            } catch (_) {}
            this.backgroundHosts.delete(hostKey);
        }

        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId] || ExtensionStorage.findExtension(cleanId);
        const resolvedPath = extPath || ext?.path;
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return null;
        }

        const manifestPath = path.join(resolvedPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            return null;
        }

        let manifest = null;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        } catch (_) {
            return null;
        }

        const hasServiceWorker = !!manifest.background?.service_worker;
        if (!hasServiceWorker) {
            return null;
        }

        // Ensure _invisurf_background_page.html exists
        const bgHtmlPath = path.join(resolvedPath, '_invisurf_background_page.html');
        if (!fs.existsSync(bgHtmlPath)) {
            try {
                const ExtensionInstaller = require('./ExtensionInstaller');
                ExtensionInstaller.ensureExtensionPolyfills(resolvedPath, cleanId);
            } catch (_) {}
        }
        if (!fs.existsSync(bgHtmlPath)) {
            return null;
        }

        const session = electronSession || this.activeSessions.get(pId) || require('electron').session.defaultSession;
        const partition = `persist:profile-${pId}`;

        try {
            const { WebContentsView } = require('electron');
            const { buildExtensionWebPreferences } = require('../../runtime/webPreferences');
            const view = new WebContentsView({
                webPreferences: buildExtensionWebPreferences({ partition }),
            });

            try {
                const { getIpcBridge } = require('./compat/IpcBridge');
                getIpcBridge().attachToSession(view.webContents.session || session);
            } catch (_) {}

            this.backgroundHosts.set(hostKey, view);

            view.webContents.once('destroyed', () => {
                if (this.backgroundHosts.get(hostKey) === view) {
                    this.backgroundHosts.delete(hostKey);
                }
            });

            const targetExtId = ext?.runtimeId || cleanId;
            const targetUrl = `chrome-extension://${targetExtId}/_invisurf_background_page.html`;

            await view.webContents.loadURL(targetUrl);
            console.log(`[ExtensionController] Started MV3 background host for "${cleanId}" (${targetUrl})`);
            return view;
        } catch (err) {
            this.backgroundHosts.delete(hostKey);
            console.warn(`[ExtensionController] Failed to start MV3 background host for "${cleanId}":`, err?.message || err);
            return null;
        }
    }

    /**
     * Checks if an extension is installed and enabled for a profile.
     */
    isExtensionInstalled(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        return !!state[cleanId];
    }

    /**
     * Returns full list of extensions installed for a profile.
     */
    getInstalledExtensions(profileId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const state = ExtensionStorage.readState(pId);
        // Ensure max 6 pinned extensions in FIFO order if existing state has excess
        const allPinned = Object.values(state).filter(e => e && e.pinned);
        if (allPinned.length > 6) {
            allPinned.sort((a, b) => (Number(a.pinnedAt) || 0) - (Number(b.pinnedAt) || 0));
            const excess = allPinned.length - 6;
            for (let i = 0; i < excess; i++) {
                allPinned[i].pinned = false;
                delete allPinned[i].pinnedAt;
            }
            ExtensionStorage.writeState(pId, state);
        }
        const profileLoadedMap = this.loadedExtensions.get(pId) || new Map();

        return Object.values(state).map((ext) => {
            let iconDataUrl = ext.iconDataUrl || null;
            if (!iconDataUrl && ext.path && ext.iconRelativePath) {
                const iconFullPath = path.join(ext.path, ext.iconRelativePath);
                if (fs.existsSync(iconFullPath)) {
                    try {
                        const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                        const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                        const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                        iconDataUrl = `data:${mime};base64,${iconBase64}`;
                    } catch (_) { }
                }
            }
            const loaded = profileLoadedMap.get(ext.id);
            const runtimeId = ext.runtimeId || loaded?.id || ext.id;
            let actionState = null;
            try {
                const { getActionManager } = require('./compat/ActionManager');
                actionState = getActionManager().getState(ext.id);
            } catch (_) {}

            let urlPatterns = ext.urlPatterns;
            let hasAllUrls = ext.hasAllUrls;
            let isPageAction = ext.isPageAction;

            if (hasAllUrls === undefined && ext.path && fs.existsSync(ext.path)) {
                try {
                    const mPath = path.join(ext.path, 'manifest.json');
                    if (fs.existsSync(mPath)) {
                        const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
                        const patterns = [];
                        if (Array.isArray(manifest.host_permissions)) {
                            patterns.push(...manifest.host_permissions);
                        }
                        if (Array.isArray(manifest.permissions)) {
                            manifest.permissions.forEach(p => {
                                if (typeof p === 'string' && (p.includes('://') || p === '<all_urls>')) {
                                    patterns.push(p);
                                }
                            });
                        }
                        if (Array.isArray(manifest.content_scripts)) {
                            manifest.content_scripts.forEach(cs => {
                                if (Array.isArray(cs.matches)) patterns.push(...cs.matches);
                            });
                        }
                        urlPatterns = Array.from(new Set(patterns));
                        const allUrlsSet = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
                        hasAllUrls = urlPatterns.some(p => allUrlsSet.includes(String(p).trim()));
                        isPageAction = !!(manifest.page_action || (manifest.action && manifest.action.default_state === 'disabled'));
                    }
                } catch (_) {}
            }

            let hasOptionsPage = ext.hasOptionsPage;
            let optionsPage = ext.optionsPage;
            if ((hasOptionsPage === undefined || optionsPage === undefined) && ext.path && fs.existsSync(ext.path)) {
                try {
                    const mPath = path.join(ext.path, 'manifest.json');
                    if (fs.existsSync(mPath)) {
                        const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
                        let opt = null;
                        if (manifest.options_ui && typeof manifest.options_ui.page === 'string') {
                            opt = manifest.options_ui.page.trim();
                        } else if (typeof manifest.options_page === 'string') {
                            opt = manifest.options_page.trim();
                        }
                        optionsPage = opt;
                        hasOptionsPage = !!opt;
                    }
                } catch (_) {}
            }

            let errorCount = 0;
            try {
                const { getExtensionErrorManager } = require('./ExtensionErrorManager');
                errorCount = getExtensionErrorManager().getErrorCount(ext.id);
            } catch (_) {}

            return {
                ...ext,
                runtimeId,
                iconDataUrl,
                isLoaded: profileLoadedMap.has(ext.id),
                actionState,
                urlPatterns: urlPatterns || [],
                hasAllUrls: hasAllUrls !== undefined ? hasAllUrls : true,
                isPageAction: !!isPageAction,
                hasOptionsPage: !!hasOptionsPage,
                optionsPage: optionsPage || null,
                errorCount,
                hasErrors: errorCount > 0,
            };
        });
    }

    /**
     * Stage 1 of Web Store installation:
     * Downloads CRX, extracts safely, parses manifest & permissions, and returns metadata for user consent.
     */
    async prepareInstallFromWebStore(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);

        if (!cleanId || cleanId.length !== 32) {
            throw new Error(`Invalid extension ID: ${extensionId}. Expected a 32-character ID.`);
        }

        // Check if already installed
        const state = ExtensionStorage.readState(pId);
        if (state[cleanId]) {
            console.log(`[ExtensionController] Extension "${state[cleanId].name || cleanId}" is already installed for profile ${pId}`);
            return {
                alreadyInstalled: true,
                extensionId: cleanId,
                name: state[cleanId].name || cleanId,
                version: state[cleanId].version || '1.0.0',
            };
        }

        const stagingDir = ExtensionStorage.prepareStagingDir(pId, cleanId);
        const tempCrxPath = path.join(stagingDir, 'package.crx');

        try {
            console.log(`[ExtensionController] Downloading extension ${cleanId} for profile ${pId}...`);
            await ExtensionInstaller.downloadCrxFromWebStore(cleanId, tempCrxPath);

            console.log(`[ExtensionController] Extracting extension ${cleanId}...`);
            const crxBuffer = fs.readFileSync(tempCrxPath);
            const zipBuffer = ExtensionInstaller.extractZipBufferFromCrx(crxBuffer, cleanId);
            await ExtensionInstaller.unpackZipBuffer(zipBuffer, stagingDir);
            if (zipBuffer.publicKey) {
                ExtensionInstaller.injectManifestKey(stagingDir, zipBuffer.publicKey);
            }

            // Clean up temporary CRX archive file
            try { fs.unlinkSync(tempCrxPath); } catch (_) { }

            // Validate and inspect manifest
            const inspection = ExtensionInstaller.inspectExtractedExtension(stagingDir);

            // Read icon as base64 data URL if present
            let iconDataUrl = null;
            if (inspection.iconRelativePath) {
                const iconFullPath = path.join(stagingDir, inspection.iconRelativePath);
                if (fs.existsSync(iconFullPath)) {
                    try {
                        const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                        const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                        const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                        iconDataUrl = `data:${mime};base64,${iconBase64}`;
                    } catch (_) { /* ignore icon reading error */ }
                }
            }

            const installToken = crypto.randomUUID();
            this.pendingInstalls.set(installToken, {
                installToken,
                profileId: pId,
                extensionId: cleanId,
                stagingDir,
                inspection,
                createdAt: Date.now(),
            });

            return {
                installToken,
                extensionId: cleanId,
                name: inspection.name,
                version: inspection.version,
                description: inspection.description,
                iconDataUrl,
                hasPopup: inspection.hasPopup,
                warnings: (inspection.permissionsAudit?.warnings || []).map(w =>
                    typeof w === 'string' ? w : (w?.description || w?.title || w?.permission || String(w))
                ),
                permissions: inspection.permissionsAudit,
            };
        } catch (err) {
            // Cleanup staging directory on error
            try {
                if (fs.existsSync(stagingDir)) {
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                }
            } catch (_) { }
            throw err;
        }
    }

    /**
     * Prepares installation from a local CRX file (e.g. user-downloaded CRX package).
     */
    async prepareInstallFromFile(profileId, filePath) {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error('Extension file does not exist');
        }

        const pId = ExtensionStorage.safeProfileId(profileId);
        const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const stagingDir = ExtensionStorage.prepareStagingDir(pId, tempId);

        try {
            const fileBuffer = fs.readFileSync(filePath);
            const isCrx = fileBuffer.length >= 4 && fileBuffer.readUInt32LE(0) === 0x34327243;
            let zipBuffer;
            if (isCrx) {
                zipBuffer = ExtensionInstaller.extractZipBufferFromCrx(fileBuffer);
            } else {
                zipBuffer = fileBuffer;
            }

            await ExtensionInstaller.unpackZipBuffer(zipBuffer, stagingDir);
            if (zipBuffer.publicKey) {
                ExtensionInstaller.injectManifestKey(stagingDir, zipBuffer.publicKey);
            }

            const inspection = ExtensionInstaller.inspectExtractedExtension(stagingDir);
            const cleanId = inspection.extensionId || sanitizeExtensionId(path.basename(filePath, path.extname(filePath)));

            // Check if already installed
            const state = ExtensionStorage.readState(pId);
            if (state[cleanId]) {
                return {
                    alreadyInstalled: true,
                    extensionId: cleanId,
                    name: state[cleanId].name || cleanId,
                    version: state[cleanId].version || '1.0.0',
                };
            }

            let iconDataUrl = null;
            if (inspection.iconRelativePath) {
                const iconFullPath = path.join(stagingDir, inspection.iconRelativePath);
                if (fs.existsSync(iconFullPath)) {
                    try {
                        const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                        const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                        const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                        iconDataUrl = `data:${mime};base64,${iconBase64}`;
                    } catch (_) { }
                }
            }

            const installToken = crypto.randomUUID();
            this.pendingInstalls.set(installToken, {
                installToken,
                profileId: pId,
                extensionId: cleanId,
                stagingDir,
                inspection,
                createdAt: Date.now(),
            });

            return {
                installToken,
                extensionId: cleanId,
                name: inspection.name,
                version: inspection.version,
                description: inspection.description,
                iconDataUrl,
                hasPopup: inspection.hasPopup,
                warnings: (inspection.permissionsAudit?.warnings || []).map(w =>
                    typeof w === 'string' ? w : (w?.description || w?.title || w?.permission || String(w))
                ),
                permissions: inspection.permissionsAudit,
            };
        } catch (err) {
            try {
                if (fs.existsSync(stagingDir)) {
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                }
            } catch (_) { }
            throw err;
        }
    }

    /**
     * Stage 2 of Web Store installation:
     * User approved permissions modal. Atomically moves files to final directory and loads extension.
     */
    async confirmInstall(installToken) {
        const pending = this.pendingInstalls.get(installToken);
        if (!pending) {
            throw new Error('Install session expired or invalid');
        }

        const { profileId, extensionId, stagingDir, inspection } = pending;
        this.pendingInstalls.delete(installToken);

        try {
            console.log(`[ExtensionController] Promoting extension ${extensionId} to final destination...`);
            const finalPath = ExtensionStorage.promoteStaging(profileId, extensionId, inspection.version, stagingDir);

            // Read icon as base64 data URL if present
            let iconDataUrl = null;
            if (inspection.iconRelativePath) {
                const iconFullPath = path.join(finalPath, inspection.iconRelativePath);
                if (fs.existsSync(iconFullPath)) {
                    try {
                        const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                        const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                        const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                        iconDataUrl = `data:${mime};base64,${iconBase64}`;
                    } catch (_) { }
                }
            }

            // Read and update persistent state
            const state = ExtensionStorage.readState(profileId);
            const entry = {
                id: extensionId,
                name: inspection.name,
                version: inspection.version,
                description: inspection.description,
                enabled: true,
                pinned: true,
                pinnedAt: Date.now(),
                path: finalPath,
                iconRelativePath: inspection.iconRelativePath,
                iconDataUrl,
                hasPopup: inspection.hasPopup,
                popupFile: inspection.popupFile,
                hasOptionsPage: !!inspection.hasOptionsPage,
                optionsPage: inspection.optionsPage || null,
                installedAt: Date.now(),
                permissions: inspection.permissionsAudit,
            };

            state[extensionId] = entry;
            ExtensionStorage.writeState(profileId, state);

            // Load into active session if available
            const session = this.activeSessions.get(profileId) || (require('electron').session ? require('electron').session.defaultSession : null);
            if (session) {
                const loaded = await session.extensions.loadExtension(finalPath);
                let profileLoadedMap = this.loadedExtensions.get(profileId);
                if (!profileLoadedMap) {
                    profileLoadedMap = new Map();
                    this.loadedExtensions.set(profileId, profileLoadedMap);
                }
                profileLoadedMap.set(extensionId, loaded);
                if (loaded?.id) {
                    entry.runtimeId = loaded.id;
                    state[extensionId].runtimeId = loaded.id;
                    ExtensionStorage.writeState(profileId, state);
                }
                this._loadStaticRulesets(extensionId, finalPath);
                console.log(`[ExtensionController] Extension "${entry.name}" successfully loaded into session (runtimeId: ${loaded?.id}).`);
            }

            this.emit('extension-installed', { profileId, extension: entry });
            this.emit('extensions-updated', { profileId });

            return {
                success: true,
                extension: entry,
            };
        } catch (err) {
            console.error(`[ExtensionController] Failed to commit install for ${extensionId}:`, err);
            // Cleanup staging if it still exists
            try {
                if (fs.existsSync(stagingDir)) {
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                }
            } catch (_) { }
            throw err;
        }
    }

    /**
     * Cancels a pending install and removes staging directory.
     */
    cancelInstall(installToken) {
        const pending = this.pendingInstalls.get(installToken);
        if (!pending) return false;

        this.pendingInstalls.delete(installToken);
        try {
            if (fs.existsSync(pending.stagingDir)) {
                fs.rmSync(pending.stagingDir, { recursive: true, force: true });
            }
        } catch (_) { }
        return true;
    }

    /**
     * Loads an unpacked extension directory directly.
     */
    async loadUnpackedExtension(profileId, dirPath) {
        if (!dirPath || !fs.existsSync(dirPath)) {
            throw new Error('Selected directory does not exist');
        }

        const resolvedPath = path.resolve(dirPath);
        const manifestPath = path.join(resolvedPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('manifest.json was not found in the selected directory.');
        }

        const pId = ExtensionStorage.safeProfileId(profileId);
        const ExtensionInstaller = require('./ExtensionInstaller');

        // Inspect extension manifest
        const inspection = ExtensionInstaller.inspectExtractedExtension(resolvedPath);

        // Load into active session first so Electron computes the canonical extension ID
        const session = this.activeSessions.get(pId);
        let loaded = null;
        if (session) {
            try {
                loaded = await session.extensions.loadExtension(resolvedPath);
            } catch (loadErr) {
                console.error(`[ExtensionController] Error loading unpacked extension from ${resolvedPath}:`, loadErr);
                throw new Error(`Failed to load unpacked extension: ${loadErr?.message || loadErr}`);
            }
        }

        // Canonical ID assigned by Electron/Chromium or fallback to 32-char path hash
        let extId = loaded?.id;
        if (!extId) {
            const crypto = require('crypto');
            const hash = crypto.createHash('sha256').update(resolvedPath).digest();
            extId = '';
            for (let i = 0; i < 16; i++) {
                const byte = hash[i];
                extId += String.fromCharCode(97 + (byte >> 4));
                extId += String.fromCharCode(97 + (byte & 0x0f));
            }
        }

        // Ensure polyfills are applied with canonical ID
        ExtensionInstaller.ensureExtensionPolyfills(resolvedPath, extId);

        let profileLoadedMap = this.loadedExtensions.get(pId);
        if (!profileLoadedMap) {
            profileLoadedMap = new Map();
            this.loadedExtensions.set(pId, profileLoadedMap);
        }
        if (loaded) {
            profileLoadedMap.set(extId, loaded);
        }
        this._loadStaticRulesets(extId, resolvedPath);

        // Read icon as base64 data URL if present
        let iconDataUrl = null;
        if (inspection.iconRelativePath) {
            const iconFullPath = path.join(resolvedPath, inspection.iconRelativePath);
            if (fs.existsSync(iconFullPath)) {
                try {
                    const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                    const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                    const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                    iconDataUrl = `data:${mime};base64,${iconBase64}`;
                } catch (_) { }
            }
        }

        const state = ExtensionStorage.readState(pId);
        const entry = {
            id: extId,
            runtimeId: loaded?.id || extId,
            name: inspection.name,
            version: inspection.version,
            description: inspection.description || '',
            enabled: true,
            pinned: true,
            pinnedAt: Date.now(),
            path: resolvedPath,
            isUnpacked: true,
            iconRelativePath: inspection.iconRelativePath,
            iconDataUrl,
            hasPopup: inspection.hasPopup,
            popupFile: inspection.popupFile,
            hasOptionsPage: !!inspection.hasOptionsPage,
            optionsPage: inspection.optionsPage || null,
            installedAt: Date.now(),
            permissions: inspection.permissionsAudit,
            allowedOrigins: [],
        };

        state[extId] = entry;
        ExtensionStorage.writeState(pId, state);

        await this.ensureBackgroundHost(pId, extId, resolvedPath, session);

        this.emit('extension-installed', { profileId: pId, extension: entry });
        this.emit('extensions-updated', { profileId: pId });
        console.log(`[ExtensionController] Successfully loaded unpacked extension "${entry.name}" (${extId}) from ${resolvedPath}`);

        return entry;
    }

    /**
     * Reloads an extension (unloads and reloads from disk).
     */
    async reloadExtension(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext || !ext.path || !fs.existsSync(ext.path)) {
            throw new Error(`Extension ${cleanId} not found or path missing`);
        }

        // 1. Unload from active sessions and reset error records
        try {
            const { getExtensionErrorManager } = require('./ExtensionErrorManager');
            getExtensionErrorManager().resetExtension(cleanId);
        } catch (_) {}

        for (const [sessPid, s] of this.activeSessions.entries()) {
            try { s.extensions.removeExtension(cleanId); } catch (_) {}
            if (ext.runtimeId && ext.runtimeId !== cleanId) {
                try { s.extensions.removeExtension(ext.runtimeId); } catch (_) {}
            }
        }

        const profileLoadedMap = this.loadedExtensions.get(pId);
        if (profileLoadedMap) {
            profileLoadedMap.delete(cleanId);
        }

        this._unloadExtensionCompat(cleanId);

        // 2. Re-inspect manifest in case files changed
        const ExtensionInstaller = require('./ExtensionInstaller');
        ExtensionInstaller.ensureExtensionPolyfills(ext.path, cleanId);
        const inspection = ExtensionInstaller.inspectExtractedExtension(ext.path);
        ext.name = inspection.name;
        ext.version = inspection.version;
        ext.description = inspection.description || '';
        ext.hasPopup = inspection.hasPopup;
        ext.popupFile = inspection.popupFile;
        ext.permissions = inspection.permissionsAudit;

        // 3. Re-load into current profile session if enabled
        if (ext.enabled) {
            const session = this.activeSessions.get(pId);
            if (session) {
                try {
                    const loaded = await session.extensions.loadExtension(ext.path);
                    if (loaded?.id) {
                        ext.runtimeId = loaded.id;
                    }
                    if (profileLoadedMap) {
                        profileLoadedMap.set(cleanId, loaded);
                    }
                    this._loadStaticRulesets(cleanId, ext.path);
                    await this.ensureBackgroundHost(pId, cleanId, ext.path, session);
                } catch (loadErr) {
                    try {
                        const { getExtensionErrorManager } = require('./ExtensionErrorManager');
                        getExtensionErrorManager().reportError(cleanId, {
                            message: `Failed to reload extension: ${loadErr?.message || loadErr}`,
                            stack: loadErr?.stack || '',
                            source: 'manifest.json',
                            type: 'manifest',
                            context: 'system'
                        });
                    } catch (_) {}
                    console.error(`[ExtensionController] Error reloading extension ${cleanId}:`, loadErr);
                }
            }
        }

        ExtensionStorage.writeState(pId, state);
        this.emit('extensions-updated', { profileId: pId });
        console.log(`[ExtensionController] Reloaded extension "${ext.name}" (${cleanId})`);
        return ext;
    }

    /**
     * Enables a disabled extension.
     */
    async enableExtension(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];

        if (!ext) {
            throw new Error(`Extension ${cleanId} not found`);
        }

        if (ext.enabled) return ext;

        ext.enabled = true;
        ExtensionStorage.writeState(pId, state);

        const session = this.activeSessions.get(pId);
        if (session && ext.path && fs.existsSync(ext.path)) {
            try {
                const loaded = await session.extensions.loadExtension(ext.path);
                let profileLoadedMap = this.loadedExtensions.get(pId);
                if (!profileLoadedMap) {
                    profileLoadedMap = new Map();
                    this.loadedExtensions.set(pId, profileLoadedMap);
                }
                profileLoadedMap.set(cleanId, loaded);
                this._loadStaticRulesets(cleanId, ext.path);
                await this.ensureBackgroundHost(pId, cleanId, ext.path, session);
            } catch (err) {
                console.error(`[ExtensionController] Failed to load enabled extension ${cleanId}:`, err);
            }
        }

        this.emit('extensions-updated', { profileId: pId });
        return ext;
    }

    /**
     * Disables an enabled extension (unloads from Chromium session).
     */
    async disableExtension(profileId, extensionId) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];

        if (!ext) {
            throw new Error(`Extension ${cleanId} not found`);
        }

        if (!ext.enabled) return ext;

        ext.enabled = false;
        ExtensionStorage.writeState(pId, state);

        const session = this.activeSessions.get(pId);
        if (session) {
            try {
                session.extensions.removeExtension(cleanId);
            } catch (err) {
                console.warn(`[ExtensionController] Error removing extension ${cleanId} from session:`, err?.message || err);
            }
        }

        const profileLoadedMap = this.loadedExtensions.get(pId);
        if (profileLoadedMap) {
            profileLoadedMap.delete(cleanId);
        }

        this._unloadExtensionCompat(cleanId);

        this.emit('extensions-updated', { profileId: pId });
        return ext;
    }

    /**
     * Completely uninstalls an extension.
     */
    async uninstallExtension(profileId, extensionId) {
        let pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        let state = ExtensionStorage.readState(pId);

        // Fallback: search all profiles if not found in given profile
        if (!state[cleanId]) {
            const allProfiles = ExtensionStorage.listProfileIds ? ExtensionStorage.listProfileIds() : [];
            for (const otherPid of allProfiles) {
                const otherState = ExtensionStorage.readState(otherPid);
                if (otherState[cleanId]) {
                    pId = otherPid;
                    state = otherState;
                    break;
                }
            }
        }

        if (!state[cleanId]) {
            // Also ensure any leftover extension directory on disk is purged
            ExtensionStorage.deleteExtensionFiles(pId, cleanId);
            return false;
        }

        const ext = state[cleanId];
        const runtimeId = ext?.runtimeId;

        // Remove from all active Electron sessions
        for (const [sessPid, s] of this.activeSessions.entries()) {
            try { s.extensions.removeExtension(cleanId); } catch (_) {}
            if (runtimeId && runtimeId !== cleanId) {
                try { s.extensions.removeExtension(runtimeId); } catch (_) {}
            }
        }

        const profileLoadedMap = this.loadedExtensions.get(pId);
        if (profileLoadedMap) {
            profileLoadedMap.delete(cleanId);
        }

        this._unloadExtensionCompat(cleanId);

        // Delete from state and purge disk files (for downloaded/installed extensions only)
        delete state[cleanId];
        ExtensionStorage.writeState(pId, state);
        if (!ext?.isUnpacked) {
            ExtensionStorage.deleteExtensionFiles(pId, cleanId);
        }

        // Also clean up any other profile that might have registered this extension
        const allProfiles = ExtensionStorage.listProfileIds ? ExtensionStorage.listProfileIds() : [];
        for (const otherPid of allProfiles) {
            if (otherPid !== pId) {
                const otherState = ExtensionStorage.readState(otherPid);
                if (otherState[cleanId]) {
                    const otherExt = otherState[cleanId];
                    delete otherState[cleanId];
                    ExtensionStorage.writeState(otherPid, otherState);
                    if (!otherExt?.isUnpacked) {
                        ExtensionStorage.deleteExtensionFiles(otherPid, cleanId);
                    }
                }
            }
        }

        try {
            const { getExtensionErrorManager } = require('./ExtensionErrorManager');
            getExtensionErrorManager().resetExtension(cleanId);
        } catch (_) {}

        this.emit('extension-uninstalled', { profileId: pId, extensionId: cleanId });
        this.emit('extensions-updated', { profileId: pId });
        return true;
    }

    /**
     * Toggles whether an extension is pinned to the toolbar.
     * Enforces a FIFO queue limited to a maximum of 6 pinned extensions:
     * When pinning a 7th extension, the oldest pinned extension (first in) is automatically unpinned (first out).
     */
    togglePinExtension(profileId, extensionId, maxPinned = 6) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext) return null;

        ext.pinned = !ext.pinned;
        if (ext.pinned) {
            ext.pinnedAt = Date.now();

            // FIFO queue logic: ensure at most `maxPinned` extensions are pinned
            const otherPinned = Object.values(state).filter(e => e && e.id !== cleanId && e.pinned);
            if (otherPinned.length >= maxPinned) {
                // Sort ascending by pinnedAt (oldest first: FIFO)
                otherPinned.sort((a, b) => (Number(a.pinnedAt) || 0) - (Number(b.pinnedAt) || 0));
                const excessCount = (otherPinned.length - maxPinned) + 1;
                for (let i = 0; i < excessCount; i++) {
                    const oldest = otherPinned[i];
                    if (oldest) {
                        oldest.pinned = false;
                        delete oldest.pinnedAt;
                    }
                }
            }
        } else {
            delete ext.pinnedAt;
        }

        ExtensionStorage.writeState(pId, state);
        this.emit('extensions-updated', { profileId: pId });
        return ext;
    }

    /**
     * Grants permission for an extension to access a specific site origin.
     */
    grantOriginAccess(profileId, extensionId, origin) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext) return null;

        if (!Array.isArray(ext.allowedOrigins)) {
            ext.allowedOrigins = [];
        }
        if (!ext.allowedOrigins.includes(origin)) {
            ext.allowedOrigins.push(origin);
            ExtensionStorage.writeState(pId, state);
            this.emit('extensions-updated', { profileId: pId });
        }
        return ext;
    }

    /**
     * Sets site access mode for an extension ('onClick' | 'onHost' | 'all').
     */
    setSiteAccess(profileId, extensionId, mode, host) {
        const pId = ExtensionStorage.safeProfileId(profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext) return null;

        ext.siteAccess = mode;
        if (mode === 'onHost' && host) {
            if (!Array.isArray(ext.allowedHosts)) {
                ext.allowedHosts = [];
            }
            if (!ext.allowedHosts.includes(host)) {
                ext.allowedHosts.push(host);
            }
            if (!Array.isArray(ext.allowedOrigins)) {
                ext.allowedOrigins = [];
            }
            const origin = `https://${host}`;
            if (!ext.allowedOrigins.includes(origin)) {
                ext.allowedOrigins.push(origin);
            }
        }
        ExtensionStorage.writeState(pId, state);
        this.emit('extensions-updated', { profileId: pId });
        return ext;
    }

    /**
     * Inspects an active extension popup in devtools.
     */
    async inspectPopup(profileId, extensionId, context) {
        if (!context) return false;
        if (context.activeExtensionPopup && context.activeExtensionPopup.extensionId === extensionId) {
            const view = context.activeExtensionPopup.view;
            if (view && view.webContents && !view.webContents.isDestroyed()) {
                view.webContents.openDevTools({ mode: 'detach' });
                return true;
            }
        }
        return false;
    }

    /**
     * Opens an extension's declared options page in a new tab.
     */
    async openOptionsPage(profileId, extensionId, context = null) {
        const pId = ExtensionStorage.safeProfileId(profileId || context?.profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext) {
            console.warn(`[ExtensionController] openOptionsPage: Extension ${cleanId} not found`);
            return false;
        }

        let optionsPage = ext.optionsPage;
        if (!optionsPage && ext.path && fs.existsSync(ext.path)) {
            try {
                const manifestPath = path.join(ext.path, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                    optionsPage = manifest.options_ui?.page || manifest.options_page || null;
                }
            } catch (_) {}
        }

        if (!optionsPage) {
            console.warn(`[ExtensionController] Extension ${cleanId} does not declare an options page`);
            return false;
        }

        const targetUrl = `chrome-extension://${cleanId}/${String(optionsPage).replace(/^\/+/, '')}`;
        const { openUrlInNewTab } = require('../windows/tabManager');
        return openUrlInNewTab(targetUrl, { background: false, context });
    }

    /**
     * Activates an extension's action on the active tab of a window context.
     * If the extension has a popup, opens the popup overlay.
     * If it has an action script or content script, prompts permission if needed and executes it on the active tab.
     */
    async activateExtensionAction(profileId, extensionId, context, anchorRect) {
        if (!context?.window || context.window.isDestroyed()) return { ok: false, error: 'Window destroyed' };
        const pId = ExtensionStorage.safeProfileId(profileId || context.profileId);
        const cleanId = sanitizeExtensionId(extensionId);
        const state = ExtensionStorage.readState(pId);
        const ext = state[cleanId];
        if (!ext || !ext.enabled) return { ok: false, error: 'Extension not installed or enabled' };

        const activeTabId = context.activeTabId;
        const activeTab = context.tabs?.[activeTabId];
        if (!activeTab || !activeTab.webContents || activeTab.webContents.isDestroyed()) {
            return { ok: false, error: 'No active tab' };
        }

        const tabUrl = activeTab.webContents.getURL() || '';

        // Ensure extension is loaded into the exact session of this context
        const { session: electronSession } = require('electron');
        const session = context.partition
            ? electronSession.fromPartition(context.partition)
            : (this.activeSessions.get(pId) || electronSession.defaultSession);

        if (session && ext.path && fs.existsSync(ext.path)) {
            let profileLoadedMap = this.loadedExtensions.get(pId);
            if (!profileLoadedMap) {
                profileLoadedMap = new Map();
                this.loadedExtensions.set(pId, profileLoadedMap);
            }

            let isLoaded = false;
            try {
                const all = session.extensions.getAllExtensions();
                isLoaded = all.some(e => e.id === cleanId || e.id === ext.runtimeId || (ext.path && path.resolve(e.path) === path.resolve(ext.path)));
            } catch (_) {}

            if (!isLoaded) {
                try {
                    const ExtensionInstaller = require('./ExtensionInstaller');
                    ExtensionInstaller.ensureExtensionPolyfills(ext.path, cleanId);
                    const loaded = await session.extensions.loadExtension(ext.path);
                    profileLoadedMap.set(cleanId, loaded);
                    if (loaded?.id && ext.runtimeId !== loaded.id) {
                        ext.runtimeId = loaded.id;
                        ExtensionStorage.writeState(pId, state);
                    }
                    console.log(`[ExtensionController] Dynamically loaded extension ${cleanId} (id: ${loaded?.id}) into session`);
                } catch (loadErr) {
                    console.warn(`[ExtensionController] Dynamic load extension warning:`, loadErr?.message || loadErr);
                }
            }
        }

        // 1. Case A: Check dynamic action popup (per tab or global) or static manifest popup
        const { getActionManager } = require('./compat/ActionManager');
        const actionMgr = getActionManager();
        const activeTabWcId = activeTab?.webContents?.id;
        const currentTabPopup = actionMgr.getPopup(cleanId, { tabId: activeTabWcId });
        console.log(`[DEBUG-EXT] triggerExtensionAction: ext="${cleanId}" tabId=${activeTabWcId} currentTabPopup="${currentTabPopup}" staticPopup="${ext.popupFile}"`);

        const effectivePopup = currentTabPopup || (ext.hasPopup && ext.popupFile ? ext.popupFile : null);
        if (effectivePopup) {
            const overlayManager = require('../windows/overlayManager');
            const profileLoadedMap = this.loadedExtensions.get(pId);
            const loaded = profileLoadedMap?.get(cleanId);
            const runtimeId = ext.runtimeId || loaded?.id || ext.id;
            overlayManager.showExtensionPopup(context, { ...ext, runtimeId, popupFile: effectivePopup }, anchorRect);
            return { ok: true, popup: true };
        }

        // 2. Case B: Action extension (Measure-it, Dimensions, Page Ruler, etc.)
        // Auto-grant activeTab permission on action click
        if (tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
            try {
                const parsed = new URL(tabUrl);
                this.grantOriginAccess(pId, cleanId, parsed.origin);
            } catch (_) {}
        }

        const { getTabRegistry } = require('./compat/TabRegistry');
        const tabReg = getTabRegistry();
        let tabObj = tabReg.formatTab(context, activeTabId, activeTab, activeTab.webContents);
        if (!tabObj) {
            let width = 0;
            let height = 0;
            try {
                if (activeTab && typeof activeTab.getBounds === 'function') {
                    const b = activeTab.getBounds();
                    width = b?.width || 0;
                    height = b?.height || 0;
                }
                if ((!width || !height) && context?.window && typeof context.window.getContentBounds === 'function') {
                    const b = context.window.getContentBounds();
                    width = width || b?.width || 0;
                    height = height || b?.height || 0;
                }
            } catch (_) {}
            tabObj = {
                id: activeTab.webContents.id,
                index: 0,
                windowId: context.window?.id || 1,
                active: true,
                url: tabUrl,
                title: activeTab.webContents.getTitle(),
                width: width || 1280,
                height: height || 800,
            };
        }
        if (!tabObj.width || !tabObj.height) {
            const winBounds = context.window?.getContentBounds?.() || {};
            tabObj.width = tabObj.width || winBounds.width || 1280;
            tabObj.height = tabObj.height || winBounds.height || 800;
        }

        // Ensure background host is active for MV3 service worker extension
        try {
            await this.ensureBackgroundHost(pId, cleanId, ext.path, session);
        } catch (_) {}

        try {
            const { webContents } = require('electron');
            const allWc = typeof webContents?.getAllWebContents === 'function' ? webContents.getAllWebContents() : [];
            const targetIds = [cleanId, ext.id, ext.runtimeId].filter(Boolean).map(id => id.toLowerCase());
            const bgWc = Array.isArray(allWc) ? allWc.find(wc => {
                try {
                    if (!wc || wc.isDestroyed()) return false;
                    const u = (wc.getURL() || '').toLowerCase();
                    return targetIds.some(id => u.includes(id));
                } catch {
                    return false;
                }
            }) : null;

            if (bgWc && !bgWc.isDestroyed()) {
                bgWc.executeJavaScript(`
                    try {
                        const tab = ${JSON.stringify(tabObj)};
                        if (typeof chrome !== 'undefined') {
                            if (typeof chrome.action?.onClicked?.dispatch === 'function') chrome.action.onClicked.dispatch(tab);
                            if (typeof chrome.browserAction?.onClicked?.dispatch === 'function') chrome.browserAction.onClicked.dispatch(tab);
                        }
                    } catch (_) {}
                `).catch(() => {});
            }
        } catch (_) {}

        // Broadcast onClicked to Service Worker / Background host & popups
        try {
            const { getIpcBridge } = require('./compat/IpcBridge');
            const bridge = getIpcBridge();
            bridge.broadcastEvent(cleanId, 'chrome.action.onClicked', [tabObj]);
        } catch (_) {}

        // Read extension files from disk and inject content scripts directly into active tab if defined
        if (ext.path && fs.existsSync(ext.path)) {
            const manifestPath = path.join(ext.path, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

                    // Inject content scripts if defined
                    if (Array.isArray(manifest.content_scripts)) {
                        for (const cs of manifest.content_scripts) {
                            if (Array.isArray(cs.css)) {
                                for (const cssFile of cs.css) {
                                    const fullCss = path.join(ext.path, cssFile);
                                    if (fs.existsSync(fullCss)) {
                                        try {
                                            await activeTab.webContents.insertCSS(fs.readFileSync(fullCss, 'utf-8'));
                                        } catch (_) {}
                                    }
                                }
                            }
                            if (Array.isArray(cs.js)) {
                                for (const jsFile of cs.js) {
                                    const fullJs = path.join(ext.path, jsFile);
                                    if (fs.existsSync(fullJs)) {
                                        try {
                                            await activeTab.webContents.executeJavaScript(fs.readFileSync(fullJs, 'utf-8'));
                                        } catch (_) {}
                                    }
                                }
                            }
                        }
                    }

                    // Legacy fallback for specific extensions that need direct DOM injection (e.g., MeasureIt)
                    const bgFile = manifest.background?.service_worker || (Array.isArray(manifest.background?.scripts) && manifest.background.scripts[0]);
                    if (bgFile) {
                        const fullBg = path.join(ext.path, bgFile);
                        if (fs.existsSync(fullBg)) {
                            const bgContent = fs.readFileSync(fullBg, 'utf-8');
                            if (bgContent.includes('drawMeasurIt')) {
                                const injection = `
                                    (() => {
                                        try {
                                            // Toggle off if already active
                                            if (document.getElementById('tslOverlay')) {
                                                document.getElementById('tslOverlay').remove();
                                                return;
                                            }

                                            var letsGo;

                                            const defaultChoices = {
                                                background: '#000000',
                                                popup: '#ffff00',
                                                popupOpacity: '0.3',
                                                backgroundOpacity: '0.4'
                                            };

                                            const createStorageArea = () => ({
                                                get: (keys, cb) => {
                                                    const data = { choices: defaultChoices };
                                                    if (typeof cb === 'function') {
                                                        try { cb(data); } catch (_) {}
                                                    }
                                                    return Promise.resolve(data);
                                                },
                                                set: (items, cb) => {
                                                    if (typeof cb === 'function') {
                                                        try { cb(); } catch (_) {}
                                                    }
                                                    return Promise.resolve();
                                                }
                                            });

                                            const messageListeners = [];
                                            const mockRuntime = {
                                                id: ${JSON.stringify(cleanId)},
                                                getURL: (p) => 'chrome-extension://${cleanId}/' + (p ? String(p).replace(/^\\//, '') : ''),
                                                onMessage: {
                                                    addListener: (fn) => { if (typeof fn === 'function') messageListeners.push(fn); },
                                                    removeListener: (fn) => {
                                                        const idx = messageListeners.indexOf(fn);
                                                        if (idx !== -1) messageListeners.splice(idx, 1);
                                                    }
                                                },
                                                sendMessage: (msg, cb) => {
                                                    messageListeners.forEach(fn => {
                                                        try { fn(msg, { id: ${JSON.stringify(cleanId)} }, () => {}); } catch (_) {}
                                                    });
                                                    if (typeof cb === 'function') cb();
                                                    return Promise.resolve();
                                                },
                                                lastError: null
                                            };

                                            const mockTabs = {
                                                query: (_q, cb) => {
                                                    const tabs = [{ id: 1, active: true, currentWindow: true, url: window.location.href, title: document.title, width: window.innerWidth, height: window.innerHeight }];
                                                    if (typeof cb === 'function') cb(tabs);
                                                    return Promise.resolve(tabs);
                                                },
                                                sendMessage: (tabId, msg, cb) => {
                                                    messageListeners.forEach(fn => {
                                                        try { fn(msg, { id: ${JSON.stringify(cleanId)}, tab: { id: tabId } }, () => {}); } catch (_) {}
                                                    });
                                                    if (typeof cb === 'function') cb();
                                                    return Promise.resolve();
                                                }
                                            };

                                            const mockScripting = {
                                                executeScript: ({ func, args, target, files } = {}, cb) => {
                                                    let result = undefined;
                                                    try {
                                                        if (typeof func === 'function') {
                                                            result = func(...(args || []));
                                                        }
                                                    } catch (e) {
                                                        console.error('[InviSurf] executeScript function error:', e);
                                                    }
                                                    if (typeof cb === 'function') {
                                                        try { cb([{ result }]); } catch (_) {}
                                                    }
                                                    return Promise.resolve([{ result }]);
                                                },
                                                insertCSS: () => Promise.resolve(),
                                                removeCSS: () => Promise.resolve()
                                            };

                                            let actionListener = null;
                                            const mockAction = {
                                                onClicked: {
                                                    addListener: (cb) => {
                                                        actionListener = cb;
                                                        if (typeof cb === 'function') {
                                                            setTimeout(() => {
                                                                try {
                                                                    cb({
                                                                        id: 1,
                                                                        active: true,
                                                                        currentWindow: true,
                                                                        url: window.location.href,
                                                                        title: document.title,
                                                                        width: window.innerWidth,
                                                                        height: window.innerHeight
                                                                    });
                                                                } catch (e) {
                                                                    console.error('[InviSurf] onClicked callback error:', e);
                                                                }
                                                            }, 0);
                                                        }
                                                    }
                                                },
                                                setTitle: () => {},
                                                setIcon: () => {},
                                                setBadgeText: () => {},
                                                setBadgeBackgroundColor: () => {}
                                            };

                                            const chrome = window.chrome || {};
                                            chrome.storage = { local: createStorageArea(), sync: createStorageArea() };
                                            chrome.scripting = mockScripting;
                                            chrome.action = mockAction;
                                            chrome.browserAction = mockAction;
                                            chrome.runtime = { ...(chrome.runtime || {}), ...mockRuntime };
                                            chrome.tabs = mockTabs;

                                            ${bgContent}

                                            // Fallback if drawMeasurIt exists and hasn't been invoked
                                            if (typeof drawMeasurIt === 'function' && !document.getElementById('tslOverlay')) {
                                                try {
                                                    drawMeasurIt(defaultChoices);
                                                } catch (e) {
                                                    console.error('[InviSurf] drawMeasurIt direct call error:', e);
                                                }
                                            }
                                        } catch (e) {
                                            console.error('[InviSurf] Error executing action script:', e);
                                        }
                                    })();
                                `;
                                await activeTab.webContents.executeJavaScript(injection);
                                console.log(`[ExtensionController] Injected and executed action script for "${ext.name}" on tab ${activeTabId}`);
                            }
                        }
                    }
                } catch (manifestErr) {
                    console.error('[ExtensionController] Action script execution failed:', manifestErr);
                }
            }
        }

        return { ok: true, activated: true };
    }

    /**
     * Checks if a Chrome extension match pattern matches a URL.
     */
    matchesPattern(pattern, rawUrl) {
        if (!pattern || !rawUrl) return false;
        if (pattern === '<all_urls>') {
            return rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
        }
        try {
            const regexStr = '^' + pattern
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*') + '$';
            return new RegExp(regexStr).test(rawUrl);
        } catch {
            return false;
        }
    }

    /**
     * Injects matching content scripts for all enabled extensions into a tab WebContents.
     * Mimics Chrome's automatic Content Script injection engine on page load.
     * Supports runAtFilter ('document_start', 'document_end', 'document_idle').
     */
    async injectContentScriptsForTab(context, tabId, url, runAtFilter = null) {
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
        const tab = context?.tabs?.[tabId];
        if (!tab || !tab.webContents || tab.webContents.isDestroyed()) return;

        if (tab._lastInjectedUrl !== url) {
            tab._lastInjectedUrl = url;
            tab._injectedScriptKeys = new Set();
        }
        if (!tab._injectedScriptKeys) {
            tab._injectedScriptKeys = new Set();
        }

        const pId = ExtensionStorage.safeProfileId(context.profileId);
        const state = ExtensionStorage.readState(pId);
        const profileLoadedMap = this.loadedExtensions.get(pId) || new Map();

        for (const [extId, ext] of Object.entries(state)) {
            if (!ext.enabled || !ext.path || !fs.existsSync(ext.path)) continue;

            // Check site access permissions:
            // 1. 'onClick': only runs when user explicitly clicks the action button
            if (ext.siteAccess === 'onClick') {
                continue;
            }
            // 2. 'onHost': only runs on specifically permitted hosts
            if (ext.siteAccess === 'onHost') {
                let tabHost = '';
                try {
                    tabHost = new URL(url).host;
                } catch (_) {}
                const hostAllowed = (Array.isArray(ext.allowedHosts) && ext.allowedHosts.includes(tabHost)) ||
                                    (Array.isArray(ext.allowedOrigins) && ext.allowedOrigins.some(o => o.includes(tabHost)));
                if (!hostAllowed) {
                    continue;
                }
            }

            const manifestPath = path.join(ext.path, 'manifest.json');
            if (!fs.existsSync(manifestPath)) continue;

            let manifest;
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            } catch (_) {
                continue;
            }

            if (!Array.isArray(manifest.content_scripts)) continue;

            const runtimeId = ext.runtimeId || profileLoadedMap.get(extId)?.id || extId;
            const numericTabId = tab.webContents?.id || tabId;

            for (const cs of manifest.content_scripts) {
                const matches = Array.isArray(cs.matches) && cs.matches.some(p => this.matchesPattern(p, url));
                if (!matches) continue;

                const scriptRunAt = cs.run_at || 'document_idle';
                if (runAtFilter === 'document_start' && scriptRunAt !== 'document_start') continue;
                if (runAtFilter === 'document_idle' && scriptRunAt === 'document_start') continue;

                // Inject CSS
                if (Array.isArray(cs.css)) {
                    for (const cssFile of cs.css) {
                        const cssKey = `css:${extId}:${cssFile}`;
                        if (tab._injectedScriptKeys.has(cssKey)) continue;
                        const fullCss = path.join(ext.path, cssFile);
                        if (fs.existsSync(fullCss)) {
                            try {
                                await tab.webContents.insertCSS(fs.readFileSync(fullCss, 'utf-8'));
                                tab._injectedScriptKeys.add(cssKey);
                            } catch (_) {}
                        }
                    }
                }

                // Inject JS
                if (Array.isArray(cs.js)) {
                    for (const jsFile of cs.js) {
                        const jsKey = `js:${extId}:${jsFile}`;
                        if (tab._injectedScriptKeys.has(jsKey)) continue;
                        const fullJs = path.join(ext.path, jsFile);
                        if (fs.existsSync(fullJs)) {
                            try {
                                const jsContent = fs.readFileSync(fullJs, 'utf-8');
                                const safeJsKey = String(jsFile || '').replace(/[^a-zA-Z0-9_]/g, '_');
                                const contentScriptWrapper = `
                                    (() => {
                                        try {
                                            const EXT_ID = ${JSON.stringify(runtimeId)};
                                            const PROF_ID = ${JSON.stringify(pId)};
                                            const TAB_ID = ${JSON.stringify(numericTabId)};
                                            const guardKey = '__invisurf_injected_' + EXT_ID.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + ${JSON.stringify(safeJsKey)};
                                            if (window[guardKey]) return;
                                            window[guardKey] = true;

                                            if (!window.chrome) window.chrome = {};

                                            function _callExt(method, args = {}) {
                                                return fetch('invisurf-ext://api/call', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ method, args, extensionId: EXT_ID, profileId: PROF_ID, tabId: TAB_ID })
                                                }).then(r => r.json()).then(d => {
                                                    if (d && d.ok) return d.result;
                                                    throw new Error(d ? d.error : 'Unknown error');
                                                });
                                            }

                                            if (!window.chrome.runtime) window.chrome.runtime = {};
                                            window.chrome.runtime.id = EXT_ID;
                                            window.chrome.runtime.getURL = (p) => 'chrome-extension://' + EXT_ID + '/' + (p ? String(p).replace(/^\\//, '') : '');
                                            window.chrome.runtime.sendMessage = (extIdOrMsg, msgOrOpts, optsOrCallback, maybeCb) => {
                                                let targetId = EXT_ID;
                                                let message = extIdOrMsg;
                                                let cb = null;
                                                if (typeof extIdOrMsg === 'string' && msgOrOpts !== undefined) {
                                                    targetId = extIdOrMsg;
                                                    message = msgOrOpts;
                                                    if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                                                    else if (typeof maybeCb === 'function') cb = maybeCb;
                                                } else {
                                                    if (typeof msgOrOpts === 'function') cb = msgOrOpts;
                                                    else if (typeof optsOrCallback === 'function') cb = optsOrCallback;
                                                }
                                                const p = _callExt('runtime.sendMessage', { targetExtId: targetId, message, tabId: TAB_ID });
                                                if (typeof cb === 'function') {
                                                    p.then(res => { try { cb(res); } catch (_) {} }).catch(() => { try { cb(undefined); } catch (_) {} });
                                                }
                                                return p;
                                            };
                                            if (!window.chrome.runtime.onMessage) {
                                                const _listeners = [];
                                                window.chrome.runtime.onMessage = {
                                                    addListener: (fn) => { if (typeof fn === 'function' && !_listeners.includes(fn)) _listeners.push(fn); },
                                                    removeListener: (fn) => { const idx = _listeners.indexOf(fn); if (idx !== -1) _listeners.splice(idx, 1); },
                                                    hasListener: (fn) => _listeners.includes(fn),
                                                    _listeners,
                                                };

                                                window.addEventListener('message', (ev) => {
                                                    if (ev.source === window && ev.data && ev.data.source === 'invisurf-ext-event') {
                                                        const payload = ev.data.payload;
                                                        if (payload && payload.eventName === 'chrome.runtime.onMessage') {
                                                            const args = payload.args || [];
                                                            const callbackId = payload.callbackId || null;
                                                            let responded = false;
                                                            let asyncWait = false;
                                                            const sendResponse = (response) => {
                                                                if (responded) return;
                                                                responded = true;
                                                                if (callbackId) {
                                                                    window.postMessage({
                                                                        source: 'invisurf-ext-response',
                                                                        callbackId,
                                                                        response
                                                                    }, '*');
                                                                }
                                                            };
                                                            for (const fn of _listeners.slice()) {
                                                                try {
                                                                    const r = fn(args[0], args[1], sendResponse);
                                                                    if (r === true) {
                                                                        asyncWait = true;
                                                                    } else if (r && typeof r.then === 'function') {
                                                                        asyncWait = true;
                                                                        r.then(sendResponse).catch(() => sendResponse(undefined));
                                                                    }
                                                                } catch (e) {
                                                                    console.error(e);
                                                                }
                                                            }
                                                            if (!asyncWait && !responded && callbackId) {
                                                                setTimeout(() => {
                                                                    if (!responded) sendResponse(undefined);
                                                                }, 20);
                                                            }
                                                        }
                                                    }
                                                });
                                            }

                                            if (!window.chrome.runtime.connect) {
                                                window.chrome.runtime.connect = (connectOpts = {}) => {
                                                    const portName = typeof connectOpts === 'string' ? connectOpts : (connectOpts?.name || '');
                                                    const portId = 'port_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                                                    const _msgListeners = [];
                                                    const _discListeners = [];
                                                    let _disconnected = false;

                                                    _callExt('runtime.connect', { portId, name: portName, targetExtId: EXT_ID, tabId: TAB_ID }).catch(() => {});

                                                    const _handlePortEvent = (ev) => {
                                                        if (ev.source === window && ev.data && ev.data.source === 'invisurf-ext-event') {
                                                            const payload = ev.data.payload;
                                                            if (!payload) return;
                                                            if (payload.eventName === ('chrome.runtime.portOnMessage_' + portId)) {
                                                                const msgArg = payload.args && payload.args.length > 0 ? payload.args[0] : undefined;
                                                                for (const fn of _msgListeners.slice()) {
                                                                    try { fn(msgArg); } catch (e) { console.error(e); }
                                                                }
                                                            } else if (payload.eventName === ('chrome.runtime.portOnDisconnect_' + portId)) {
                                                                _disconnected = true;
                                                                window.removeEventListener('message', _handlePortEvent);
                                                                for (const fn of _discListeners.slice()) {
                                                                    try { fn(); } catch (e) { console.error(e); }
                                                                }
                                                            }
                                                        }
                                                    };
                                                    window.addEventListener('message', _handlePortEvent);

                                                    return {
                                                        name: portName,
                                                        postMessage: (message) => {
                                                            if (_disconnected) return;
                                                            _callExt('runtime.portPostMessage', { portId, message, targetExtId: EXT_ID, tabId: TAB_ID }).catch(() => {});
                                                        },
                                                        disconnect: () => {
                                                            if (_disconnected) return;
                                                            _disconnected = true;
                                                            window.removeEventListener('message', _handlePortEvent);
                                                            _callExt('runtime.portDisconnect', { portId, targetExtId: EXT_ID, tabId: TAB_ID }).catch(() => {});
                                                            for (const fn of _discListeners.slice()) {
                                                                try { fn(); } catch (_) {}
                                                            }
                                                        },
                                                        onMessage: {
                                                            addListener: (fn) => { if (typeof fn === 'function' && !_msgListeners.includes(fn)) _msgListeners.push(fn); },
                                                            removeListener: (fn) => { const i = _msgListeners.indexOf(fn); if (i !== -1) _msgListeners.splice(i, 1); },
                                                            hasListener: (fn) => _msgListeners.includes(fn),
                                                        },
                                                        onDisconnect: {
                                                            addListener: (fn) => { if (typeof fn === 'function' && !_discListeners.includes(fn)) _discListeners.push(fn); },
                                                            removeListener: (fn) => { const i = _discListeners.indexOf(fn); if (i !== -1) _discListeners.splice(i, 1); },
                                                            hasListener: (fn) => _discListeners.includes(fn),
                                                        },
                                                    };
                                                };
                                            }

                                            if (!window.chrome.storage) {
                                                const _createArea = (area) => ({
                                                    get: (keys, cb) => {
                                                        const p = _callExt('storage.get', { area, keys });
                                                        if (typeof cb === 'function') p.then(cb).catch(() => cb({}));
                                                        return p;
                                                    },
                                                    set: (items, cb) => {
                                                        const p = _callExt('storage.set', { area, items });
                                                        if (typeof cb === 'function') p.then(cb).catch(() => cb());
                                                        return p;
                                                    },
                                                    remove: (keys, cb) => {
                                                        const p = _callExt('storage.remove', { area, keys });
                                                        if (typeof cb === 'function') p.then(cb).catch(() => cb());
                                                        return p;
                                                    },
                                                    clear: (cb) => {
                                                        const p = _callExt('storage.clear', { area });
                                                        if (typeof cb === 'function') p.then(cb).catch(() => cb());
                                                        return p;
                                                    },
                                                });
                                                window.chrome.storage = {
                                                    local: _createArea('local'),
                                                    sync: _createArea('sync'),
                                                    session: _createArea('session'),
                                                    onChanged: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
                                                };
                                            }

                                            ${jsContent}
                                        } catch (err) {
                                            console.warn('[InviSurf ContentScript Error]:', err);
                                        }
                                    })();
                                `;
                                await tab.webContents.executeJavaScript(contentScriptWrapper);
                                tab._injectedScriptKeys.add(jsKey);
                            } catch (_) {}
                        }
                    }
                }
            }
        }
    }

    _loadStaticRulesets(extensionId, extensionPath) {
        if (!extensionPath || !fs.existsSync(extensionPath)) return;
        try {
            const manifestPath = path.join(extensionPath, 'manifest.json');
            if (!fs.existsSync(manifestPath)) return;
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const ruleResources = manifest?.declarative_net_request?.rule_resources;
            if (Array.isArray(ruleResources) && ruleResources.length > 0) {
                const { getDeclarativeNetRequestManager } = require('./compat/DeclarativeNetRequestManager');
                getDeclarativeNetRequestManager().loadStaticRulesets(extensionId, extensionPath, ruleResources);
            }

            // Register omnibox keyword if defined in manifest
            if (manifest?.omnibox && typeof manifest.omnibox.keyword === 'string') {
                const { getOmniboxManager } = require('./compat/OmniboxManager');
                let iconDataUrl = null;
                const iconRelative = manifest.icons?.['32'] || manifest.icons?.['48'] || manifest.icons?.['128'] || null;
                if (iconRelative) {
                    const fullIconPath = path.join(extensionPath, iconRelative);
                    if (fs.existsSync(fullIconPath)) {
                        try {
                            const ext = path.extname(fullIconPath).toLowerCase().replace('.', '') || 'png';
                            const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
                            iconDataUrl = `data:${mime};base64,${fs.readFileSync(fullIconPath).toString('base64')}`;
                        } catch (_) {}
                    }
                }
                getOmniboxManager().registerKeyword(extensionId, manifest.omnibox.keyword, manifest.name, iconDataUrl);
                console.log(`[ExtensionController] Registered omnibox keyword "${manifest.omnibox.keyword}" for ${extensionId}`);
            }
        } catch (err) {
            console.warn(`[ExtensionController] Failed to load static rulesets / omnibox for ${extensionId}:`, err?.message || err);
        }
    }

    _unloadExtensionCompat(extensionId) {
        try {
            const cleanId = sanitizeExtensionId(extensionId);
            for (const [key, view] of this.backgroundHosts.entries()) {
                if (key.endsWith(`:${cleanId}`) || key.includes(cleanId)) {
                    try {
                        if (!view.webContents.isDestroyed()) {
                            view.webContents.destroy();
                        }
                    } catch (_) {}
                    this.backgroundHosts.delete(key);
                }
            }
        } catch (_) {}
        try {
            const { getDeclarativeNetRequestManager } = require('./compat/DeclarativeNetRequestManager');
            getDeclarativeNetRequestManager().unloadStaticRulesets(extensionId);
        } catch (_) {}
        try {
            const { getContextMenuManager } = require('./compat/ContextMenuManager');
            getContextMenuManager().removeAll(extensionId);
        } catch (_) {}
        try {
            const { getAlarmManager } = require('./compat/AlarmManager');
            getAlarmManager().clearAll(extensionId);
        } catch (_) {}
        try {
            const { getOmniboxManager } = require('./compat/OmniboxManager');
            getOmniboxManager().unregisterKeyword(extensionId);
        } catch (_) {}
        try {
            const { getIpcBridge } = require('./compat/IpcBridge');
            getIpcBridge().unloadExtension(extensionId);
        } catch (_) {}
    }
}

// Singleton instance
let instance = null;
function getExtensionController() {
    if (!instance) {
        instance = new ExtensionController();
    }
    return instance;
}

module.exports = {
    ExtensionController,
    getExtensionController,
};
