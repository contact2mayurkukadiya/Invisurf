const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const yauzl = require('yauzl');
const { parseManifestPermissions } = require('./ExtensionSecurity');

const CRX_MAGIC = 0x34327243; // 'Cr24' in little-endian uint32
const ZIP_MAGIC = 0x04034b50; // 'PK\x03\x04' in little-endian uint32

/**
 * Downloads a file from a URL, following redirects automatically.
 */
function downloadFile(url, destPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) {
            return reject(new Error('Too many redirects while downloading extension'));
        }

        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': '*/*',
            },
        };

        const req = protocol.get(options, (res) => {
            // Handle redirects (301, 302, 303, 307, 308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                res.resume(); // consume response data to free up memory
                return resolve(downloadFile(redirectUrl, destPath, maxRedirects - 1));
            }

            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`Failed to download extension package. HTTP Status: ${res.statusCode}`));
            }

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);

            res.on('error', (resErr) => {
                fileStream.destroy();
                try { fs.unlinkSync(destPath); } catch (_) { }
                reject(resErr);
            });

            fileStream.on('finish', () => {
                fileStream.close((err) => {
                    if (err) return reject(err);
                    try {
                        const stats = fs.statSync(destPath);
                        if (stats.size === 0) {
                            try { fs.unlinkSync(destPath); } catch (_) { }
                            return reject(new Error('Downloaded extension file is empty (0 bytes)'));
                        }
                    } catch (statErr) {
                        return reject(statErr);
                    }
                    resolve(destPath);
                });
            });

            fileStream.on('error', (err) => {
                try { fs.unlinkSync(destPath); } catch (_) { }
                reject(err);
            });
        });

        req.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch (_) { }
            reject(err);
        });

        req.setTimeout(18000, () => {
            req.destroy(new Error('Connection timed out while downloading extension'));
        });
    });
}

/**
 * Helper to fetch plain text from a URL following redirects with a timeout.
 */
function fetchText(url, timeoutMs = 12000, maxRedirects = 4) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error('Too many redirects while resolving extension archive'));
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const req = protocol.get({
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const nextUrl = new URL(res.headers.location, url).toString();
                return resolve(fetchText(nextUrl, timeoutMs, maxRedirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                if (data.length < 250000) data += chunk;
            });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Connection timed out while fetching archive metadata'));
        });
    });
}

/**
 * Resolves direct Google CDN blob URL for an extension ID if update2 returns 204 or fails.
 */
async function resolveGoogleBlobUrl(extensionId) {
    try {
        const listingUrl = `https://www.crx4chrome.com/extensions/${extensionId}/`;
        const html = await fetchText(listingUrl, 10000);
        const crxPageMatch = html.match(/href=\"(\/crx\/[0-9]+\/)\"/i);
        if (!crxPageMatch) return null;

        const crxPageUrl = `https://www.crx4chrome.com${crxPageMatch[1]}`;
        const crxPageHtml = await fetchText(crxPageUrl, 10000);

        const blobMatch = crxPageHtml.match(/clients2\.googleusercontent\.com[^\"&\s]+/i);
        if (blobMatch) {
            return 'https://' + decodeURIComponent(blobMatch[0]);
        }
    } catch (err) {
        console.warn(`[ExtensionInstaller] Archive CDN blob resolution failed for ${extensionId}:`, err?.message || err);
    }
    return null;
}

/**
 * Downloads CRX from Chrome Web Store by extension ID with automatic resilient fallbacks.
 */
async function downloadCrxFromWebStore(extensionId, destPath) {
    const cleanId = String(extensionId).trim().toLowerCase();
    const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86-64';
    const naclArch = process.arch === 'arm64' ? 'arm' : 'x86-64';
    const chromeVer = process.versions.chrome || '131.0.6778.86';

    const candidates = [
        // Candidate 1: Universal modern Chrome Web Store endpoint (prodversion=9999.0.0.0 satisfies all modern manifests without 204 blocks)
        `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=9999.0.0.0&acceptformat=crx2,crx3&x=id%3D${cleanId}%26installsource%3Dondemand%26uc`,
        // Candidate 2: Platform and architecture-qualified modern Chrome update URL (with prodversion=9999.0.0.0)
        `https://clients2.google.com/service/update2/crx?response=redirect&os=${platform}&arch=${arch}&os_arch=${arch}&nacl_arch=${naclArch}&prod=chromecrx&prodchannel=&prodversion=9999.0.0.0&lang=en-US&acceptformat=crx2,crx3&x=id%3D${cleanId}%26installsource%3Dondemand%26uc`,
        // Candidate 3: Chrome 140+ high compatibility endpoint
        `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.0.0&acceptformat=crx2,crx3&x=id%3D${cleanId}%26installsource%3Dondemand%26uc`,
        // Candidate 4: Platform and architecture-qualified Chrome update URL (current Chrome version)
        `https://clients2.google.com/service/update2/crx?response=redirect&os=${platform}&arch=${arch}&os_arch=${arch}&nacl_arch=${naclArch}&prod=chromecrx&prodchannel=&prodversion=${chromeVer}&lang=en-US&acceptformat=crx3,crx2&x=id%3D${cleanId}%26installsource%3Dondemand%26uc`,
        // Candidate 5: Edge Add-ons endpoint (contains extensive mirror of Chromium extensions)
        `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${cleanId}%26installsource%3Dondemand%26uc`,
    ];

    let lastError = null;
    for (let i = 0; i < candidates.length; i++) {
        const candidateUrl = candidates[i];
        try {
            if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) { }
            }
            return await downloadFile(candidateUrl, destPath);
        } catch (err) {
            lastError = err;
            console.warn(`[ExtensionInstaller] Download candidate ${i + 1}/${candidates.length} failed for ${cleanId}: ${err?.message || err}`);
        }
    }

    // Direct Google CDN Blob fallback (for extensions where update2 returns 204 No Content)
    try {
        console.log(`[ExtensionInstaller] Update2 endpoints returned no content for ${cleanId}, attempting direct Google CDN blob resolution...`);
        const blobUrl = await resolveGoogleBlobUrl(cleanId);
        if (blobUrl) {
            if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) { }
            }
            const res = await downloadFile(blobUrl, destPath);
            console.log(`[ExtensionInstaller] Successfully downloaded extension ${cleanId} from Google CDN blob!`);
            return res;
        }
    } catch (blobErr) {
        console.warn(`[ExtensionInstaller] Google CDN blob download failed for ${cleanId}:`, blobErr?.message || blobErr);
    }

    throw lastError || new Error(`Failed to download extension package for ${cleanId}`);
}

const crypto = require('crypto');

/**
 * Converts a public key buffer into a 32-character Chrome extension ID.
 */
function pubkeyToExtId(pubkeyBuf) {
    const hash = crypto.createHash('sha256').update(pubkeyBuf).digest();
    let id = '';
    for (let i = 0; i < 16; i++) {
        const byte = hash[i];
        id += String.fromCharCode(97 + (byte >> 4));
        id += String.fromCharCode(97 + (byte & 0x0f));
    }
    return id;
}

/**
 * Extracts the base64 public key from a CRX header buffer.
 */
function extractPublicKeyFromCrxHeader(headerBuf, expectedExtId = null) {
    if (!headerBuf || headerBuf.length < 32) return null;
    const cleanExpected = expectedExtId ? String(expectedExtId).trim().toLowerCase() : null;

    // 1. If expected extension ID is provided, scan header buffer for matching public key slice
    if (cleanExpected && cleanExpected.length === 32) {
        for (let i = 0; i < headerBuf.length - 32; i++) {
            for (let l = 64; l <= 512 && i + l <= headerBuf.length; l++) {
                const sub = headerBuf.slice(i, i + l);
                if (pubkeyToExtId(sub) === cleanExpected) {
                    return sub.toString('base64');
                }
            }
        }
    }

    // 2. Fallback: Parse protobuf AsymmetricKeyProof tag 0x0a (field 1 = public_key bytes)
    for (let i = 0; i < headerBuf.length - 64; i++) {
        if (headerBuf[i] === 0x0a) {
            let len = 0;
            let shift = 0;
            let j = i + 1;
            while (j < headerBuf.length && j < i + 5) {
                const b = headerBuf[j++];
                len |= (b & 0x7f) << shift;
                if ((b & 0x80) === 0) break;
                shift += 7;
            }
            if (len >= 64 && len <= 512 && j + len <= headerBuf.length) {
                const candidate = headerBuf.slice(j, j + len);
                if (cleanExpected) {
                    if (pubkeyToExtId(candidate) === cleanExpected) {
                        return candidate.toString('base64');
                    }
                } else {
                    return candidate.toString('base64');
                }
            }
        }
    }
    return null;
}

/**
 * Injects public key as 'key' in manifest.json if missing so Chromium derives the genuine Web Store extension ID.
 */
function injectManifestKey(extractDir, base64Key) {
    if (!extractDir || !base64Key) return false;
    try {
        const manifestPath = path.join(extractDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return false;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (!manifest.key) {
            manifest.key = base64Key;
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
            console.log(`[ExtensionInstaller] Injected manifest 'key' into ${manifestPath}`);
            return true;
        }
    } catch (e) {
        console.warn('[ExtensionInstaller] Failed to inject manifest key:', e?.message || e);
    }
    return false;
}

/**
 * Slices the internal ZIP buffer out of a CRX file buffer and attaches extracted public key.
 */
function extractZipBufferFromCrx(fileBuffer, expectedExtId = null) {
    if (fileBuffer.length < 16) {
        throw new Error('Invalid CRX file: File too small');
    }

    const magic = fileBuffer.readUInt32LE(0);
    // Case 1: Plain ZIP file
    if (magic === ZIP_MAGIC) {
        return fileBuffer;
    }

    // Case 2: CRX package ('Cr24')
    if (magic !== CRX_MAGIC) {
        throw new Error(`Invalid CRX file format: Unexpected magic number (0x${magic.toString(16)})`);
    }

    const version = fileBuffer.readUInt32LE(4);
    if (version === 3) {
        // CRX3: Header length is uint32 at offset 8
        const headerSize = fileBuffer.readUInt32LE(8);
        const zipStart = 12 + headerSize;
        if (zipStart > fileBuffer.length) {
            throw new Error('Corrupt CRX3 header: header size exceeds file length');
        }
        const headerBuf = fileBuffer.slice(12, zipStart);
        const zipBuf = fileBuffer.slice(zipStart);
        zipBuf.publicKey = extractPublicKeyFromCrxHeader(headerBuf, expectedExtId);
        return zipBuf;
    } else if (version === 2) {
        // CRX2: Pubkey len at offset 8, sig len at offset 12
        const pubKeyLen = fileBuffer.readUInt32LE(8);
        const sigLen = fileBuffer.readUInt32LE(12);
        const pubKeyBuf = fileBuffer.slice(16, 16 + pubKeyLen);
        const zipStart = 16 + pubKeyLen + sigLen;
        if (zipStart > fileBuffer.length) {
            throw new Error('Corrupt CRX2 header: header size exceeds file length');
        }
        const zipBuf = fileBuffer.slice(zipStart);
        zipBuf.publicKey = pubKeyBuf.toString('base64');
        return zipBuf;
    }

    throw new Error(`Unsupported CRX version: ${version}`);
}

/**
 * Extracts a ZIP buffer into a target directory with strict Zip Slip protection.
 */
function unpackZipBuffer(zipBuffer, targetDir) {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);

            const resolvedTargetDir = path.resolve(targetDir);

            zipfile.readEntry();

            zipfile.on('entry', (entry) => {
                // Check for zip slip or suspicious paths
                const entryFileName = entry.fileName;
                // Disallow Windows drive letters or null bytes
                if (/^[a-zA-Z]:|[<>"|?*]|\0/.test(entryFileName)) {
                    zipfile.close();
                    return reject(new Error(`Illegal characters in zip entry: ${entryFileName}`));
                }

                const safeRelativePath = path.normalize(entryFileName).replace(/^(\.\.(\/|\\|$))+/, '');
                const destPath = path.resolve(resolvedTargetDir, safeRelativePath);

                if (!destPath.startsWith(resolvedTargetDir)) {
                    zipfile.close();
                    return reject(new Error(`Zip Slip path traversal attempt detected: ${entryFileName}`));
                }

                if (/\/$/.test(entryFileName)) {
                    // Entry is a directory
                    fs.mkdirSync(destPath, { recursive: true });
                    zipfile.readEntry();
                } else {
                    // Entry is a file
                    const parentDir = path.dirname(destPath);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }

                    zipfile.openReadStream(entry, (streamErr, readStream) => {
                        if (streamErr) {
                            zipfile.close();
                            return reject(streamErr);
                        }

                        const writeStream = fs.createWriteStream(destPath);
                        readStream.pipe(writeStream);

                        writeStream.on('finish', () => {
                            zipfile.readEntry();
                        });

                        writeStream.on('error', (wErr) => {
                            zipfile.close();
                            reject(wErr);
                        });
                    });
                }
            });

            zipfile.on('end', () => {
                resolve(resolvedTargetDir);
            });

            zipfile.on('error', (zErr) => {
                reject(zErr);
            });
        });
    });
}

function resolveMessageString(str, messages) {
    if (!str || typeof str !== 'string' || !messages) return str;
    const match = str.match(/^__MSG_([A-Za-z0-9_@]+)__$/);
    if (match) {
        const key = match[1];
        if (messages[key]?.message) {
            return messages[key].message;
        }
        const lowerKey = key.toLowerCase();
        for (const [k, v] of Object.entries(messages)) {
            if (k.toLowerCase() === lowerKey && v?.message) {
                return v.message;
            }
        }
    }
    return str;
}

/**
 * Validates the unpacked extension directory and parses its manifest.json.
 */
function inspectExtractedExtension(extractDir) {
    let explicitId = null;
    const folderName = path.basename(extractDir);
    const parts = folderName.split('_');
    if (parts[0] && parts[0].length >= 10 && !/^\d+(\.\d+)*$/.test(parts[0])) {
        explicitId = parts[0];
    } else {
        const parentDir = path.basename(path.dirname(extractDir));
        if (parentDir && parentDir !== 'Extensions' && parentDir !== 'staging' && parentDir.length >= 10) {
            explicitId = parentDir;
        }
    }
    // Apply polyfills and fix manifest DNR rulesets/i18n first
    ensureExtensionPolyfills(extractDir, explicitId);

    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid extension package: manifest.json is missing');
    }

    let manifest;
    try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        manifest = JSON.parse(raw);
    } catch (parseErr) {
        throw new Error(`Failed to parse manifest.json: ${parseErr.message}`);
    }

    if (!manifest.name || typeof manifest.name !== 'string') {
        throw new Error('Invalid manifest: missing or invalid "name" attribute');
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error('Invalid manifest: missing or invalid "version" attribute');
    }

    const manifestVersion = Number(manifest.manifest_version) || 2;
    const permissionsAudit = parseManifestPermissions(manifest);

    // Resolve best icon path if available
    let iconRelativePath = null;
    const icons = manifest.icons || (manifest.action && manifest.action.default_icon) || null;
    if (icons) {
        if (typeof icons === 'string') {
            iconRelativePath = icons;
        } else if (typeof icons === 'object') {
            // Pick crisp UI-appropriate icon (48 > 32 > 64 > 16 > 128)
            const sizes = ['48', '32', '64', '16', '128'];
            for (const s of sizes) {
                if (icons[s]) {
                    iconRelativePath = icons[s];
                    break;
                }
            }
            if (!iconRelativePath) {
                const keys = Object.keys(icons);
                if (keys.length > 0) iconRelativePath = icons[keys[0]];
            }
        }
    }

    // Default action metadata
    const action = manifest.action || manifest.browser_action || null;
    const hasPopup = !!(action && (action.default_popup || action.popup));
    const popupFile = hasPopup ? (action.default_popup || action.popup) : null;

    // Extract URL match patterns from host_permissions, permissions, and content_scripts
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
    const urlPatterns = Array.from(new Set(patterns));
    const allUrlsSet = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
    const hasAllUrls = urlPatterns.some(p => allUrlsSet.includes(String(p).trim()));
    const isPageAction = !!(manifest.page_action || (manifest.action && manifest.action.default_state === 'disabled'));

    // Options page metadata (options_ui or legacy options_page)
    let optionsPage = null;
    if (manifest.options_ui && typeof manifest.options_ui.page === 'string') {
        optionsPage = manifest.options_ui.page.trim();
    } else if (typeof manifest.options_page === 'string') {
        optionsPage = manifest.options_page.trim();
    }
    const hasOptionsPage = !!optionsPage;

    return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        manifestVersion,
        iconRelativePath,
        hasPopup,
        popupFile,
        hasOptionsPage,
        optionsPage,
        permissionsAudit,
        manifest,
        urlPatterns,
        hasAllUrls,
        isPageAction,
    };
}

const { generateWorkerPolyfill } = require('./compat/workerPolyfill');

function ensureExtensionPolyfills(extractDir, explicitExtId = null) {
    if (!extractDir || !fs.existsSync(extractDir)) return;
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        let extId = explicitExtId;
        if (!extId && manifest.key) {
            try {
                const ExtensionStorage = require('./ExtensionStorage');
                extId = ExtensionStorage.deriveExtIdFromKey(manifest.key);
            } catch (_) { }
        }
        if (!extId || /^\d+(\.\d+)*$/.test(extId) || extId === 'latest') {
            const parentDir = path.basename(path.dirname(extractDir));
            if (parentDir && parentDir !== 'Extensions' && parentDir !== 'staging' && parentDir.length >= 10) {
                extId = parentDir;
            } else {
                const folderName = path.basename(extractDir);
                extId = folderName.split('_')[0] || 'extension';
            }
        }

        let messages = {};
        const localesDir = path.join(extractDir, '_locales');
        const defaultLocale = manifest.default_locale || 'en';
        const localeCandidates = [
            path.join(localesDir, defaultLocale, 'messages.json'),
            path.join(localesDir, 'en', 'messages.json'),
            path.join(localesDir, 'en_US', 'messages.json'),
        ];
        for (const lp of localeCandidates) {
            if (fs.existsSync(lp)) {
                try {
                    messages = JSON.parse(fs.readFileSync(lp, 'utf-8'));
                    break;
                } catch (_) { }
            }
        }

        let manifestDirty = false;

        // 1. Sanitize declarative_net_request.rule_resources:
        // Chromium's C++ validator requires rule_resource paths to end in '.json'.
        // Extensions like AdBlock often store ruleset files without '.json'.
        if (manifest.declarative_net_request && Array.isArray(manifest.declarative_net_request.rule_resources)) {
            for (const res of manifest.declarative_net_request.rule_resources) {
                if (res && typeof res.path === 'string' && !res.path.endsWith('.json')) {
                    const oldRel = res.path;
                    const newRel = `${oldRel}.json`;
                    const oldFull = path.join(extractDir, oldRel);
                    const newFull = path.join(extractDir, newRel);
                    try {
                        if (fs.existsSync(oldFull)) {
                            fs.mkdirSync(path.dirname(newFull), { recursive: true });
                            if (!fs.existsSync(newFull) || fs.statSync(newFull).size !== fs.statSync(oldFull).size) {
                                fs.copyFileSync(oldFull, newFull);
                            }
                        }
                        res.path = newRel;
                        manifestDirty = true;
                    } catch (copyErr) {
                        console.warn(`[ExtensionInstaller] Failed to rename DNR ruleset ${oldRel} to ${newRel}:`, copyErr?.message || copyErr);
                    }
                }
            }
        }

        // 2. Resolve __MSG_ localized strings in manifest
        if (typeof manifest.name === 'string' && manifest.name.startsWith('__MSG_')) {
            const resolved = resolveMessageString(manifest.name, messages);
            if (resolved && resolved !== manifest.name) {
                manifest.name = resolved;
                manifestDirty = true;
            }
        }
        if (typeof manifest.description === 'string' && manifest.description.startsWith('__MSG_')) {
            const resolved = resolveMessageString(manifest.description, messages);
            if (resolved && resolved !== manifest.description) {
                manifest.description = resolved;
                manifestDirty = true;
            }
        }

        if (manifestDirty) {
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
            console.log(`[ExtensionInstaller] Sanitized manifest (DNR & i18n) for ${extractDir}`);
        }

        const polyfillCode = generateWorkerPolyfill(extId, manifest, messages);

        const bgScripts = [];
        if (manifest.background?.service_worker) {
            bgScripts.push(manifest.background.service_worker);
        }
        if (Array.isArray(manifest.background?.scripts)) {
            bgScripts.push(...manifest.background.scripts);
        }
        for (const relScript of bgScripts) {
            const scriptPath = path.join(extractDir, relScript);
            if (fs.existsSync(scriptPath)) {
                let content = fs.readFileSync(scriptPath, 'utf-8');
                // Strip existing polyfill block if present to compare
                const strippedContent = content.includes('/* [InviSurf Extension Runtime Polyfill] */')
                    ? content.replace(/\/\* \[InviSurf Extension Runtime Polyfill\] \*\/[\s\S]*?\/\* \[End InviSurf Extension Runtime Polyfill\] \*\/\n?/, '')
                    : content;
                const newContent = polyfillCode.trim() + '\n' + strippedContent.trimStart();
                if (newContent.trim() !== content.trim()) {
                    fs.writeFileSync(scriptPath, newContent, 'utf-8');
                    console.log(`[ExtensionInstaller] Applied runtime polyfill (${extId}) to ${scriptPath}`);
                }
            }
        }

        if (manifest.background?.service_worker) {
            const bgHtmlPath = path.join(extractDir, '_invisurf_background_page.html');
            const workerScript = manifest.background.service_worker.replace(/^\/+/, '');
            const isModule = manifest.background.type === 'module';
            const scriptTag = isModule
                ? `<script type="module" src="${workerScript}"></script>`
                : `<script src="${workerScript}"></script>`;
            const bgHtmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>InviSurf Extension Background Host</title>
</head>
<body>
    ${scriptTag}
</body>
</html>`;
            try {
                fs.writeFileSync(bgHtmlPath, bgHtmlContent, 'utf-8');
                console.log(`[ExtensionInstaller] Generated MV3 background host page for ${extId}`);
            } catch (err) {
                console.warn(`[ExtensionInstaller] Failed to write background host page for ${extId}:`, err?.message || err);
            }
        }
    } catch (err) {
        console.warn(`[ExtensionInstaller] Failed to apply polyfills to ${extractDir}:`, err?.message || err);
    }
}

module.exports = {
    downloadFile,
    downloadCrxFromWebStore,
    resolveGoogleBlobUrl,
    extractZipBufferFromCrx,
    unpackZipBuffer,
    inspectExtractedExtension,
    ensureExtensionPolyfills,
    injectManifestKey,
};
