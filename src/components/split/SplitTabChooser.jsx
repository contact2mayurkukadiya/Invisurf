import React from 'react';
import { useSelector } from 'react-redux';
import { tabCloseSvg } from '../../constants/appAssetUrls';
import './SplitTabChooser.css';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

function extractDomain(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).hostname || url;
    }
    return url;
  } catch {
    return url;
  }
}

export default function SplitTabChooser({ splitPair, style }) {
  const tabOrder = useSelector((s) => s.browser.tabOrder);
  const tabs = useSelector((s) => s.browser.tabs);

  if (!splitPair) return null;

  // Filter out companion tabs and tabs that belong to any other active split
  const candidateTabIds = tabOrder.filter((id) => {
    if (id === splitPair.leftTabId || (splitPair.rightTabId && id === splitPair.rightTabId)) return false;
    const t = tabs[id];
    if (!t) return false;
    if (t.splitPairId && t.splitPairId !== splitPair.id) return false;
    return true;
  });

  const handleSelectTab = (selectedId) => {
    if (window.electronAPI?.splitTabSelectTab) {
      window.electronAPI.splitTabSelectTab(splitPair.id, selectedId);
    }
  };

  const handleCloseChooser = (e) => {
    e.stopPropagation();
    if (window.electronAPI?.splitTabExit) {
      window.electronAPI.splitTabExit(splitPair.id);
    }
  };

  return (
    <div className="split-tab-chooser" style={style}>
      {/* Top right close button to cancel split mode */}
      <button
        type="button"
        className="split-chooser-cancel-btn"
        onClick={handleCloseChooser}
        title="Cancel split view"
        aria-label="Cancel split view"
      >
        <img src={tabCloseSvg} width={14} height={14} alt="" />
      </button>

      {/* Floating interactive tab picker card centered in the pane */}
      <div className="split-chooser-card">
        <div className="split-chooser-list">
          {candidateTabIds.map((tabId) => {
            const tab = tabs[tabId];
            const title = tab?.title || 'New Tab';
            const domain = extractDomain(tab?.url);
            const favicon = tab?.favicon || DEFAULT_FAVICON;

            return (
              <div
                key={tabId}
                className="split-chooser-row"
                data-tab-id={tabId}
                onClick={() => handleSelectTab(tabId)}
                title={`Open ${title} in split view`}
              >
                <div className="split-chooser-icon-container">
                  <img
                    src={favicon}
                    className="split-chooser-icon"
                    alt=""
                    onError={(e) => { e.target.src = DEFAULT_FAVICON; }}
                  />
                </div>
                <div className="split-chooser-text-col">
                  <div className="split-chooser-title">{title}</div>
                  {domain ? <div className="split-chooser-domain">{domain}</div> : null}
                </div>
              </div>
            );
          })}

          {/* Option to open a fresh new tab in the split view */}
          <div
            className="split-chooser-row split-chooser-row--new-tab"
            data-action="new-tab"
            onClick={() => handleSelectTab('new-tab')}
            title="Open a blank new tab in split view"
          >
            <div className="split-chooser-icon-container split-chooser-icon-container--new">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
              </svg>
            </div>
            <div className="split-chooser-text-col">
              <div className="split-chooser-title">New tab</div>
              <div className="split-chooser-domain">Open a blank page</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
