const { EventEmitter } = require('events');
const State = require('../../state');

/**
 * HistoryManager
 * Bridges Chrome's chrome.history extension API to InviSurf's HistoryService.
 */
class HistoryManager extends EventEmitter {
    constructor() {
        super();
    }

    _getService() {
        if (!State.historyService) {
            throw new Error('HistoryService is not initialized');
        }
        return State.historyService;
    }

    async search(profileId, query = {}) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        const text = String(query.text || '').trim();
        const maxResults = query.maxResults != null ? Number(query.maxResults) : 100;

        const res = await service.search(pId, {
            query: text,
            limit: maxResults,
        });

        const items = (res?.items || []).map(item => ({
            id: String(item.visitId || item.urlId || Math.random()),
            url: item.url,
            title: item.title || item.url,
            lastVisitTime: item.visitTime || Date.now(),
            visitCount: 1,
            typedCount: item.transition === 'TYPED' ? 1 : 0,
        }));

        // Filter by startTime / endTime if provided
        return items.filter(i => {
            if (query.startTime && i.lastVisitTime < query.startTime) return false;
            if (query.endTime && i.lastVisitTime > query.endTime) return false;
            return true;
        });
    }

    async getVisits(profileId, details = {}) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        const url = String(details.url || '');
        if (!url) return [];

        const res = await service.search(pId, { query: url, limit: 50 });
        const matched = (res?.items || []).filter(i => i.url === url);

        return matched.map(i => ({
            id: String(i.visitId || '1'),
            visitId: String(i.visitId || '1'),
            visitTime: i.visitTime || Date.now(),
            referringVisitId: '0',
            transition: (i.transition || 'link').toLowerCase(),
        }));
    }

    async addUrl(profileId, details = {}) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        const url = String(details.url || '');
        if (!url) return;

        await service.recordVisit(pId, {
            url,
            title: details.title || url,
            transition: details.transition || 'LINK',
        });

        this.emit('history-visited', {
            id: 'visit_' + Date.now(),
            url,
            title: details.title || url,
            lastVisitTime: Date.now(),
        });
    }

    async deleteUrl(profileId, details = {}) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        const url = String(details.url || '');
        if (!url) return;

        await service.deleteUrls(pId, [url]);
        this.emit('history-removed', { allHistory: false, urls: [url] });
    }

    async deleteRange(profileId, range = {}) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        await service.clear(pId, { since: range.startTime || null });
        this.emit('history-removed', { allHistory: false, urls: [] });
    }

    async deleteAll(profileId) {
        const service = this._getService();
        const pId = profileId || State.defaultProfileId;
        await service.clear(pId, { since: null });
        this.emit('history-removed', { allHistory: true, urls: [] });
    }
}

let instance = null;
function getHistoryManager() {
    if (!instance) instance = new HistoryManager();
    return instance;
}

module.exports = {
    HistoryManager,
    getHistoryManager,
};
