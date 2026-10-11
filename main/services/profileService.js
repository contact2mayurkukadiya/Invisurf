
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const encryption = require('../../encryption');
const State = require('../state');
const { MAX_PROFILE_AVATAR_BYTES, PRESET_AVATAR_PNG_DIR } = require('../constants/defaults');

let profilesPath;
function getProfilesPath() {
    if (!profilesPath) {
        profilesPath = path.join(app.getPath('userData'), 'profiles.json');
    }
    return profilesPath;
}

function getProfileAvatarsDir() {
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function discoverDiskProfiles() {
    const discovered = new Set();
    try {
        const userData = app.getPath('userData');

        // 1. Check directories in userData/profiles
        const profilesDir = path.join(userData, 'profiles');
        if (fs.existsSync(profilesDir)) {
            try {
                for (const item of fs.readdirSync(profilesDir)) {
                    if (item.startsWith('profile-')) {
                        discovered.add(item);
                    }
                }
            } catch (_) {}
        }

        // 2. Check history sqlite and bookmarks files in userData
        try {
            for (const item of fs.readdirSync(userData)) {
                const histMatch = item.match(/^history-(profile-[a-zA-Z0-9-_]+)\.sqlite$/);
                if (histMatch) {
                    discovered.add(histMatch[1]);
                }
                const bkMatch = item.match(/^bookmarks-(profile-[a-zA-Z0-9-_]+)\.json$/);
                if (bkMatch) {
                    discovered.add(bkMatch[1]);
                }
            }
        } catch (_) {}

        // 3. Check profile-avatars
        const avatarsDir = path.join(userData, 'profile-avatars');
        if (fs.existsSync(avatarsDir)) {
            try {
                for (const item of fs.readdirSync(avatarsDir)) {
                    const avMatch = item.match(/^(profile-[a-zA-Z0-9-_]+)\.(png|jpe?g|webp|gif)$/i);
                    if (avMatch) {
                        discovered.add(avMatch[1]);
                    }
                }
            } catch (_) {}
        }
    } catch (_) {}

    return Array.from(discovered);
}

function loadProfiles() {
    let profiles = [];
    try {
        const p = getProfilesPath();
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
            const decoded = (parsed && parsed.encrypted !== undefined)
                ? (() => {
                    const dec = encryption.decrypt(parsed);
                    return dec ? JSON.parse(dec) : null;
                })()
                : parsed;
            if (Array.isArray(decoded)) {
                profiles = decoded;
            }
        }
    } catch {
        profiles = [];
    }

    // Disk auto-discovery to prevent profile loss if profiles.json was wiped or transiently empty
    try {
        const knownIds = new Set(profiles.map(p => p.profileId));
        const diskIds = discoverDiskProfiles();
        const avatarsDir = getProfileAvatarsDir();
        const userData = app.getPath('userData');
        let index = profiles.length + 1;

        for (const diskId of diskIds) {
            if (!knownIds.has(diskId)) {
                let hasAvatar = false;
                let avatarExt = null;
                for (const ext of ['png', 'jpeg', 'jpg', 'webp', 'gif']) {
                    if (fs.existsSync(path.join(avatarsDir, `${diskId}.${ext}`))) {
                        hasAvatar = true;
                        avatarExt = ext;
                        break;
                    }
                }
                let birthtime = Date.now();
                const keyFile = path.join(userData, `history-key-${diskId}.json`);
                const histFile = path.join(userData, `history-${diskId}.sqlite`);
                try {
                    if (fs.existsSync(keyFile)) {
                        birthtime = Math.round(fs.statSync(keyFile).birthtimeMs || fs.statSync(keyFile).mtimeMs);
                    } else if (fs.existsSync(histFile)) {
                        birthtime = Math.round(fs.statSync(histFile).birthtimeMs || fs.statSync(histFile).mtimeMs);
                    }
                } catch (_) {}

                profiles.push({
                    profileId: diskId,
                    displayName: `Profile ${index++}`,
                    createdAt: birthtime,
                    updatedAt: Date.now(),
                    hasCustomAvatar: hasAvatar,
                    avatarExt: avatarExt,
                    avatarSource: hasAvatar ? 'upload' : null
                });
            }
        }

        // Keep primary active profile (profile-1da7f370...) first, followed by others sorted chronologically
        profiles.sort((a, b) => {
            if (a.profileId === 'profile-1da7f370-1839-4df6-887d-d4895fa2b1d0') return -1;
            if (b.profileId === 'profile-1da7f370-1839-4df6-887d-d4895fa2b1d0') return 1;
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

        // Ensure display names are clean and distinct
        let num = 1;
        for (const pr of profiles) {
            if (!pr.displayName || /^Profile\s+\d+$/i.test(pr.displayName) || (pr.displayName === 'Default' && pr.profileId !== profiles[0].profileId)) {
                if (pr.profileId === profiles[0].profileId) {
                    pr.displayName = 'Default';
                } else {
                    pr.displayName = `Profile ${++num}`;
                }
            }
        }
    } catch (e) {
        console.error('Error discovering disk profiles:', e);
    }

    return profiles;
}

function saveProfiles() {
    try {
        const data = Array.from(State.profilesById.values());
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getProfilesPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to save profiles:', error);
    }
}

function ensureProfile(profileId, displayName = null) {
    const safeProfileId = String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    if (!safeProfileId) return null;
    if (!State.profilesById.has(safeProfileId)) {
        State.profilesById.set(safeProfileId, {
            profileId: safeProfileId,
            displayName: displayName || `Profile ${State.profilesById.size + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            hasCustomAvatar: false,
            avatarExt: null,
            avatarSource: null,
        });
    }
    if (!State.defaultProfileId) State.defaultProfileId = safeProfileId;
    return State.profilesById.get(safeProfileId);
}

function safeProfileIdForPath(profileId) {
    return String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
}

function avatarFilePath(profileId, ext) {
    return path.join(getProfileAvatarsDir(), `${safeProfileIdForPath(profileId)}.${ext}`);
}

function removeAvatarFilesForProfile(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (name === `${safeId}.png` || name === `${safeId}.jpeg` || name === `${safeId}.jpg` || name === `${safeId}.webp` || name === `${safeId}.gif`) {
            try {
                fs.unlinkSync(path.join(dir, name));
            } catch (_) {
                /* ignore */
            }
        }
    }
}

/** Shared rules for profile photo uploads (used by validate IPC and save). */
function validateAvatarDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'Invalid image' };
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 12) return { ok: false, error: 'Invalid image' };
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64$/i.test(header)) {
        return {
            ok: false,
            error: 'Unsupported format. Use PNG, JPEG, WebP, or GIF.',
        };
    }
    let buf;
    try {
        buf = Buffer.from(b64, 'base64');
    } catch {
        return { ok: false, error: 'Invalid image data' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    return { ok: true, header, buf };
}

function setProfileAvatarFromDataUrl(profileId, dataUrl) {
    const p = State.profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    const check = validateAvatarDataUrl(dataUrl);
    if (!check.ok) return check;
    const { header, buf } = check;
    let ext = 'png';
    if (/image\/jpe?g/i.test(header)) ext = 'jpeg';
    else if (/image\/webp/i.test(header)) ext = 'webp';
    else if (/image\/gif/i.test(header)) ext = 'gif';
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, ext === 'jpeg' ? 'jpeg' : ext);
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = ext;
    p.avatarSource = 'upload';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

function setProfileAvatarFromPresetPngFile(profileId, fileName) {
    const p = State.profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    if (typeof fileName !== 'string' || !/^\d+\.png$/i.test(fileName)) {
        return { ok: false, error: 'Invalid preset' };
    }
    const safeName = path.basename(fileName);
    const resolvedDir = path.resolve(PRESET_AVATAR_PNG_DIR);
    const srcPath = path.join(resolvedDir, safeName);
    const resolvedSrc = path.resolve(srcPath);
    if (resolvedSrc !== resolvedDir && !resolvedSrc.startsWith(resolvedDir + path.sep)) {
        return { ok: false, error: 'Invalid preset' };
    }
    let buf;
    try {
        buf = fs.readFileSync(resolvedSrc);
    } catch {
        return { ok: false, error: 'Preset file not found' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        return { ok: false, error: 'Invalid image' };
    }
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, 'png');
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = 'png';
    p.avatarSource = 'preset';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

function getProfileAvatarDataUrl(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const p = State.profilesById.get(safeId);
    if (!p || !p.hasCustomAvatar || !p.avatarExt) return null;
    const fp = avatarFilePath(profileId, p.avatarExt);
    if (!fs.existsSync(fp)) return null;
    let buf;
    try {
        buf = fs.readFileSync(fp);
    } catch {
        return null;
    }
    const mime = p.avatarExt === 'jpeg' ? 'image/jpeg' : `image/${p.avatarExt}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
}

async function deleteProfileDataFromDisk(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    if (!safeId) return;

    // 1. Close history DB connection if open
    try {
        if (State.historyService) {
            await State.historyService.closeProfile(safeId);
        }
    } catch (e) {
        console.warn(`[ProfileService] Failed to close history for ${safeId}:`, e);
    }

    // 2. Remove avatar files
    removeAvatarFilesForProfile(safeId);

    // 3. Clear session partition storage and cache in Electron
    try {
        const { session } = require('electron');
        const partition = `persist:profile-${safeId}`;
        const ses = session.fromPartition(partition);
        if (ses) {
            await ses.clearStorageData();
            await ses.clearCache();
        }
    } catch (e) {
        console.warn(`[ProfileService] Failed to clear partition storage for ${safeId}:`, e);
    }

    // 4. Remove session partition directories from disk
    try {
        const sessionDataDir = app.getPath('sessionData');
        const partitionsDir = path.join(sessionDataDir, 'Partitions');
        if (fs.existsSync(partitionsDir)) {
            for (const item of fs.readdirSync(partitionsDir)) {
                if (item.includes(safeId)) {
                    try {
                        fs.rmSync(path.join(partitionsDir, item), { recursive: true, force: true });
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}

    try {
        const userPartitionsDir = path.join(app.getPath('userData'), 'Partitions');
        if (fs.existsSync(userPartitionsDir)) {
            for (const item of fs.readdirSync(userPartitionsDir)) {
                if (item.includes(safeId)) {
                    try {
                        fs.rmSync(path.join(userPartitionsDir, item), { recursive: true, force: true });
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}

    // 5. Remove profile directory in userData/profiles/<safeId>
    try {
        const profilesDir = path.join(app.getPath('userData'), 'profiles', safeId);
        if (fs.existsSync(profilesDir)) {
            fs.rmSync(profilesDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn(`[ProfileService] Failed to remove profiles directory for ${safeId}:`, e);
    }

    // 6. Evict extension cache & unload extension runtime
    try {
        const ExtensionStorage = require('../extensions/ExtensionStorage');
        ExtensionStorage.evictProfileState?.(safeId);
    } catch (_) {}
    try {
        const { getExtensionController } = require('../extensions/ExtensionController');
        getExtensionController().unloadProfile?.(safeId);
    } catch (_) {}

    // 7. Delete bookmarks file
    try {
        const bkPath = path.join(app.getPath('userData'), `bookmarks-${safeId}.json`);
        if (fs.existsSync(bkPath)) {
            fs.unlinkSync(bkPath);
        }
    } catch (_) {}

    // 8. Delete history files (.sqlite, -wal, -shm, key, legacy ndjson)
    try {
        const userData = app.getPath('userData');
        const historyFiles = [
            `history-${safeId}.sqlite`,
            `history-${safeId}.sqlite-wal`,
            `history-${safeId}.sqlite-shm`,
            `history-key-${safeId}.json`,
            `history-${safeId}.ndjson`,
        ];
        for (const hf of historyFiles) {
            const fp = path.join(userData, hf);
            if (fs.existsSync(fp)) {
                try { fs.unlinkSync(fp); } catch (_) {}
            }
        }
    } catch (_) {}

    // 9. Sweep userData for any remaining file or folder matching safeId
    try {
        const userData = app.getPath('userData');
        for (const item of fs.readdirSync(userData)) {
            if (item.includes(safeId)) {
                const fp = path.join(userData, item);
                try {
                    const st = fs.statSync(fp);
                    if (st.isDirectory()) {
                        fs.rmSync(fp, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(fp);
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}

    // 10. Clean permissions
    try {
        const { getPermissionController } = require('../permissions/PermissionController');
        getPermissionController().db.deleteProfile(safeId);
    } catch (_) {}

    // 11. Clean session state (recently closed & session.json & startupSessionDoc)
    try {
        State.recentlyClosedTabsByProfile.delete(safeId);
        const sessionService = require('./sessionService');
        const sessionPath = sessionService.getSessionPath();
        if (fs.existsSync(sessionPath)) {
            const doc = sessionService.readDecodedSessionDoc();
            if (doc && doc.windowsById) {
                let changed = false;
                for (const [wId, wData] of Object.entries(doc.windowsById)) {
                    if (wData?.profileId === safeId) {
                        delete doc.windowsById[wId];
                        changed = true;
                    }
                }
                if (Array.isArray(doc.profiles)) {
                    doc.profiles = doc.profiles.filter((p) => p !== safeId && p?.profileId !== safeId);
                    changed = true;
                }
                if (changed) {
                    const payload = encryption.encrypt(JSON.stringify(doc));
                    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2), 'utf-8');
                }
            }
        }
    } catch (_) {}

    if (State.startupSessionDoc?.windowsById) {
        for (const [wId, wData] of Object.entries(State.startupSessionDoc.windowsById)) {
            if (wData?.profileId === safeId) {
                delete State.startupSessionDoc.windowsById[wId];
            }
        }
    }

    // 12. Clean cookie config in settings
    try {
        const settingsService = require('./settingsService');
        const settings = settingsService.loadSettings();
        if (settings?.cookieConfigByProfile && settings.cookieConfigByProfile[safeId]) {
            delete settings.cookieConfigByProfile[safeId];
            settingsService.saveSettings(settings);
        }
    } catch (_) {}
}

module.exports = {
    getProfilesPath,
    getProfileAvatarsDir,
    loadProfiles,
    saveProfiles,
    ensureProfile,
    safeProfileIdForPath,
    avatarFilePath,
    removeAvatarFilesForProfile,
    validateAvatarDataUrl,
    setProfileAvatarFromDataUrl,
    setProfileAvatarFromPresetPngFile,
    getProfileAvatarDataUrl,
    discoverDiskProfiles,
    deleteProfileDataFromDisk,
};
