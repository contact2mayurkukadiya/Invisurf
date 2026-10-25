import React, { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';

const STORAGE_KEY = 'invisurf_reading_list';

function loadReadingList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveReadingList(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (_) { }
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return url || '';
  }
}

export default function ReadingListPanel() {
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const currentTab = useSelector((s) => s.browser.tabs[currentTabId]);
  const [items, setItems] = useState(loadReadingList);

  useEffect(() => {
    saveReadingList(items);
  }, [items]);

  const canAddCurrentTab = Boolean(
    currentTab?.url &&
    !currentTab.isNewTab &&
    !currentTab.url.startsWith('chrome') &&
    !currentTab.url.startsWith('about:')
  );

  const isCurrentTabAlreadyAdded = Boolean(
    currentTab?.url && items.some((item) => item.url === currentTab.url)
  );

  const handleAddCurrentTab = useCallback(() => {
    if (!canAddCurrentTab) return;
    const url = currentTab.url;
    const title = currentTab.title || url;
    const favicon = currentTab.favicon || null;
    const domain = getDomain(url);

    setItems((prev) => {
      // If already present, bring it to unread top
      const filtered = prev.filter((i) => i.url !== url);
      return [
        {
          id: `rl-${Date.now()}`,
          url,
          title,
          favicon,
          domain,
          addedAt: Date.now(),
          read: false,
        },
        ...filtered,
      ];
    });
  }, [canAddCurrentTab, currentTab]);

  const handleToggleRead = useCallback((id, e) => {
    e.stopPropagation();
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: !item.read } : item))
    );
  }, []);

  const handleDelete = useCallback((id, e) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleOpenItem = useCallback(
    (url) => {
      if (!url) return;
      if (currentTabId && window.electronAPI?.navigate) {
        window.electronAPI.navigate(currentTabId, url);
      } else if (window.electronAPI?.newTab) {
        window.electronAPI.newTab(`tab-${Date.now()}`, false, url);
      }
    },
    [currentTabId]
  );

  const unreadItems = items.filter((i) => !i.read);
  const readItems = items.filter((i) => i.read);

  return (
    <div className="reading-list-panel">
      <button
        type="button"
        className="rl-add-tab-btn"
        disabled={!canAddCurrentTab}
        style={{ opacity: canAddCurrentTab ? 1 : 0.6 }}
        onClick={handleAddCurrentTab}
        title={
          canAddCurrentTab
            ? isCurrentTabAlreadyAdded
              ? 'Current tab already in reading list (click to refresh)'
              : 'Add current tab to reading list'
            : 'Cannot add this page to reading list'
        }
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add current tab</span>
      </button>

      {items.length === 0 ? (
        <div className="sp-empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <div>Reading list is empty</div>
          <div style={{ fontSize: '11px', opacity: 0.7 }}>Click "Add current tab" to save pages for later.</div>
        </div>
      ) : (
        <>
          {unreadItems.length > 0 && (
            <div className="rl-section">
              <div className="rl-section-header">Unread ({unreadItems.length})</div>
              <div className="rl-items-list">
                {unreadItems.map((item) => (
                  <div
                    key={item.id}
                    className="rl-item-row"
                    onClick={() => handleOpenItem(item.url)}
                    title={item.url}
                  >
                    {item.favicon ? (
                      <img src={item.favicon} alt="" className="rl-item-favicon" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="rl-item-favicon-placeholder">
                        {item.title ? item.title[0].toUpperCase() : 'W'}
                      </div>
                    )}
                    <div className="rl-item-details">
                      <div className="rl-item-title">{item.title}</div>
                      <div className="rl-item-domain">{item.domain}</div>
                    </div>
                    <div className="rl-item-actions">
                      <button
                        type="button"
                        className="rl-action-icon-btn"
                        onClick={(e) => handleToggleRead(item.id, e)}
                        title="Mark as read"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="rl-action-icon-btn"
                        onClick={(e) => handleDelete(item.id, e)}
                        title="Delete from reading list"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {readItems.length > 0 && (
            <div className="rl-section" style={{ marginTop: '12px' }}>
              <div className="rl-section-header">Pages you've read ({readItems.length})</div>
              <div className="rl-items-list">
                {readItems.map((item) => (
                  <div
                    key={item.id}
                    className="rl-item-row"
                    style={{ opacity: 0.85 }}
                    onClick={() => handleOpenItem(item.url)}
                    title={item.url}
                  >
                    {item.favicon ? (
                      <img src={item.favicon} alt="" className="rl-item-favicon" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="rl-item-favicon-placeholder">
                        {item.title ? item.title[0].toUpperCase() : 'W'}
                      </div>
                    )}
                    <div className="rl-item-details">
                      <div className="rl-item-title">{item.title}</div>
                      <div className="rl-item-domain">{item.domain}</div>
                    </div>
                    <div className="rl-item-actions">
                      <button
                        type="button"
                        className="rl-action-icon-btn checked"
                        onClick={(e) => handleToggleRead(item.id, e)}
                        title="Mark as unread"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="rl-action-icon-btn"
                        onClick={(e) => handleDelete(item.id, e)}
                        title="Delete from reading list"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
