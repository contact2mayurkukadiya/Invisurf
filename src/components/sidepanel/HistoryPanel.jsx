import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addTab } from '../../store/browserSlice';

export default function HistoryPanel() {
  const dispatch = useDispatch();
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const [query, setQuery] = useState('');
  const [historyItems, setHistoryItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const fetchHistory = useCallback(async (searchQuery = '') => {
    if (!window.electronAPI?.historySearch) return;
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const results = await window.electronAPI.historySearch({ query: searchQuery, limit: 100 });
      if (reqId !== requestIdRef.current) return;
      const items = Array.isArray(results)
        ? results
        : Array.isArray(results?.items)
        ? results.items
        : [];
      setHistoryItems(items);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      console.error('[HistoryPanel] Search failed:', err);
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      fetchHistory('');
      return undefined;
    }
    const timer = setTimeout(() => {
      fetchHistory(trimmed);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, fetchHistory]);

  const handleOpenUrl = useCallback(
    (url) => {
      if (!url) return;
      if (currentTabId && window.electronAPI?.navigate) {
        window.electronAPI.navigate(currentTabId, url, { source: 'history' });
      } else if (window.electronAPI?.newTab) {
        const id = 'tab-' + Date.now();
        dispatch(addTab({ id, isStealth: false, initialUrl: url }));
        window.electronAPI.newTab(id, false, url);
      }
    },
    [currentTabId, dispatch]
  );

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  };

  return (
    <div className="history-panel">
      <div className="sp-search-bar-wrap">
        <input
          type="text"
          className="sp-search-input"
          placeholder="Search history"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="hist-list">
        {isLoading && historyItems.length === 0 ? (
          <div className="sp-empty-state">
            <div>Loading history...</div>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="sp-empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <div>{query.trim() ? 'No matching history found' : 'No browsing history yet'}</div>
          </div>
        ) : (
          historyItems.map((item, idx) => (
            <div
              key={item.visitId ?? item.id ?? `${item.url}-${item.visitTime || idx}-${idx}`}
              className="hist-row"
              onClick={() => handleOpenUrl(item.url)}
              title={item.url}
            >
              <span className="hist-time">{formatTime(item.lastVisitTime || item.visitTime || item.timestamp)}</span>
              <span className="bm-item-title">{item.title || item.url}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
