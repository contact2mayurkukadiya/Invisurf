import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './DownloadsApp.css';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import { logoPurpleLightSvg } from '../constants/appAssetUrls.js';

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(num) / Math.log(1024)), units.length - 1);
  const val = num / Math.pow(1024, i);
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
  const speed = Number(bytesPerSec);
  if (!Number.isFinite(speed) || speed <= 0) return '';
  return `${formatBytes(speed)}/s`;
}

function formatGroupDate(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - target.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function cleanDisplayUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin + (parsed.pathname.length > 30 ? parsed.pathname.slice(0, 30) + '…' : parsed.pathname);
  } catch {
    return rawUrl.length > 45 ? rawUrl.slice(0, 45) + '…' : rawUrl;
  }
}

function deduplicateById(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const res = [];
  for (const item of list) {
    if (!item || !item.id) continue;
    if (!seen.has(item.id)) {
      seen.add(item.id);
      res.push(item);
    }
  }
  return res;
}

export default function DownloadsApp() {
  useChromeTheme();
  useInvsurfDocumentFavicon();

  const [activeDownloads, setActiveDownloads] = useState([]);
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  const isMac = useMemo(() => {
    return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  }, []);

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await window.electronAPI?.downloadsGetAll?.();
      if (data) {
        const rawActive = Array.isArray(data.active) ? data.active : [];
        const activeList = deduplicateById(rawActive);
        const activeIdSet = new Set(activeList.map((a) => a.id));
        const rawHistory = Array.isArray(data.history) ? data.history : [];
        const historyList = deduplicateById(rawHistory).filter((h) => !activeIdSet.has(h.id));

        setActiveDownloads(activeList);
        setDownloadHistory(historyList);
      }
    } catch (e) {
      console.error('Failed to get downloads:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDownloads();

    const unsubStarted = window.electronAPI?.onDownloadStarted?.((record) => {
      if (!record || !record.id) return;
      setActiveDownloads((prev) => {
        const filtered = prev.filter((d) => d.id !== record.id);
        return [record, ...filtered];
      });
      setDownloadHistory((prev) => prev.filter((d) => d.id !== record.id));
    });

    const unsubProgress = window.electronAPI?.onDownloadProgress?.((record) => {
      if (!record || !record.id) return;
      setActiveDownloads((prev) =>
        prev.map((d) => (d.id === record.id ? { ...d, ...record } : d))
      );
    });

    const unsubDone = window.electronAPI?.onDownloadDone?.((record) => {
      if (!record || !record.id) return;
      setActiveDownloads((prev) => prev.filter((d) => d.id !== record.id));
      setDownloadHistory((prev) => {
        const filtered = prev.filter((d) => d.id !== record.id);
        return [{ ...record, fileExists: true }, ...filtered];
      });
    });

    const unsubUpdated = window.electronAPI?.onDownloadUpdated?.(() => {
      fetchDownloads();
    });

    return () => {
      if (typeof unsubStarted === 'function') unsubStarted();
      if (typeof unsubProgress === 'function') unsubProgress();
      if (typeof unsubDone === 'function') unsubDone();
      if (typeof unsubUpdated === 'function') unsubUpdated();
    };
  }, [fetchDownloads]);

  const handleCancel = useCallback(async (id) => {
    try {
      setActiveDownloads((prev) => prev.filter((d) => d.id !== id));
      await window.electronAPI?.downloadsCancel?.(id);
    } catch (e) {
      console.error('Failed to cancel download:', e);
    }
  }, []);

  const handlePause = useCallback(async (id) => {
    try {
      await window.electronAPI?.downloadsPause?.(id);
    } catch (e) {
      console.error('Failed to pause download:', e);
    }
  }, []);

  const handleResume = useCallback(async (id) => {
    try {
      await window.electronAPI?.downloadsResume?.(id);
    } catch (e) {
      console.error('Failed to resume download:', e);
    }
  }, []);

  const handleRetry = useCallback(async (id) => {
    try {
      setDownloadHistory((prev) => prev.filter((d) => d.id !== id));
      await window.electronAPI?.downloadsRetry?.(id);
    } catch (e) {
      console.error('Failed to retry download:', e);
    }
  }, []);

  const handleShowInFolder = useCallback(async (savePath) => {
    try {
      await window.electronAPI?.downloadsShowInFolder?.(savePath);
    } catch (e) {
      console.error('Failed to show in folder:', e);
    }
  }, []);

  const handleOpenFile = useCallback(async (savePath) => {
    try {
      await window.electronAPI?.downloadsOpenFile?.(savePath);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }, []);

  const handleRemove = useCallback(async (id) => {
    try {
      await window.electronAPI?.downloadsRemove?.(id);
      setDownloadHistory((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      console.error('Failed to remove download:', e);
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    try {
      await window.electronAPI?.downloadsClearAll?.();
      setDownloadHistory([]);
    } catch (e) {
      console.error('Failed to clear download history:', e);
    }
  }, []);

  const handleCopyLink = useCallback((id, url) => {
    if (!url) return;
    try {
      navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (_) {}
  }, []);

  // Filter items by search term
  const query = searchTerm.trim().toLowerCase();
  const filteredActive = useMemo(() => {
    if (!query) return activeDownloads;
    return activeDownloads.filter(
      (d) =>
        d.filename?.toLowerCase().includes(query) ||
        d.url?.toLowerCase().includes(query)
    );
  }, [activeDownloads, query]);

  const activeIdSet = useMemo(() => new Set(activeDownloads.map((d) => d.id)), [activeDownloads]);

  const filteredHistory = useMemo(() => {
    const list = downloadHistory.filter((d) => !activeIdSet.has(d.id));
    if (!query) return list;
    return list.filter(
      (d) =>
        d.filename?.toLowerCase().includes(query) ||
        d.url?.toLowerCase().includes(query)
    );
  }, [downloadHistory, activeIdSet, query]);

  // Group all downloads by date (active downloads grouped under Today)
  const groupedSections = useMemo(() => {
    const groups = new Map();

    // Active items go under "Today"
    if (filteredActive.length > 0) {
      groups.set('Today', { active: filteredActive, history: [] });
    }

    // Distribute history items into date groups
    for (const item of filteredHistory) {
      const groupKey = formatGroupDate(item.endTime || item.startTime);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { active: [], history: [] });
      }
      groups.get(groupKey).history.push(item);
    }

    return Array.from(groups.entries()).map(([label, data]) => ({
      label,
      active: data.active,
      history: data.history,
    }));
  }, [filteredActive, filteredHistory]);

  const totalCount = filteredActive.length + filteredHistory.length;
  const folderTooltip = isMac ? 'Show in Finder' : 'Show in folder';

  return (
    <div className="dl-page-container">
      {/* Top Header */}
      <header className="dl-header">
        <div className="dl-header-left">
          <img
            src={logoPurpleLightSvg}
            width={26}
            height={26}
            alt="InviSurf"
            className="dl-invisurf-logo"
          />
          <h1 className="dl-title">Downloads</h1>
        </div>

        <div className="dl-header-center">
          <div className="dl-search-box">
            <svg
              className="dl-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="dl-search-input"
              placeholder="Search download history"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search download history"
            />
            {searchTerm && (
              <button
                type="button"
                className="dl-search-clear-btn"
                onClick={() => setSearchTerm('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="dl-header-right">
          {downloadHistory.length > 0 && (
            <button
              type="button"
              className="dl-clear-all-btn"
              onClick={handleClearAll}
              title="Clear all download records"
              aria-label="Clear all download records"
            >
              Clear all
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="dl-main-content">
        {groupedSections.length > 0 && (
          <div className="dl-sections-container">
            {groupedSections.map((group) => (
              <div key={group.label} className="dl-date-group">
                <h2 className="dl-date-heading">{group.label}</h2>

                <div className="dl-cards-list">
                  {/* Active Downloading Cards */}
                  {group.active.map((item) => {
                    const isPaused = item.state === 'paused';
                    const received = Number(item.receivedBytes) || 0;
                    const total = Number(item.totalBytes) || 0;
                    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : (received > 0 ? 30 : 0);
                    const speed = formatSpeed(item.speedBytesPerSec);
                    const isCopied = copiedId === item.id;

                    return (
                      <div key={item.id} className={`dl-card dl-card--active ${isPaused ? 'is-paused' : ''}`}>
                        {/* File icon */}
                        <div className="dl-card-file-icon">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        </div>

                        {/* Card Info & Progress */}
                        <div className="dl-card-body">
                          <div className="dl-card-top-line">
                            <span className="dl-file-name" title={item.filename}>
                              {item.filename}
                            </span>
                          </div>

                          <div className="dl-card-subline">
                            {isPaused ? (
                              <span className="dl-paused-text">
                                {formatBytes(received)} {total > 0 ? `of ${formatBytes(total)}` : ''} • Paused
                              </span>
                            ) : received === 0 ? (
                              <span>Starting...</span>
                            ) : total > 0 ? (
                              <span>
                                {speed ? `${speed} - ` : ''}{formatBytes(total)}
                              </span>
                            ) : (
                              <span>
                                {speed ? `${speed} - ` : ''}{formatBytes(received)} downloaded
                              </span>
                            )}
                          </div>

                          {/* Linear progress bar */}
                          <div className="dl-progress-track">
                            <div
                              className={`dl-progress-fill ${isPaused ? 'is-paused' : ''}`}
                              style={{ width: `${received === 0 ? 2 : Math.max(2, percent)}%` }}
                            />
                          </div>
                        </div>

                        {/* Right Action Buttons */}
                        <div className="dl-card-actions">
                          {item.url && (
                            <button
                              type="button"
                              className={`dl-icon-btn ${isCopied ? 'is-copied' : ''}`}
                              onClick={() => handleCopyLink(item.id, item.url)}
                              title={isCopied ? 'Link copied!' : 'Copy download link'}
                              aria-label="Copy download link"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                            </button>
                          )}
                          <button
                            type="button"
                            className="dl-icon-btn"
                            onClick={() => (isPaused ? handleResume(item.id) : handlePause(item.id))}
                            title={isPaused ? 'Resume download' : 'Pause download'}
                            aria-label={isPaused ? 'Resume download' : 'Pause download'}
                          >
                            {isPaused ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16"></rect>
                                <rect x="14" y="4" width="4" height="16"></rect>
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            className="dl-icon-btn"
                            onClick={() => handleCancel(item.id)}
                            title="Cancel download"
                            aria-label="Cancel download"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* History Cards */}
                  {group.history.map((item) => {
                    const isCompleted = item.state === 'completed';
                    const isDeleted = isCompleted && item.fileExists === false;
                    const isCancelled = item.state === 'cancelled';
                    const isFailed = item.state === 'failed';
                    const isCopied = copiedId === item.id;
                    const canOpen = isCompleted && !isDeleted && Boolean(item.savePath);

                    return (
                      <div
                        key={item.id}
                        className={`dl-card dl-card--history ${isDeleted ? 'is-deleted' : ''} ${isCancelled ? 'is-cancelled' : ''} ${isFailed ? 'is-failed' : ''}`}
                      >
                        {/* File icon */}
                        <div className="dl-card-file-icon">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        </div>

                        {/* Card Info */}
                        <div className="dl-card-body">
                          <div className="dl-card-top-line">
                            {canOpen ? (
                              <button
                                type="button"
                                className="dl-file-link-btn"
                                onClick={() => handleOpenFile(item.savePath)}
                                title="Click to open file"
                              >
                                {item.filename}
                              </button>
                            ) : (
                              <div className="dl-filename-row">
                                <span className={`dl-file-name ${isDeleted || isCancelled || isFailed ? 'is-strikethrough' : ''}`}>
                                  {item.filename}
                                </span>
                                {isDeleted && <span className="dl-status-badge dl-badge-deleted">Deleted</span>}
                                {isCancelled && <span className="dl-status-badge dl-badge-cancelled">Canceled</span>}
                                {isFailed && <span className="dl-status-badge dl-badge-failed">Failed</span>}
                              </div>
                            )}
                          </div>

                          <div className="dl-card-subline">
                            {item.url ? (
                              <span className="dl-source-url" title={item.url}>
                                From {cleanDisplayUrl(item.url)}
                              </span>
                            ) : (
                              <span>{formatBytes(item.receivedBytes || item.totalBytes)}</span>
                            )}
                          </div>
                        </div>

                        {/* Right Action Buttons */}
                        <div className="dl-card-actions">
                          {item.url && (
                            <button
                              type="button"
                              className={`dl-icon-btn ${isCopied ? 'is-copied' : ''}`}
                              onClick={() => handleCopyLink(item.id, item.url)}
                              title={isCopied ? 'Link copied!' : 'Copy download link'}
                              aria-label="Copy download link"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                            </button>
                          )}

                          {/* Folder icon button: ONLY if completed and file exists on disk */}
                          {canOpen && (
                            <button
                              type="button"
                              className="dl-icon-btn dl-icon-btn--folder"
                              onClick={() => handleShowInFolder(item.savePath)}
                              title={folderTooltip}
                              aria-label={folderTooltip}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                              </svg>
                            </button>
                          )}

                          {/* Retry button: if cancelled or failed */}
                          {(isCancelled || isFailed) && item.url && (
                            <button
                              type="button"
                              className="dl-icon-btn"
                              onClick={() => handleRetry(item.id)}
                              title="Retry download"
                              aria-label="Retry download"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                              </svg>
                            </button>
                          )}

                          {/* Remove button */}
                          <button
                            type="button"
                            className="dl-icon-btn"
                            onClick={() => handleRemove(item.id)}
                            title="Remove from history"
                            aria-label="Remove from history"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && totalCount === 0 && (
          <div className="dl-empty-state">
            <div className="dl-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <h2 className="dl-empty-title">
              {query ? 'No downloads found' : 'No downloads yet'}
            </h2>
            <p className="dl-empty-desc">
              {query
                ? `No downloads match "${searchTerm}".`
                : 'Files you download in InviSurf will appear here.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
