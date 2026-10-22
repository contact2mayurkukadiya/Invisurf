const { EventEmitter } = require('events');
const bookmarkService = require('../../services/bookmarkService');
const State = require('../../state');

/**
 * BookmarkManager
 * Bridges Chrome's chrome.bookmarks extension API to InviSurf's bookmarkService.
 */
class BookmarkManager extends EventEmitter {
    constructor() {
        super();
    }

    _formatNode(node, parentId = '0') {
        if (!node) return null;
        const isFolder = Array.isArray(node.children);
        return {
            id: String(node.id || '0'),
            parentId: String(node.parentId != null ? node.parentId : parentId),
            index: typeof node.index === 'number' ? node.index : 0,
            title: String(node.title || ''),
            url: isFolder ? undefined : String(node.url || ''),
            dateAdded: node.dateAdded || Date.now(),
            dateGroupModified: isFolder ? (node.dateGroupModified || Date.now()) : undefined,
            children: isFolder ? node.children.map(c => this._formatNode(c, String(node.id))) : undefined,
        };
    }

    _getRootTree(profileId) {
        const data = bookmarkService.loadBookmarks(profileId);
        const barChildren = (data.bar || []).map(b => this._formatNode(b, '1'));
        const otherChildren = (data.other || []).map(b => this._formatNode(b, '2'));
        const mobileChildren = (data.mobile || []).map(b => this._formatNode(b, '3'));

        return [{
            id: '0',
            title: '',
            children: [
                { id: '1', parentId: '0', title: 'Bookmarks Bar', children: barChildren },
                { id: '2', parentId: '0', title: 'Other Bookmarks', children: otherChildren },
                { id: '3', parentId: '0', title: 'Mobile Bookmarks', children: mobileChildren },
            ],
        }];
    }

    _findNodeInTree(nodes, id) {
        if (!Array.isArray(nodes)) return null;
        for (const n of nodes) {
            if (!n) continue;
            if (String(n.id) === String(id)) return n;
            if (Array.isArray(n.children)) {
                const found = this._findNodeInTree(n.children, id);
                if (found) return found;
            }
        }
        return null;
    }

    async getTree(profileId) {
        const pId = profileId || State.defaultProfileId;
        return this._getRootTree(pId);
    }

    async getSubTree(profileId, id) {
        const tree = await this.getTree(profileId);
        const node = this._findNodeInTree(tree, String(id));
        return node ? [node] : [];
    }

    async get(profileId, idOrList) {
        const tree = await this.getTree(profileId);
        const ids = Array.isArray(idOrList) ? idOrList.map(String) : [String(idOrList)];
        const results = [];
        for (const id of ids) {
            const node = this._findNodeInTree(tree, id);
            if (node) {
                // chrome.bookmarks.get does NOT include children array
                const clone = { ...node };
                delete clone.children;
                results.push(clone);
            }
        }
        return results;
    }

    async getChildren(profileId, id) {
        const tree = await this.getTree(profileId);
        const node = this._findNodeInTree(tree, String(id));
        return node?.children ? node.children.map(c => {
            const clone = { ...c };
            delete clone.children;
            return clone;
        }) : [];
    }

    async getRecent(profileId, numberOfItems = 10) {
        const tree = await this.getTree(profileId);
        const flat = [];
        function flatten(nodes) {
            if (!Array.isArray(nodes)) return;
            for (const n of nodes) {
                if (n.url) flat.push(n);
                if (Array.isArray(n.children)) flatten(n.children);
            }
        }
        flatten(tree);
        flat.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        return flat.slice(0, Math.max(1, numberOfItems));
    }

    async search(profileId, query) {
        const pId = profileId || State.defaultProfileId;
        const qStr = typeof query === 'string' ? query : (query?.query || query?.title || query?.url || '');
        const res = bookmarkService.searchBookmarks(pId, qStr, 100);
        return (res?.items || []).map(b => this._formatNode(b));
    }

    async create(profileId, bookmark = {}) {
        const pId = profileId || State.defaultProfileId;
        const data = bookmarkService.loadBookmarks(pId);
        const parentId = String(bookmark.parentId || '1');
        const targetList = parentId === '2' ? (data.other = data.other || []) :
                           parentId === '3' ? (data.mobile = data.mobile || []) :
                           (data.bar = data.bar || []);

        const isFolder = !bookmark.url;
        const newNode = {
            id: 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            parentId,
            title: String(bookmark.title || ''),
            url: isFolder ? undefined : String(bookmark.url || ''),
            dateAdded: Date.now(),
            children: isFolder ? [] : undefined,
        };

        if (typeof bookmark.index === 'number' && bookmark.index >= 0 && bookmark.index < targetList.length) {
            targetList.splice(bookmark.index, 0, newNode);
        } else {
            targetList.push(newNode);
        }

        bookmarkService.saveBookmarks(pId, data);
        bookmarkService.broadcastBookmarks(pId);
        this.emit('bookmark-created', { profileId: pId, node: newNode });
        return this._formatNode(newNode, parentId);
    }

    async update(profileId, id, changes = {}) {
        const pId = profileId || State.defaultProfileId;
        const data = bookmarkService.loadBookmarks(pId);
        let updated = null;

        function updateInList(list) {
            if (!Array.isArray(list)) return;
            for (const item of list) {
                if (String(item.id) === String(id)) {
                    if (changes.title !== undefined) item.title = String(changes.title);
                    if (changes.url !== undefined && item.url !== undefined) item.url = String(changes.url);
                    updated = item;
                    return;
                }
                if (Array.isArray(item.children)) updateInList(item.children);
            }
        }

        updateInList(data.bar || []);
        if (!updated) updateInList(data.other || []);
        if (!updated) updateInList(data.mobile || []);

        if (updated) {
            bookmarkService.saveBookmarks(pId, data);
            bookmarkService.broadcastBookmarks(pId);
            this.emit('bookmark-changed', { profileId: pId, id, changes });
            return this._formatNode(updated);
        }
        throw new Error(`Bookmark not found: ${id}`);
    }

    async remove(profileId, id) {
        const pId = profileId || State.defaultProfileId;
        const success = bookmarkService.deleteBookmarks(pId, [id]);
        if (success) {
            this.emit('bookmark-removed', { profileId: pId, id });
        }
        return success;
    }

    async removeTree(profileId, id) {
        return this.remove(profileId, id);
    }
}

let instance = null;
function getBookmarkManager() {
    if (!instance) instance = new BookmarkManager();
    return instance;
}

module.exports = {
    BookmarkManager,
    getBookmarkManager,
};
