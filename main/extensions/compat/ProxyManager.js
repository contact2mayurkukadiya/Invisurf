const { EventEmitter } = require('events');
const { session } = require('electron');
const State = require('../../state');

/**
 * ProxyManager
 * Implements chrome.proxy for managing browser network proxy settings per profile.
 * Maps Chrome ProxyConfig objects to Electron's session.setProxy().
 */
class ProxyManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map<profileId, { config, extensionId }>
         */
        this.profileProxySettings = new Map();
    }

    _resolveSession(profileId) {
        if (!profileId || profileId === State.defaultProfileId) {
            // Check active window contexts
            for (const ctx of State.windowContextsById.values()) {
                if (ctx.partition) return session.fromPartition(ctx.partition);
            }
            return session.defaultSession;
        }
        return session.fromPartition(`persist:profile-${profileId}`);
    }

    _formatElectronProxyRules(rules = {}) {
        if (!rules) return { proxyRules: '', proxyBypassRules: '' };

        let proxyRules = '';
        if (rules.singleProxy) {
            const p = rules.singleProxy;
            const scheme = p.scheme ? `${p.scheme}://` : '';
            const port = p.port ? `:${p.port}` : '';
            proxyRules = `${scheme}${p.host || '127.0.0.1'}${port}`;
        } else {
            const parts = [];
            if (rules.proxyForHttp) {
                const p = rules.proxyForHttp;
                parts.push(`http=${p.scheme ? p.scheme + '://' : ''}${p.host}${p.port ? ':' + p.port : ''}`);
            }
            if (rules.proxyForHttps) {
                const p = rules.proxyForHttps;
                parts.push(`https=${p.scheme ? p.scheme + '://' : ''}${p.host}${p.port ? ':' + p.port : ''}`);
            }
            if (rules.proxyForFtp) {
                const p = rules.proxyForFtp;
                parts.push(`ftp=${p.scheme ? p.scheme + '://' : ''}${p.host}${p.port ? ':' + p.port : ''}`);
            }
            if (rules.fallbackProxy) {
                const p = rules.fallbackProxy;
                parts.push(`fallback=${p.scheme ? p.scheme + '://' : ''}${p.host}${p.port ? ':' + p.port : ''}`);
            }
            proxyRules = parts.join(';');
        }

        let proxyBypassRules = '';
        if (Array.isArray(rules.bypassList) && rules.bypassList.length > 0) {
            proxyBypassRules = rules.bypassList.join(';');
        }

        return { proxyRules, proxyBypassRules };
    }

    async set(profileId, extensionId, { value = {}, scope = 'regular' } = {}) {
        const cleanExtId = String(extensionId || '').trim().toLowerCase();
        const pId = profileId || State.defaultProfileId;
        const targetSession = this._resolveSession(pId);

        let electronConfig = { proxyRules: '', proxyBypassRules: '', pacScript: '' };

        const mode = value.mode || 'direct';
        switch (mode) {
            case 'direct':
                electronConfig.proxyRules = 'direct://';
                break;
            case 'system':
                electronConfig.proxyRules = '';
                break;
            case 'auto_detect':
                electronConfig.pacScript = '';
                break;
            case 'pac_script':
                if (value.pacScript?.url) {
                    electronConfig.pacScript = value.pacScript.url;
                } else if (value.pacScript?.data) {
                    electronConfig.pacScript = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(value.pacScript.data).toString('base64')}`;
                }
                break;
            case 'fixed_servers': {
                const { proxyRules, proxyBypassRules } = this._formatElectronProxyRules(value.rules);
                electronConfig.proxyRules = proxyRules;
                electronConfig.proxyBypassRules = proxyBypassRules;
                break;
            }
            default:
                electronConfig.proxyRules = 'direct://';
        }

        try {
            if (targetSession && typeof targetSession.setProxy === 'function') {
                await targetSession.setProxy(electronConfig);
            }
            this.profileProxySettings.set(pId, { config: value, extensionId: cleanExtId });
            this.emit('proxy-changed', { profileId: pId, extensionId: cleanExtId, config: value });
            return { ok: true };
        } catch (err) {
            console.error('[ProxyManager] Failed to set proxy:', err);
            this.emit('proxy-error', { profileId: pId, extensionId: cleanExtId, error: err?.message || String(err) });
            throw err;
        }
    }

    async get(profileId, details = {}) {
        const pId = profileId || State.defaultProfileId;
        const entry = this.profileProxySettings.get(pId);
        if (!entry) {
            return {
                value: { mode: 'system' },
                levelOfControl: 'controllable_by_this_extension',
            };
        }
        return {
            value: entry.config,
            levelOfControl: 'controlled_by_this_extension',
        };
    }

    async clear(profileId, extensionId, details = {}) {
        const pId = profileId || State.defaultProfileId;
        const targetSession = this._resolveSession(pId);
        try {
            if (targetSession && typeof targetSession.setProxy === 'function') {
                await targetSession.setProxy({ proxyRules: '', proxyBypassRules: '', pacScript: '' });
            }
            this.profileProxySettings.delete(pId);
            this.emit('proxy-changed', { profileId: pId, extensionId, config: { mode: 'system' } });
            return { ok: true };
        } catch (err) {
            console.error('[ProxyManager] Failed to clear proxy:', err);
            throw err;
        }
    }
}

let instance = null;
function getProxyManager() {
    if (!instance) {
        instance = new ProxyManager();
    }
    return instance;
}

module.exports = {
    ProxyManager,
    getProxyManager,
};
