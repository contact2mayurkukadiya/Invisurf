const { session } = require('electron');
const { EventEmitter } = require('events');
const State = require('../../state');

/**
 * CookieManager
 * Bridges chrome.cookies API to Electron's session.cookies.
 */
class CookieManager extends EventEmitter {
    constructor() {
        super();
        this.listenedSessions = new WeakSet();
    }

    _resolveSession(profileId) {
        if (!profileId || profileId === State.defaultProfileId) {
            return session.defaultSession;
        }
        const partition = `persist:profile_${profileId}`;
        return session.fromPartition(partition);
    }

    _attachSessionListener(ses, profileId) {
        if (!ses || this.listenedSessions.has(ses)) return;
        this.listenedSessions.add(ses);

        ses.cookies.on('changed', (event, cookie, cause, removed) => {
            const chromeCookie = this._formatCookie(cookie);
            this.emit('cookie-changed', {
                profileId,
                changeInfo: {
                    cause: cause || 'explicit',
                    cookie: chromeCookie,
                    removed: !!removed,
                },
            });
        });
    }

    _formatCookie(c) {
        if (!c) return null;
        return {
            name: c.name || '',
            value: c.value || '',
            domain: c.domain || '',
            path: c.path || '/',
            secure: !!c.secure,
            httpOnly: !!c.httpOnly,
            sameSite: (c.sameSite || 'lax').toLowerCase(),
            hostOnly: !c.domain?.startsWith('.'),
            session: !c.expirationDate,
            expirationDate: c.expirationDate,
            storeId: '0',
        };
    }

    async get(profileId, details = {}) {
        const ses = this._resolveSession(profileId);
        this._attachSessionListener(ses, profileId);

        const cookies = await ses.cookies.get({
            url: details.url,
            name: details.name,
        });

        return cookies.length > 0 ? this._formatCookie(cookies[0]) : null;
    }

    async getAll(profileId, details = {}) {
        const ses = this._resolveSession(profileId);
        this._attachSessionListener(ses, profileId);

        const filter = {};
        if (details.url) filter.url = details.url;
        if (details.name) filter.name = details.name;
        if (details.domain) filter.domain = details.domain;
        if (details.path) filter.path = details.path;
        if (details.secure !== undefined) filter.secure = details.secure;
        if (details.session !== undefined) filter.session = details.session;

        const cookies = await ses.cookies.get(filter);
        return cookies.map(c => this._formatCookie(c));
    }

    async set(profileId, details = {}) {
        const ses = this._resolveSession(profileId);
        this._attachSessionListener(ses, profileId);

        const cookieData = {
            url: details.url,
            name: details.name,
            value: details.value || '',
            domain: details.domain,
            path: details.path || '/',
            secure: details.secure,
            httpOnly: details.httpOnly,
            sameSite: details.sameSite ? details.sameSite.toLowerCase() : undefined,
            expirationDate: details.expirationDate,
        };

        // Remove undefined fields
        Object.keys(cookieData).forEach(k => cookieData[k] === undefined && delete cookieData[k]);

        await ses.cookies.set(cookieData);
        return this.get(profileId, { url: details.url, name: details.name });
    }

    async remove(profileId, details = {}) {
        const ses = this._resolveSession(profileId);
        this._attachSessionListener(ses, profileId);

        if (!details.url || !details.name) return null;
        await ses.cookies.remove(details.url, details.name);
        return { url: details.url, name: details.name, storeId: details.storeId || '0' };
    }
}

// Singleton
let instance = null;
function getCookieManager() {
    if (!instance) {
        instance = new CookieManager();
    }
    return instance;
}

module.exports = {
    CookieManager,
    getCookieManager,
};
