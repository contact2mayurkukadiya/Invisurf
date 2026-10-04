const { EventEmitter } = require('events');

/**
 * ContextMenuManager
 * Manages extension-registered context menu items.
 * Can be hooked into InviSurf's context-menu event listeners.
 */
class ContextMenuManager extends EventEmitter {
    constructor() {
        super();
        /**
         * Map of extensionId -> Map<menuItemId, MenuItemProperties>
         */
        this.menus = new Map();
        this.nextGeneratedId = 1;
    }

    _getExtMap(extensionId) {
        const cleanId = String(extensionId || '').trim().toLowerCase();
        if (!this.menus.has(cleanId)) {
            this.menus.set(cleanId, new Map());
        }
        return this.menus.get(cleanId);
    }

    create(extensionId, createProperties = {}) {
        const extMap = this._getExtMap(extensionId);
        const id = createProperties.id ? String(createProperties.id) : `menu_item_${this.nextGeneratedId++}`;

        const item = {
            id,
            title: createProperties.title || '',
            type: createProperties.type || 'normal',
            contexts: createProperties.contexts || ['page'],
            enabled: createProperties.enabled !== false,
            checked: !!createProperties.checked,
            parentId: createProperties.parentId || null,
        };

        extMap.set(id, item);
        return id;
    }

    update(extensionId, id, updateProperties = {}) {
        const extMap = this._getExtMap(extensionId);
        const strId = String(id);
        const item = extMap.get(strId);
        if (!item) return;

        if (updateProperties.title !== undefined) item.title = updateProperties.title;
        if (updateProperties.type !== undefined) item.type = updateProperties.type;
        if (updateProperties.contexts !== undefined) item.contexts = updateProperties.contexts;
        if (updateProperties.enabled !== undefined) item.enabled = updateProperties.enabled;
        if (updateProperties.checked !== undefined) item.checked = updateProperties.checked;
        if (updateProperties.parentId !== undefined) item.parentId = updateProperties.parentId;
    }

    remove(extensionId, id) {
        const extMap = this._getExtMap(extensionId);
        return extMap.delete(String(id));
    }

    removeAll(extensionId) {
        const extMap = this._getExtMap(extensionId);
        extMap.clear();
    }

    getItemsForExtension(extensionId) {
        const extMap = this._getExtMap(extensionId);
        return Array.from(extMap.values());
    }

    getAllItems() {
        const all = [];
        for (const [extId, map] of this.menus.entries()) {
            for (const item of map.values()) {
                all.push({ ...item, extensionId: extId });
            }
        }
        return all;
    }

    _matchesContext(itemContexts, params, hasSelection) {
        if (!itemContexts || !Array.isArray(itemContexts) || itemContexts.length === 0 || itemContexts.includes('all')) {
            return true;
        }
        for (const ctx of itemContexts) {
            if (ctx === 'link' && params.linkURL) return true;
            if (ctx === 'image' && params.mediaType === 'image') return true;
            if (ctx === 'video' && params.mediaType === 'video') return true;
            if (ctx === 'audio' && params.mediaType === 'audio') return true;
            if (ctx === 'editable' && params.isEditable) return true;
            if (ctx === 'selection' && hasSelection) return true;
            if (ctx === 'page') return true;
        }
        return false;
    }

    /**
     * Builds Electron-compatible menu items from extension-registered menus
     * filtered by the right-click context (link, selection, media, page, etc.).
     */
    buildContextMenuItems(params, tab) {
        const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
        const selectedText = hasSelection ? params.selectionText.trim() : '';

        // Group matching items by extensionId
        const extItemsMap = new Map();
        for (const [extId, itemMap] of this.menus.entries()) {
            const matchingItems = [];
            for (const item of itemMap.values()) {
                if (this._matchesContext(item.contexts, params, hasSelection)) {
                    matchingItems.push(item);
                }
            }
            if (matchingItems.length > 0) {
                extItemsMap.set(extId, matchingItems);
            }
        }

        if (extItemsMap.size === 0) return [];

        const menuItems = [];

        for (const [extId, items] of extItemsMap.entries()) {
            const roots = [];
            const childrenMap = new Map();

            for (const item of items) {
                if (item.parentId) {
                    if (!childrenMap.has(item.parentId)) childrenMap.set(item.parentId, []);
                    childrenMap.get(item.parentId).push(item);
                } else {
                    roots.push(item);
                }
            }

            const buildSubmenu = (children) => {
                return children.map(child => toElectronMenuItem(child));
            };

            const toElectronMenuItem = (item) => {
                if (item.type === 'separator') {
                    return { type: 'separator' };
                }

                let label = item.title || '';
                if (label.includes('%s')) {
                    label = label.replace(/%s/g, selectedText);
                }

                const childList = childrenMap.get(item.id) || [];
                const electronItem = {
                    label,
                    type: item.type === 'checkbox' ? 'checkbox' : (item.type === 'radio' ? 'radio' : 'normal'),
                    checked: item.checked,
                    enabled: item.enabled !== false,
                };

                if (childList.length > 0) {
                    electronItem.submenu = buildSubmenu(childList);
                } else {
                    electronItem.click = () => {
                        const clickInfo = {
                            menuItemId: item.id,
                            parentMenuItemId: item.parentId || undefined,
                            mediaType: params.mediaType !== 'none' ? params.mediaType : undefined,
                            linkUrl: params.linkURL || undefined,
                            srcUrl: params.srcURL || undefined,
                            pageUrl: params.pageURL || (tab ? tab.url : ''),
                            frameUrl: params.frameURL || undefined,
                            selectionText: params.selectionText || undefined,
                            editable: Boolean(params.isEditable),
                            checked: item.type === 'checkbox' || item.type === 'radio' ? !item.checked : undefined,
                            wasChecked: item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined,
                        };
                        if (item.type === 'checkbox') {
                            item.checked = !item.checked;
                        }
                        this.dispatchClick(extId, item.id, clickInfo, tab);
                    };
                }

                return electronItem;
            };

            for (const root of roots) {
                menuItems.push(toElectronMenuItem(root));
            }
        }

        return menuItems;
    }

    dispatchClick(extensionId, menuItemId, clickInfo, tab) {
        this.emit('item-clicked', {
            extensionId,
            menuItemId,
            clickInfo,
            tab,
        });
    }
}

// Singleton
let instance = null;
function getContextMenuManager() {
    if (!instance) {
        instance = new ContextMenuManager();
    }
    return instance;
}

module.exports = {
    ContextMenuManager,
    getContextMenuManager,
};
