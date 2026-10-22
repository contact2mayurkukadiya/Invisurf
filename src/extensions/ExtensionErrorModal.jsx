import React, { useState, useEffect, useCallback } from 'react';

export default function ExtensionErrorModal({ extension, onClose, onErrorsCleared }) {
  const [errors, setErrors] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [codeSnippet, setCodeSnippet] = useState(null);
  const [loadingSnippet, setLoadingSnippet] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchErrors = useCallback(async () => {
    if (!extension?.id || !window.extensionAPI?.getErrors) return;
    try {
      setLoading(true);
      const list = await window.extensionAPI.getErrors(extension.id);
      setErrors(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load extension errors:', err);
    } finally {
      setLoading(false);
    }
  }, [extension?.id]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const activeError = errors[selectedIndex] || null;

  // Fetch code snippet whenever the selected error changes
  useEffect(() => {
    let isCancelled = false;
    async function loadSnippet() {
      if (!extension?.id || !activeError?.source || !activeError?.lineno || !window.extensionAPI?.getCodeSnippet) {
        setCodeSnippet(null);
        return;
      }
      try {
        setLoadingSnippet(true);
        const res = await window.extensionAPI.getCodeSnippet(
          extension.id,
          activeError.source,
          activeError.lineno
        );
        if (!isCancelled) {
          setCodeSnippet(res);
        }
      } catch {
        if (!isCancelled) setCodeSnippet(null);
      } finally {
        if (!isCancelled) setLoadingSnippet(false);
      }
    }

    loadSnippet();
    return () => {
      isCancelled = true;
    };
  }, [extension?.id, activeError]);

  const handleClearAll = async () => {
    if (!extension?.id || !window.extensionAPI?.clearErrors) return;
    try {
      await window.extensionAPI.clearErrors(extension.id);
      setErrors([]);
      setCodeSnippet(null);
      if (typeof onErrorsCleared === 'function') onErrorsCleared();
    } catch (err) {
      console.error('Failed to clear errors:', err);
    }
  };

  const handleClearSingle = async (errorId) => {
    if (!extension?.id || !errorId || !window.extensionAPI?.clearError) return;
    try {
      await window.extensionAPI.clearError(extension.id, errorId);
      const remaining = errors.filter((e) => e.id !== errorId);
      setErrors(remaining);
      if (selectedIndex >= remaining.length) {
        setSelectedIndex(Math.max(0, remaining.length - 1));
      }
      if (remaining.length === 0 && typeof onErrorsCleared === 'function') {
        onErrorsCleared();
      }
    } catch (err) {
      console.error('Failed to clear error:', err);
    }
  };

  const formatContext = (ctx) => {
    switch (ctx) {
      case 'service_worker':
        return 'Service Worker';
      case 'popup':
        return 'Popup';
      case 'options':
        return 'Options Page';
      case 'content_script':
        return 'Content Script';
      case 'system':
        return 'System / Manifest';
      default:
        return 'Runtime';
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return '';
    }
  };

  return (
    <div className="extension-modal-overlay" onClick={onClose}>
      <div className="extension-modal extension-error-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="extension-modal__header extension-error-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {extension.iconDataUrl ? (
              <img
                src={extension.iconDataUrl}
                alt={extension.name}
                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
              />
            ) : (
              <span>🧩</span>
            )}
            <div>
              <span style={{ fontSize: '15px', fontWeight: '600' }}>
                {extension.name}
              </span>
              <span style={{ color: 'var(--chrome-secondary-fg)', marginLeft: '8px', fontSize: '13px' }}>
                — Errors
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {errors.length > 0 && (
              <button
                type="button"
                className="extension-btn-danger"
                style={{ padding: '5px 12px', fontSize: '12px' }}
                onClick={handleClearAll}
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              className="extensions-header__search-clear"
              onClick={onClose}
              title="Close modal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="extension-modal__body extension-error-modal__body">
          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--chrome-secondary-fg)' }}>
              Loading error log...
            </div>
          ) : errors.length === 0 ? (
            <div style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>✅</div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--chrome-fg)' }}>
                No errors recorded
              </div>
              <div style={{ fontSize: '13px', color: 'var(--chrome-secondary-fg)', marginTop: '4px' }}>
                This extension is running cleanly with no unhandled exceptions.
              </div>
            </div>
          ) : (
            <>
              {/* Error Pagination / Navigation if multiple errors */}
              {errors.length > 1 && (
                <div className="extension-error-nav">
                  <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--chrome-fg)' }}>
                    Error {selectedIndex + 1} of {errors.length}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="extension-btn-secondary"
                      style={{ padding: '3px 10px', fontSize: '11px' }}
                      disabled={selectedIndex === 0}
                      onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                    >
                      ◀ Previous
                    </button>
                    <button
                      type="button"
                      className="extension-btn-secondary"
                      style={{ padding: '3px 10px', fontSize: '11px' }}
                      disabled={selectedIndex === errors.length - 1}
                      onClick={() => setSelectedIndex((i) => Math.min(errors.length - 1, i + 1))}
                    >
                      Next ▶
                    </button>
                  </div>
                </div>
              )}

              {/* Error Detail Card */}
              {activeError && (
                <div className="extension-error-card">
                  {/* Meta Badges */}
                  <div className="extension-error-badges">
                    <span className="extension-error-badge extension-error-badge--type">
                      {activeError.type === 'manifest' ? 'Manifest Warning' : 'Uncaught Error'}
                    </span>
                    <span className="extension-error-badge extension-error-badge--context">
                      {formatContext(activeError.context)}
                    </span>
                    {activeError.count > 1 && (
                      <span className="extension-error-badge extension-error-badge--count">
                        Occurred {activeError.count} times
                      </span>
                    )}
                    <span className="extension-error-badge extension-error-badge--time">
                      {formatTime(activeError.lastSeen)}
                    </span>
                  </div>

                  {/* Error Message */}
                  <div className="extension-error-message-box">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#d93025"
                      strokeWidth="2.5"
                      style={{ flexShrink: 0, marginTop: '2px' }}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div className="extension-error-message-text">
                      {activeError.message}
                    </div>
                  </div>

                  {/* File Location */}
                  {activeError.source && (
                    <div className="extension-error-location">
                      <span className="extension-error-location__label">Source:</span>
                      <code className="extension-error-location__path">
                        {activeError.source}
                        {activeError.lineno > 0 && `:${activeError.lineno}`}
                        {activeError.colno > 0 && `:${activeError.colno}`}
                      </code>
                    </div>
                  )}

                  {/* Code Frame Snippet */}
                  {loadingSnippet ? (
                    <div style={{ padding: '8px', fontSize: '12px', color: 'var(--chrome-secondary-fg)' }}>
                      Loading code snippet...
                    </div>
                  ) : codeSnippet?.lines && codeSnippet.lines.length > 0 ? (
                    <div className="extension-code-frame">
                      <div className="extension-code-frame__header">
                        <span>Code Preview</span>
                        <span>Line {activeError.lineno}</span>
                      </div>
                      <div className="extension-code-frame__body">
                        {codeSnippet.lines.map((ln) => (
                          <div
                            key={ln.lineNum}
                            className={`extension-code-frame__line ${ln.isTarget ? 'extension-code-frame__line--target' : ''}`}
                          >
                            <span className="extension-code-frame__gutter">
                              {ln.isTarget ? '>' : ' '}
                            </span>
                            <span className="extension-code-frame__lineno">
                              {ln.lineNum}
                            </span>
                            <span className="extension-code-frame__content">
                              {ln.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Stack Trace */}
                  {activeError.stack ? (
                    <details className="extension-error-stack-details" open>
                      <summary className="extension-error-stack-summary">
                        Stack Trace
                      </summary>
                      <pre className="extension-error-stack-content">
                        {activeError.stack}
                      </pre>
                    </details>
                  ) : null}

                  {/* Dismiss Single Error */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
                    <button
                      type="button"
                      className="extension-btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                      onClick={() => handleClearSingle(activeError.id)}
                    >
                      Dismiss this error
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
