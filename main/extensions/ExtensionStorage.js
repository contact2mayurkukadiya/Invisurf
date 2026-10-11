const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Returns safe profile ID string for filesystem paths.
 */
function safeProfileId(profileId) {
    return String(profileId || 'default').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
}

/**
 * Returns safe extension ID string (32 lowercase alphanumeric letters).
 */
function sanitizeExtensionId(extensionId) {
    const raw = String(extensionId || '').trim().toLowerCase();
    if (/^[a-p0-9]{32}$/.test(raw)) {
        return raw;
    }
    return raw.replace(/[^a-z0-9_-]/g, '');
}

function getUserDataPath() {
    if (process.env.INVISURF_USER_DATA) {
        return process.env.INVISURF_USER_DATA;
    }
    try {
        if (app && typeof app.getPath === 'function') {
            return app.getPath('userData');
        }
    } catch (_) {}
    return path.join(__dirname, '..', '..', '.test_userdata');
}

/**
 * Root directory for a profile's extensions.
 */
function getProfileExtensionsDir(profileId) {
    const pId = safeProfileId(profileId);
    const dir = path.join(getUserDataPath(), 'profiles', pId, 'Extensions');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Staging directory for temporary downloads and extractions.
 */
function getStagingDir(profileId) {
    const dir = path.join(getProfileExtensionsDir(profileId), 'staging');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * State file path for tracking installed extensions and their preferences.
 */
function getStateFilePath(profileId) {
    return path.join(getProfileExtensionsDir(profileId), 'state.json');
}

const memoryStateCache = new Map();

/**
 * Reads the persistent state for a profile.
 * Returns an object keyed by extensionId.
 */
function readState(profileId, forceReload = false) {
    const cleanProfileId = safeProfileId(profileId);
    if (!forceReload && memoryStateCache.has(cleanProfileId)) {
        return memoryStateCache.get(cleanProfileId);
    }
    try {
        const filePath = getStateFilePath(cleanProfileId);
        let state = {};
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            state = typeof parsed === 'object' && parsed !== null ? parsed : {};
        }
        const finalState = recoverAndMigrateExtensions(cleanProfileId, state);
        memoryStateCache.set(cleanProfileId, finalState);
        return finalState;
    } catch (err) {
        console.warn(`[ExtensionStorage] Failed to read state for profile ${profileId}:`, err?.message || err);
        return {};
    }
}

/**
 * Recovers unpromoted staging extensions and migrates legacy extensions.json entries.
 */
function recoverAndMigrateExtensions(profileId, state) {
    let dirty = false;
    const cleanProfileId = safeProfileId(profileId);

    // 1. Recover un-promoted extensions in staging/
    try {
        const stagingDir = path.join(getProfileExtensionsDir(cleanProfileId), 'staging');
        if (fs.existsSync(stagingDir)) {
            const ExtensionInstaller = require('./ExtensionInstaller');
            for (const folder of fs.readdirSync(stagingDir)) {
                const subPath = path.join(stagingDir, folder);
                const manifestPath = path.join(subPath, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    try {
                        const inspection = ExtensionInstaller.inspectExtractedExtension(subPath);
                        const parts = folder.split('_');
                        const extId = sanitizeExtensionId(parts[0]);
                        const timestamp = parseInt(parts[1], 10);
                        // Do not touch active installation staging directories (less than 10 minutes old)
                        if (Number.isFinite(timestamp) && (Date.now() - timestamp) < 10 * 60 * 1000) {
                            continue;
                        }
                        if (extId && !state[extId]) {
                            console.log(`[ExtensionStorage] Recovering unpromoted staging extension: ${inspection.name} (${extId})`);
                            const finalPath = promoteStaging(cleanProfileId, extId, inspection.version, subPath);

                            let iconDataUrl = null;
                            if (inspection.iconRelativePath) {
                                const iconFullPath = path.join(finalPath, inspection.iconRelativePath);
                                if (fs.existsSync(iconFullPath)) {
                                    try {
                                        const iconExt = path.extname(iconFullPath).toLowerCase().replace('.', '') || 'png';
                                        const mime = iconExt === 'svg' ? 'image/svg+xml' : `image/${iconExt}`;
                                        const iconBase64 = fs.readFileSync(iconFullPath).toString('base64');
                                        iconDataUrl = `data:${mime};base64,${iconBase64}`;
                                    } catch (_) {}
                                }
                            }

                            state[extId] = {
                                id: extId,
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
                                urlPatterns: inspection.urlPatterns || [],
                                hasAllUrls: inspection.hasAllUrls !== undefined ? inspection.hasAllUrls : true,
                                isPageAction: !!inspection.isPageAction,
                                allowedOrigins: [],
                            };
                            dirty = true;
                        }
                    } catch (e) {
                        console.warn(`[ExtensionStorage] Failed to recover staging extension ${folder}:`, e);
                    }
                }
            }
        }
    } catch (_) {}

    // 2. Check legacy extensions.json in User Data (migrate once then clean up to prevent reviving uninstalled extensions)
    try {
        const legacyPath = path.join(getUserDataPath(), 'extensions.json');
        if (fs.existsSync(legacyPath)) {
            const legacyRaw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
            const legacyExts = legacyRaw?.extensions || legacyRaw;
            if (typeof legacyExts === 'object' && legacyExts !== null) {
                for (const [id, ext] of Object.entries(legacyExts)) {
                    const extId = sanitizeExtensionId(id);
                    if (extId && !state[extId] && ext.dirPath && fs.existsSync(ext.dirPath)) {
                        console.log(`[ExtensionStorage] Migrating legacy extension: ${ext.name || extId}`);
                        state[extId] = {
                            id: extId,
                            runtimeId: ext.runtimeId || null,
                            name: ext.name || extId,
                            version: ext.version || '1.0.0',
                            description: ext.description || '',
                            enabled: ext.enabled !== false,
                            pinned: ext.pinned !== false,
                            pinnedAt: ext.installDate || Date.now(),
                            path: ext.dirPath,
                            iconRelativePath: ext.manifest?.icons?.['128'] || ext.manifest?.icons?.['48'] || null,
                            iconDataUrl: null,
                            hasPopup: !!(ext.action?.defaultPopup || ext.manifest?.action?.default_popup),
                            popupFile: ext.action?.defaultPopup || ext.manifest?.action?.default_popup || null,
                            installedAt: ext.installDate || Date.now(),
                            permissions: {
                                permissions: ext.manifest?.permissions || [],
                                hostPermissions: ext.manifest?.host_permissions || [],
                                warnings: [],
                            },
                            allowedOrigins: [],
                        };
                        dirty = true;
                    }
                }
            }
            try { fs.unlinkSync(legacyPath); } catch (_) {}
        }
    } catch (_) {}

    // 3. Ensure all extensions have service worker polyfills applied
    try {
        const ExtensionInstaller = require('./ExtensionInstaller');
        for (const ext of Object.values(state)) {
            if (ext.path && fs.existsSync(ext.path)) {
                ExtensionInstaller.ensureExtensionPolyfills(ext.path, ext.id);
            }
        }
    } catch (_) {}

    if (dirty) {
        writeState(cleanProfileId, state);
    }
    return state;
}

/**
 * Writes persistent state atomically for a profile.
 */
function writeState(profileId, state) {
    const cleanProfileId = safeProfileId(profileId);
    memoryStateCache.set(cleanProfileId, state);
    try {
        const filePath = getStateFilePath(cleanProfileId);
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tempPath, filePath);
    } catch (err) {
        console.error(`[ExtensionStorage] Failed to write state for profile ${profileId}:`, err?.message || err);
    }
}

/**
 * Prepares a clean staging directory for an extension.
 */
function prepareStagingDir(profileId, extensionId) {
    const cleanId = sanitizeExtensionId(extensionId);
    const stagingBase = getStagingDir(profileId);
    const target = path.join(stagingBase, `${cleanId}_${Date.now()}`);
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
    fs.mkdirSync(target, { recursive: true });
    return target;
}

/**
 * Target directory for an installed extension version.
 */
function getExtensionVersionDir(profileId, extensionId, version) {
    const cleanId = sanitizeExtensionId(extensionId);
    const safeVersion = String(version || '1.0.0').replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(getProfileExtensionsDir(profileId), cleanId, safeVersion);
}

/**
 * Atomically promotes an extracted staging directory to the final version directory.
 */
function promoteStaging(profileId, extensionId, version, stagingDir) {
    const targetDir = getExtensionVersionDir(profileId, extensionId, version);
    const parentDir = path.dirname(targetDir);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    if (!fs.existsSync(stagingDir)) {
        if (fs.existsSync(targetDir)) {
            return targetDir;
        }
        throw new Error(`Staging directory does not exist: ${stagingDir}`);
    }

    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    fs.renameSync(stagingDir, targetDir);
    return targetDir;
}

/**
 * Completely removes an extension's files from disk.
 */
function deleteExtensionFiles(profileId, extensionId) {
    const cleanId = sanitizeExtensionId(extensionId);
    const extDir = path.join(getProfileExtensionsDir(profileId), cleanId);
    if (fs.existsSync(extDir)) {
        try { fs.rmSync(extDir, { recursive: true, force: true }); } catch (_) {}
    }
    try {
        const legacyExtDir = path.join(getUserDataPath(), 'extensions', cleanId);
        if (fs.existsSync(legacyExtDir)) {
            fs.rmSync(legacyExtDir, { recursive: true, force: true });
        }
        const legacyPath = path.join(getUserDataPath(), 'extensions.json');
        if (fs.existsSync(legacyPath)) {
            const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
            if (raw) {
                let changed = false;
                if (raw.extensions && raw.extensions[cleanId]) {
                    delete raw.extensions[cleanId];
                    changed = true;
                }
                if (raw[cleanId]) {
                    delete raw[cleanId];
                    changed = true;
                }
                if (changed) {
                    fs.writeFileSync(legacyPath, JSON.stringify(raw, null, 2), 'utf-8');
                }
            }
        }
    } catch (_) {}
}

/**
 * Cleans up temporary files in staging.
 */
function cleanStaging(profileId) {
    try {
        const staging = path.join(getProfileExtensionsDir(profileId), 'staging');
        if (fs.existsSync(staging)) {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    } catch (_) { /* ignore */ }
}

/**
 * Lists all known profile directories.
 */
function listProfileIds() {
    try {
        const profilesDir = path.join(getUserDataPath(), 'profiles');
        if (fs.existsSync(profilesDir)) {
            return fs.readdirSync(profilesDir).filter(f => {
                const p = path.join(profilesDir, f);
                try {
                    return fs.statSync(p).isDirectory();
                } catch {
                    return false;
                }
            });
        }
    } catch (_) {}
    return [];
}

/**
 * Derives the canonical Chrome extension ID from a manifest public key.
 */
function deriveExtIdFromKey(pubKeyBase64) {
    if (!pubKeyBase64 || typeof pubKeyBase64 !== 'string') return null;
    try {
        const crypto = require('crypto');
        const der = Buffer.from(pubKeyBase64, 'base64');
        const hash = crypto.createHash('sha256').update(der).digest();
        return hash.subarray(0, 16).toString('hex').split('').map(c => String.fromCharCode(parseInt(c, 16) + 'a'.charCodeAt(0))).join('');
    } catch (_) {
        return null;
    }
}

/**
 * Resolves extension metadata by ID or runtimeId across profiles, session extensions, and testing directories.
 */
function findExtension(extensionId, preferredProfileId = null) {
    if (!extensionId) return null;
    const cleanId = sanitizeExtensionId(extensionId);
    const State = require('../state');

    // 0. Check active Electron session extensions if available
    try {
        const { session } = require('electron');
        const sessionsToCheck = [];
        if (session?.defaultSession) sessionsToCheck.push(session.defaultSession);
        for (const ctx of State.windowContextsById.values()) {
            if (ctx.partition) {
                try { sessionsToCheck.push(session.fromPartition(ctx.partition)); } catch (_) {}
            }
        }
        for (const s of sessionsToCheck) {
            if (s?.extensions) {
                const loaded = s.extensions.getAllExtensions().find(e =>
                    e.id === cleanId ||
                    e.id === extensionId ||
                    (e.name && sanitizeExtensionId(e.name) === cleanId)
                );
                if (loaded && loaded.path && fs.existsSync(loaded.path)) {
                    const manifestFile = path.join(loaded.path, 'manifest.json');
                    let manifest = {};
                    if (fs.existsSync(manifestFile)) {
                        try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')); } catch (_) {}
                    }
                    return {
                        id: loaded.id,
                        runtimeId: loaded.id,
                        name: loaded.name || manifest.name || cleanId,
                        version: loaded.version || manifest.version || '1.0',
                        path: loaded.path,
                        manifest,
                        hasPopup: !!(manifest.action?.default_popup || manifest.browser_action?.default_popup),
                        popupFile: manifest.action?.default_popup || manifest.browser_action?.default_popup || 'popup.html',
                    };
                }
            }
        }
    } catch (_) {}

    // Helper to match state entries
    const matchState = (state) => {
        if (!state || typeof state !== 'object') return null;
        if (state[cleanId]) return state[cleanId];
        for (const e of Object.values(state)) {
            if (!e) continue;
            if (e.id === cleanId || e.runtimeId === cleanId) return e;
            if (e.manifest?.key && deriveExtIdFromKey(e.manifest.key) === cleanId) return e;
        }
        return null;
    };

    // 1. Check preferred profile if provided
    if (preferredProfileId) {
        const match = matchState(readState(preferredProfileId));
        if (match) return match;
    }

    // 2. Check default profile
    if (State.defaultProfileId) {
        const match = matchState(readState(State.defaultProfileId));
        if (match) return match;
    }

    // 3. Search all profiles in User Data
    const allProfileIds = listProfileIds();
    for (const pId of allProfileIds) {
        const match = matchState(readState(pId));
        if (match) return match;
    }

    // 4. Fallback search in Testing-Extensions directory
    try {
        const testingExtDir = path.join(__dirname, '..', '..', 'Testing-Extensions');
        if (fs.existsSync(testingExtDir)) {
            for (const folder of fs.readdirSync(testingExtDir)) {
                const fullDir = path.join(testingExtDir, folder);
                const manifestFile = path.join(fullDir, 'manifest.json');
                if (fs.existsSync(manifestFile)) {
                    let manifest = {};
                    try {
                        manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
                    } catch (_) {
                        continue;
                    }
                    const folderClean = sanitizeExtensionId(folder);
                    const derivedKeyId = manifest.key ? deriveExtIdFromKey(manifest.key) : null;
                    const isMatch = folderClean === cleanId ||
                        folder.toLowerCase() === String(extensionId).toLowerCase() ||
                        (derivedKeyId && derivedKeyId === cleanId);

                    if (isMatch) {
                        const finalId = derivedKeyId || cleanId;
                        return {
                            id: finalId,
                            runtimeId: finalId,
                            name: manifest.name || folder,
                            version: manifest.version || '1.0',
                            path: fullDir,
                            manifest,
                            hasPopup: !!(manifest.action?.default_popup || manifest.browser_action?.default_popup),
                            popupFile: manifest.action?.default_popup || manifest.browser_action?.default_popup || 'popup.html',
                        };
                    }
                }
            }
        }
    } catch (_) {}

    return null;
}

module.exports = {
    safeProfileId,
    sanitizeExtensionId,
    deriveExtIdFromKey,
    getProfileExtensionsDir,
    getStagingDir,
    getStateFilePath,
    readState,
    writeState,
    prepareStagingDir,
    getExtensionVersionDir,
    promoteStaging,
    deleteExtensionFiles,
    cleanStaging,
    listProfileIds,
    findExtension,
};
