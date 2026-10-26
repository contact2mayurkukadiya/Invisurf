import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setBookmarks } from '../../store/bookmarksSlice';
import { addTab } from '../../store/browserSlice';

function flattenBookmarks(items, out = []) {
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (item.type === 'bookmark') {
      out.push(item);
    } else if (item.type === 'folder' && Array.isArray(item.children)) {
      flattenBookmarks(item.children, out);
    }
  }
  return out;
}

export default function BookmarksPanel() {
  const dispatch = useDispatch();
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const bookmarkBar = useSelector((s) => s.bookmarks?.data?.bar || s.bookmarks?.bar || []);
  const [searchQuery, setSearchQuery] = useState('');
  const fetchedRef = useRef(false);

  // Fetch bookmarks from disk if not yet populated in store
  useEffect(() => {
    if (!fetchedRef.current && (!bookmarkBar || bookmarkBar.length === 0) && window.electronAPI?.bookmarksGet) {
      fetchedRef.current = true;
      window.electronAPI
        .bookmarksGet()
        .then((res) => {
          if (res) dispatch(setBookmarks(res));
        })
        .catch((err) => console.error('[BookmarksPanel] bookmarksGet error:', err));
    }
  }, [bookmarkBar, dispatch]);

  const allBookmarks = useMemo(() => flattenBookmarks(bookmarkBar), [bookmarkBar]);

  const filteredBookmarks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return allBookmarks.filter(
      (b) =>
        (b.title && b.title.toLowerCase().includes(q)) ||
        (b.url && b.url.toLowerCase().includes(q))
    );
  }, [allBookmarks, searchQuery]);

  const handleOpenBookmark = useCallback(
    (url) => {
      if (!url) return;
      if (currentTabId && window.electronAPI?.navigate) {
        window.electronAPI.navigate(currentTabId, url, { source: 'bookmark' });
      } else if (window.electronAPI?.newTab) {
        const id = 'tab-' + Date.now();
        dispatch(addTab({ id, isStealth: false, initialUrl: url }));
        window.electronAPI.newTab(id, false, url);
      }
    },
    [currentTabId, dispatch]
  );

  const renderItem = (item) => {
    if (item.type === 'folder') {
      return (
        <div key={item.id} className="bm-folder-section">
          <div className="bm-item-row bm-folder-header">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8, color: '#fbbc04' }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span className="bm-item-title">{item.title}</span>
          </div>
          {Array.isArray(item.children) && item.children.length > 0 && (
            <div style={{ paddingLeft: '16px' }}>
              {item.children.map(renderItem)}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className="bm-item-row"
        onClick={() => handleOpenBookmark(item.url)}
        title={item.url}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ color: '#4285f4', opacity: 0.9, flexShrink: 0 }}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <span className="bm-item-title">{item.title || item.url}</span>
      </div>
    );
  };

  return (
    <div className="bookmarks-panel">
      <div className="sp-search-bar-wrap">
        <input
          type="text"
          className="sp-search-input"
          placeholder="Search bookmarks"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="bm-tree-list">
        {filteredBookmarks !== null ? (
          filteredBookmarks.length === 0 ? (
            <div className="sp-empty-state">
              <div>No bookmarks match "{searchQuery}"</div>
            </div>
          ) : (
            filteredBookmarks.map((item) => renderItem(item))
          )
        ) : bookmarkBar.length === 0 ? (
          <div className="sp-empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <div>No bookmarks yet</div>
            <div style={{ fontSize: '11px', opacity: 0.7 }}>Bookmark pages using the star icon in the toolbar.</div>
          </div>
        ) : (
          bookmarkBar.map(renderItem)
        )}
      </div>
    </div>
  );
}
