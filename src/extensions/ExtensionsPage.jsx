import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './ExtensionsPage.css';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';

export default function ExtensionsPage() {
  useChromeTheme();
  useInvsurfDocumentFavicon();

  const [extensions, setExtensions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeDetailsExt, setActiveDetailsExt] = useState(null);
  const [confirmUninstallExt, setConfirmUninstallExt] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadExtensions = useCallback(async () => {
    try {
      if (window.extensionAPI?.list) {
        const list = await window.extensionAPI.list();
        setExtensions(Array.isArray(list) ? list : []);
      }
    } catch (err) {
      console.error('Failed to load extensions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExtensions();

    if (window.extensionAPI?.onExtensionsUpdated) {
      const unsubscribe = window.extensionAPI.onExtensionsUpdated(() => {
        loadExtensions();
      });
      return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }
  }, [loadExtensions]);

  // Keep details modal in sync with extension updates
  useEffect(() => {
    if (activeDetailsExt) {
      const current = extensions.find((e) => e.id === activeDetailsExt.id);
      if (current) {
        setActiveDetailsExt(current);
      }
    }
  }, [extensions, activeDetailsExt]);

  const handleToggle = async (extId) => {
    try {
      if (window.extensionAPI?.toggle) {
        await window.extensionAPI.toggle(extId);
        loadExtensions();
      }
    } catch (err) {
      console.error('Failed to toggle extension:', err);
    }
  };

  const executeUninstall = async (extId) => {
    try {
      if (window.extensionAPI?.uninstall) {
        await window.extensionAPI.uninstall(extId);
        if (activeDetailsExt?.id === extId) {
          setActiveDetailsExt(null);
        }
        await loadExtensions();
      }
    } catch (err) {
      console.error('Failed to uninstall extension:', err);
    }
  };

  const handleUninstall = (extId, extName) => {
    setConfirmUninstallExt({ id: extId, name: extName });
  };

  const handleTogglePin = async (extId) => {
    try {
      if (window.extensionAPI?.togglePin) {
        await window.extensionAPI.togglePin(extId);
        loadExtensions();
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleLoadUnpacked = async () => {
    try {
      if (window.extensionAPI?.loadUnpacked) {
        const res = await window.extensionAPI.loadUnpacked();
        if (res?.success) {
          await loadExtensions();
        } else if (res?.error) {
          alert(`Failed to load extension: ${res.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to load unpacked extension:', err);
      alert(`Error loading extension: ${err?.message || err}`);
    }
  };

  const handleReload = async (extId) => {
    try {
      if (window.extensionAPI?.reload) {
        await window.extensionAPI.reload(extId);
        await loadExtensions();
      }
    } catch (err) {
      console.error('Failed to reload extension:', err);
    }
  };

  const openWebStore = () => {
    window.location.href = 'https://chromewebstore.google.com';
  };

  const copyToClipboard = (text) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const filteredExtensions = useMemo(() => {
    if (!searchQuery.trim()) return extensions;
    const q = searchQuery.toLowerCase();
    return extensions.filter(
      (e) => (e.name || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q)
    );
  }, [extensions, searchQuery]);

  return (
    <div className="extensions-page">
      {/* ── Top Header ────────────────────────────────────────── */}
      <header className="extensions-header">
        <div className="extensions-header__left">
          <button
            type="button"
            className="extensions-header__menu-btn"
            title="Main menu"
            aria-label="Main menu"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="extensions-header__title">
            <span className="extensions-header__title-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.5 2.5 0 0 1 0 5H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.5 2.5 0 0 1 5 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" />
              </svg>
            </span>
            <span>Extensions</span>
          </div>
        </div>

        {/* Center Search Bar */}
        <div className="extensions-header__search-container">
          <div className="extensions-header__search-box">
            <span className="extensions-header__search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              className="extensions-header__search-input"
              placeholder="Search extensions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="extensions-header__search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Right Developer Mode Toggle */}
        <div className="extensions-header__right">
          <label className="extensions-header__devmode">
            <span>Developer mode</span>
            <span className="chrome-switch">
              <input
                type="checkbox"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
              />
              <span className="chrome-switch__slider" />
            </span>
          </label>
        </div>
      </header>

      {/* ── Developer Mode Toolbar ────────────────────────────── */}
      {devMode && (
        <div className="extensions-dev-toolbar">
          <button
            type="button"
            className="extensions-dev-btn"
            onClick={handleLoadUnpacked}
          >
            Load unpacked
          </button>
          <button
            type="button"
            className="extensions-dev-btn"
            onClick={() => alert('Pack extension will generate a signed .crx bundle.')}
          >
            Pack extension
          </button>
          <button
            type="button"
            className="extensions-dev-btn"
            onClick={() => {
              loadExtensions();
            }}
          >
            Update
          </button>
        </div>
      )}

      {/* ── Body (Sidebar + Main Content) ──────────────────────── */}
      <div className="extensions-body">
        {/* Left Drawer */}
        <aside className={`extensions-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <nav className="extensions-sidebar__nav">
            <button type="button" className="extensions-sidebar__item active">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.5 2.5 0 0 1 0 5H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.5 2.5 0 0 1 5 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" />
              </svg>
              <span>My extensions</span>
            </button>
            <button
              type="button"
              className="extensions-sidebar__item"
              onClick={() => alert('Keyboard shortcuts manager')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="6" y1="8" x2="6" y2="8" />
                <line x1="10" y1="8" x2="10" y2="8" />
                <line x1="14" y1="8" x2="14" y2="8" />
                <line x1="18" y1="8" x2="18" y2="8" />
                <line x1="6" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="18" y2="12" />
                <line x1="8" y1="16" x2="16" y2="16" />
              </svg>
              <span>Keyboard shortcuts</span>
            </button>
          </nav>

          <div className="extensions-sidebar__footer">
            <button
              type="button"
              className="extensions-sidebar__store-link"
              onClick={openWebStore}
            >
              <span>Open Chrome Web Store</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
        </aside>

        {/* Main Area */}
        <main className="extensions-main">
          <div className="extensions-main-container">
            <h2 className="extensions-section-title">
              {searchQuery ? `Search results (${filteredExtensions.length})` : 'All extensions'}
            </h2>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--chrome-secondary-fg)' }}>
              Loading extensions...
            </div>
          ) : filteredExtensions.length === 0 ? (
            <div className="extensions-empty">
              <div style={{ fontSize: '36px' }}>🧩</div>
              <div style={{ fontSize: '16px', fontWeight: '600' }}>
                {searchQuery ? 'No matching extensions found' : 'No extensions installed'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--chrome-secondary-fg)', maxWidth: '420px' }}>
                {searchQuery
                  ? `No extensions match "${searchQuery}". Check spelling or try a different term.`
                  : 'Add extensions from the Chrome Web Store to customize and enhance your InviSurf browsing experience.'}
              </div>
              {!searchQuery && (
                <button
                  type="button"
                  className="extension-btn-secondary"
                  onClick={openWebStore}
                  style={{ marginTop: '12px', padding: '8px 18px', fontSize: '13px' }}
                >
                  Browse Chrome Web Store
                </button>
              )}
            </div>
          ) : (
            <div className="extensions-grid">
              {filteredExtensions.map((ext) => (
                <div key={ext.id} className="extension-card">
                  <div className="extension-card__top">
                    {/* Icon */}
                    <div className="extension-card__icon-box">
                      {ext.iconDataUrl ? (
                        <img src={ext.iconDataUrl} alt={ext.name} className="extension-card__icon-img" />
                      ) : (
                        <span style={{ fontSize: '20px' }}>🧩</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="extension-card__content">
                      <div className="extension-card__header-line">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="extension-card__name" title={ext.name}>
                            {ext.name}
                          </div>
                          <div className="extension-card__version">
                            {ext.version}
                            {ext.isUnpacked && (
                              <span style={{
                                marginLeft: '8px',
                                fontSize: '11px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(26, 115, 232, 0.1)',
                                color: 'var(--chrome-accent, #1a73e8)',
                                border: '1px solid rgba(26, 115, 232, 0.3)'
                              }}>
                                Unpacked
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Switch */}
                        <label className="chrome-switch" title={ext.enabled ? 'Enabled' : 'Disabled'}>
                          <input
                            type="checkbox"
                            checked={!!ext.enabled}
                            onChange={() => handleToggle(ext.id)}
                          />
                          <span className="chrome-switch__slider" />
                        </label>
                      </div>

                      <div className="extension-card__description" title={ext.description}>
                        {ext.description || 'No description provided.'}
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom Actions */}
                  <div className="extension-card__bottom">
                    <div className="extension-card__actions">
                      <button
                        type="button"
                        className="extension-btn-secondary"
                        onClick={() => setActiveDetailsExt(ext)}
                      >
                        Details
                      </button>
                      {(ext.hasOptionsPage || ext.optionsPage) && (
                        <button
                          type="button"
                          className="extension-btn-secondary"
                          onClick={() => window.extensionAPI?.openOptionsPage(ext.id)}
                          title="Open extension options page"
                        >
                          Options
                        </button>
                      )}
                      {(devMode || ext.isUnpacked) && (
                        <button
                          type="button"
                          className="extension-btn-secondary"
                          onClick={() => handleReload(ext.id)}
                          title="Reload extension from disk"
                        >
                          Reload
                        </button>
                      )}
                      <button
                        type="button"
                        className="extension-btn-danger"
                        onClick={() => handleUninstall(ext.id, ext.name)}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Pin button badge */}
                    <button
                      type="button"
                      title={ext.pinned ? 'Pinned to toolbar' : 'Pin to toolbar'}
                      onClick={() => handleTogglePin(ext.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        color: ext.pinned ? 'var(--chrome-accent, #1a73e8)' : 'var(--chrome-secondary-fg, #5f6368)',
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill={ext.pinned ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="12" y1="17" x2="12" y2="22" />
                        <path d="M5 17h14v-2l-2-3V6a1 1 0 0 0-1-1h-1V3a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v2H9a1 1 0 0 0-1 1v6l-2 3v2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </main>
      </div>

      {/* ── Details Modal ─────────────────────────────────────── */}
      {activeDetailsExt && (
        <div className="extension-modal-overlay" onClick={() => setActiveDetailsExt(null)}>
          <div className="extension-modal" onClick={(e) => e.stopPropagation()}>
            <div className="extension-modal__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {activeDetailsExt.iconDataUrl ? (
                  <img
                    src={activeDetailsExt.iconDataUrl}
                    alt={activeDetailsExt.name}
                    style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                  />
                ) : (
                  <span>🧩</span>
                )}
                <span style={{ fontSize: '15px', fontWeight: '600' }}>
                  {activeDetailsExt.name}
                </span>
              </div>
              <button
                type="button"
                className="extensions-header__search-clear"
                onClick={() => setActiveDetailsExt(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="extension-modal__body">
              {/* Description */}
              <div className="extension-modal__row">
                <span className="extension-modal__label">Description</span>
                <span className="extension-modal__value">
                  {activeDetailsExt.description || 'No description provided.'}
                </span>
              </div>

              {/* Version & State */}
              <div style={{ display: 'flex', gap: '32px' }}>
                <div className="extension-modal__row">
                  <span className="extension-modal__label">Version</span>
                  <span className="extension-modal__value">{activeDetailsExt.version}</span>
                </div>
                <div className="extension-modal__row">
                  <span className="extension-modal__label">Status</span>
                  <span
                    className="extension-modal__value"
                    style={{ color: activeDetailsExt.enabled ? '#10b981' : 'var(--chrome-secondary-fg)' }}
                  >
                    {activeDetailsExt.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="extension-modal__row">
                  <span className="extension-modal__label">Toolbar Pin</span>
                  <span className="extension-modal__value">
                    {activeDetailsExt.pinned ? 'Pinned (Top 5)' : 'Unpinned'}
                  </span>
                </div>
              </div>

              {/* ID */}
              <div className="extension-modal__row">
                <span className="extension-modal__label">ID</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      backgroundColor: 'var(--chrome-url-well, #f1f3f4)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    {activeDetailsExt.id}
                  </code>
                  <button
                    type="button"
                    className="extension-btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => copyToClipboard(activeDetailsExt.id)}
                  >
                    {copiedId ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Path / Loaded from */}
              {activeDetailsExt.path && (
                <div className="extension-modal__row">
                  <span className="extension-modal__label">Loaded from</span>
                  <span className="extension-modal__value" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '12px' }}>
                    {activeDetailsExt.path}
                  </span>
                </div>
              )}

              {/* Permissions */}
              <div className="extension-modal__row">
                <span className="extension-modal__label">Permissions</span>
                {Array.isArray(activeDetailsExt.permissions?.warnings) &&
                activeDetailsExt.permissions.warnings.length > 0 ? (
                  <ul
                    style={{
                      margin: '4px 0 0',
                      paddingLeft: '18px',
                      fontSize: '13px',
                      color: 'var(--chrome-fg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    {activeDetailsExt.permissions.warnings.map((w, idx) => (
                      <li key={idx}>{typeof w === 'string' ? w : (w?.description || w?.title || w?.permission || String(w))}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="extension-modal__value" style={{ color: 'var(--chrome-secondary-fg)' }}>
                    No special permissions required
                  </span>
                )}
              </div>

              {/* Site access */}
              <div className="extension-modal__row">
                <span className="extension-modal__label">Site access</span>
                <span className="extension-modal__value">
                  {Array.isArray(activeDetailsExt.allowedOrigins) && activeDetailsExt.allowedOrigins.length > 0 ? (
                    activeDetailsExt.allowedOrigins.join(', ')
                  ) : (
                    'On click (prompts permission on active tab)'
                  )}
                </span>
              </div>

              {/* Extension options */}
              {(activeDetailsExt.hasOptionsPage || activeDetailsExt.optionsPage) && (
                <div className="extension-modal__row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                  <div>
                    <span className="extension-modal__label" style={{ fontWeight: '500' }}>Extension options</span>
                    <span className="extension-modal__value" style={{ display: 'block', color: 'var(--chrome-secondary-fg)', fontSize: '12px', marginTop: '2px' }}>
                      Configure extension settings and preferences
                    </span>
                  </div>
                  <button
                    type="button"
                    className="extension-btn-secondary"
                    onClick={() => window.extensionAPI?.openOptionsPage(activeDetailsExt.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                  >
                    <span>Open options</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <div className="extension-modal__footer">
              <button
                type="button"
                className="extension-btn-danger"
                onClick={() => handleUninstall(activeDetailsExt.id, activeDetailsExt.name)}
              >
                Remove extension
              </button>
              <button
                type="button"
                className="extension-btn-secondary"
                onClick={() => setActiveDetailsExt(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Uninstall Confirmation Modal ──────────────────────── */}
      {confirmUninstallExt && (
        <div className="extension-modal-overlay" onClick={() => setConfirmUninstallExt(null)}>
          <div className="extension-modal" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="extension-modal__header">
              <span style={{ fontSize: '15px', fontWeight: '600' }}>
                Remove "{confirmUninstallExt.name}"?
              </span>
              <button
                type="button"
                className="extensions-header__search-clear"
                onClick={() => setConfirmUninstallExt(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="extension-modal__body" style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--chrome-secondary-fg)', lineHeight: '1.5' }}>
              This will remove the extension and all of its associated data from InviSurf.
            </div>
            <div className="extension-modal__footer">
              <button
                type="button"
                className="extension-btn-danger"
                onClick={async () => {
                  const targetId = confirmUninstallExt.id;
                  setConfirmUninstallExt(null);
                  await executeUninstall(targetId);
                }}
              >
                Remove
              </button>
              <button
                type="button"
                className="extension-btn-secondary"
                onClick={() => setConfirmUninstallExt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
