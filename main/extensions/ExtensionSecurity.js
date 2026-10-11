const PERMISSION_DESCRIPTIONS = {
    // High Risk
    '<all_urls>': {
        risk: 'high',
        title: 'Access all websites',
        description: 'Read and modify your data on all websites you visit.',
    },
    'cookies': {
        risk: 'high',
        title: 'Manage cookies',
        description: 'Read, modify, and delete your browsing cookies for websites.',
    },
    'webRequest': {
        risk: 'high',
        title: 'Inspect network traffic',
        description: 'Observe and intercept network requests made by web pages.',
    },
    'webRequestBlocking': {
        risk: 'high',
        title: 'Modify network traffic',
        description: 'Block, modify, or redirect network requests made by web pages.',
    },
    'proxy': {
        risk: 'high',
        title: 'Manage proxy settings',
        description: 'Route your browser network traffic through custom proxies.',
    },
    'privacy': {
        risk: 'high',
        title: 'Modify privacy settings',
        description: 'Control your privacy and security settings in the browser.',
    },

    // Medium Risk
    'tabs': {
        risk: 'medium',
        title: 'Access tabs and history',
        description: 'Access the address, title, and status of your open tabs.',
    },
    'scripting': {
        risk: 'medium',
        title: 'Execute scripts',
        description: 'Inject scripts and styling into web pages.',
    },
    'activeTab': {
        risk: 'medium',
        title: 'Access current active tab',
        description: 'Temporarily interact with the active tab when you click the extension icon.',
    },
    'declarativeNetRequest': {
        risk: 'medium',
        title: 'Block content & ads',
        description: 'Block or modify network requests using declarative rules.',
    },
    'declarativeNetRequestWithHostAccess': {
        risk: 'medium',
        title: 'Block content across hosts',
        description: 'Block or modify network requests on specific websites.',
    },
    'management': {
        risk: 'medium',
        title: 'Manage extensions',
        description: 'View and manage other installed browser extensions.',
    },
    'webNavigation': {
        risk: 'medium',
        title: 'Monitor page navigation',
        description: 'Receive notifications when pages begin and finish loading.',
    },
    'history': {
        risk: 'medium',
        title: 'Browsing history',
        description: 'Read and modify your browsing history.',
    },
    'bookmarks': {
        risk: 'medium',
        title: 'Bookmarks',
        description: 'Read and modify your bookmarks.',
    },

    // Low Risk
    'storage': {
        risk: 'low',
        title: 'Local storage',
        description: 'Store extension settings and data locally in your profile.',
    },
    'unlimitedStorage': {
        risk: 'low',
        title: 'Unlimited local storage',
        description: 'Store an unlimited amount of extension data locally.',
    },
    'alarms': {
        risk: 'low',
        title: 'Scheduled alarms',
        description: 'Schedule periodic tasks and timers in the background.',
    },
    'contextMenus': {
        risk: 'low',
        title: 'Context menus',
        description: 'Add custom options to the right-click context menu.',
    },
    'notifications': {
        risk: 'low',
        title: 'Display notifications',
        description: 'Show desktop notifications to you.',
    },
    'sidePanel': {
        risk: 'low',
        title: 'Side panel',
        description: 'Display extension content in a browser side panel.',
    },
    'offscreen': {
        risk: 'low',
        title: 'Offscreen documents',
        description: 'Perform background audio/DOM tasks in offscreen frames.',
    },
};

/**
 * Normalizes host match patterns into human-readable descriptions.
 */
function describeHostPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') return null;
    const trimmed = pattern.trim();
    if (trimmed === '<all_urls>' || trimmed === '*://*/*' || trimmed === 'http://*/*' || trimmed === 'https://*/*') {
        return {
            pattern: trimmed,
            risk: 'high',
            description: 'Read and change your data on all websites',
        };
    }

    try {
        const match = trimmed.match(/^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)?$/);
        if (match) {
            const host = match[2];
            return {
                pattern: trimmed,
                risk: host.includes('*') ? 'high' : 'medium',
                description: `Read and change your data on ${host.replace(/^\*\./, 'all ')}`,
            };
        }
    } catch (_) { /* ignore */ }

    return {
        pattern: trimmed,
        risk: 'medium',
        description: `Access to ${trimmed}`,
    };
}

/**
 * Extracts and categorizes permissions from a Manifest V3 object.
 */
function parseManifestPermissions(manifest = {}) {
    const rawPermissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const rawOptionalPermissions = Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [];
    const rawHostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];

    const apiPermissions = [];
    const hostPermissions = [];
    const warnings = [];

    // Separate host permissions vs API permissions
    for (const p of rawPermissions) {
        if (typeof p !== 'string') continue;
        if (p.includes('://') || p === '<all_urls>') {
            hostPermissions.push(p);
        } else {
            apiPermissions.push(p);
        }
    }

    for (const hp of rawHostPermissions) {
        if (typeof hp === 'string' && !hostPermissions.includes(hp)) {
            hostPermissions.push(hp);
        }
    }

    // Generate warnings for API permissions
    for (const perm of apiPermissions) {
        const desc = PERMISSION_DESCRIPTIONS[perm];
        if (desc) {
            warnings.push({
                permission: perm,
                risk: desc.risk,
                title: desc.title,
                description: desc.description,
            });
        } else {
            warnings.push({
                permission: perm,
                risk: 'low',
                title: perm,
                description: `Access to extension capability: ${perm}`,
            });
        }
    }

    // Generate warnings for Host permissions
    for (const host of hostPermissions) {
        const desc = describeHostPattern(host);
        if (desc) {
            warnings.push({
                permission: host,
                risk: desc.risk,
                title: 'Website Access',
                description: desc.description,
            });
        }
    }

    // Sort warnings: high risk first, then medium, then low
    const riskPriority = { high: 0, medium: 1, low: 2 };
    warnings.sort((a, b) => (riskPriority[a.risk] ?? 3) - (riskPriority[b.risk] ?? 3));

    return {
        apiPermissions,
        hostPermissions,
        optionalPermissions: rawOptionalPermissions,
        warnings,
    };
}

/**
 * Checks whether an origin or URL belongs to an extension.
 */
function isExtensionUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('chrome-extension://');
}

/**
 * Extracts extension ID from a chrome-extension:// URL.
 */
function getExtensionIdFromUrl(url) {
    if (!isExtensionUrl(url)) return null;
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch (_) {
        return null;
    }
}

/**
 * Validates that an IPC event is coming from a trusted InviSurf renderer
 * and not from an untrusted extension frame or arbitrary web page.
 */
function validateTrustedIpcSender(event) {
    if (!event || !event.senderFrame) return false;
    const url = event.senderFrame.url || '';
    // Block any extension origin from invoking privileged InviSurf IPC
    if (isExtensionUrl(url)) {
        return false;
    }
    // Allow app:// or file:// or internal scheme
    return url.startsWith('app://') || url.startsWith('file://') || url === 'about:blank';
}

/**
 * Safely resolves and validates a target navigation URL requested by an extension.
 * Guarantees:
 * 1. Blocks dangerous schemes: file://, javascript:, data:, invisurf://, chrome://, app://, stealth://, etc.
 * 2. Allows safe web URLs: http://, https://, and about:blank.
 * 3. Safely resolves extension-relative paths (e.g. "/Game_Source/index.html", "popup.html")
 *    strictly to the requesting extension's own origin: `chrome-extension://${cleanExtId}/${path}`.
 * 4. Strictly prevents cross-extension origin access (blocks chrome-extension:// URLs for different extension IDs).
 * 5. Prevents protocol-relative bypasses (//evil.com, \\\evil.com), path traversal attacks, and control characters.
 *
 * @param {string} rawUrl - The requested URL or relative path.
 * @param {string} [extensionId] - The ID of the extension requesting navigation.
 * @returns {string} The fully qualified, validated, and normalized URL.
 * @throws {Error} If the URL violates security constraints or targets a disallowed scheme.
 */
function resolveExtensionNavigationUrl(rawUrl, extensionId) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return 'about:blank';
    }

    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed === 'about:blank') {
        return 'about:blank';
    }

    // Block control characters, line breaks, and null bytes
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
        throw new Error('[Security] URL contains invalid control characters');
    }

    // Block protocol-relative (//) and backslash-prefixed (\\ or \/) evasion attempts
    if (trimmed.startsWith('//') || trimmed.startsWith('\\') || (/^[\\/]/.test(trimmed) && trimmed.length > 1 && (trimmed[1] === '\\' || trimmed[1] === '/'))) {
        throw new Error(`[Security] Protocol-relative or malformed URL blocked: ${trimmed}`);
    }

    const { sanitizeExtensionId } = require('./ExtensionStorage');
    const cleanExtId = extensionId ? sanitizeExtensionId(extensionId) : '';

    let parsed = null;
    try {
        if (cleanExtId) {
            parsed = new URL(trimmed, `chrome-extension://${cleanExtId}/`);
        } else {
            parsed = new URL(trimmed);
        }
    } catch {
        throw new Error(`[Security] Invalid URL format: ${trimmed}`);
    }

    const protocol = parsed.protocol.toLowerCase();

    // 1. Allowed standard web schemes
    if (protocol === 'http:' || protocol === 'https:') {
        return parsed.href;
    }

    // 2. Allowed chrome-extension scheme (MUST match caller's extension ID)
    if (protocol === 'chrome-extension:') {
        if (!cleanExtId) {
            throw new Error(`[Security] Extension context required to open chrome-extension URLs: ${trimmed}`);
        }
        if (parsed.hostname.toLowerCase() !== cleanExtId.toLowerCase()) {
            throw new Error(`[Security] Cross-extension navigation blocked: ${trimmed}`);
        }
        return parsed.href;
    }

    // 3. Strict rejection of internal schemes and unsafe protocols
    // (e.g. invisurf:, chrome:, app:, stealth:, file:, javascript:, data:, blob:, vbscript:)
    throw new Error(`[Security] Extensions are not permitted to navigate to ${protocol} URLs: ${trimmed}`);
}

module.exports = {
    PERMISSION_DESCRIPTIONS,
    describeHostPattern,
    parseManifestPermissions,
    isExtensionUrl,
    getExtensionIdFromUrl,
    validateTrustedIpcSender,
    resolveExtensionNavigationUrl,
};

