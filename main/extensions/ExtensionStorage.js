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
    return String(extensionId || '').trim().toLowerCase().replace(/[^a-p0-9]/g, '');
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

/**
 * Reads the persistent state for a profile.
 * Returns an object keyed by extensionId.
 */
function readState(profileId) {
    try {
        const filePath = getStateFilePath(profileId);
        let state = {};
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            state = typeof parsed === 'object' && parsed !== null ? parsed : {};
        }
        return recoverAndMigrateExtensions(profileId, state);
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
                                installedAt: Date.now(),
                                permissions: inspection.permissionsAudit,
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
    try {
        const filePath = getStateFilePath(profileId);
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

module.exports = {
    safeProfileId,
    sanitizeExtensionId,
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
};
