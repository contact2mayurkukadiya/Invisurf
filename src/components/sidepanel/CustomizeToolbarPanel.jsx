import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  setToolbarConfigItem,
  resetToolbarConfig,
  setSidePanelActiveView,
  DEFAULT_TOOLBAR_CONFIG,
} from '../../store/browserSlice';
import './CustomizeToolbarPanel.css';

export default function CustomizeToolbarPanel({ currentProfile }) {
  const dispatch = useDispatch();
  const toolbarConfig = useSelector((s) => s.browser.toolbarConfig || DEFAULT_TOOLBAR_CONFIG);

  const handleToggle = useCallback(
    (key, nextVal) => {
      dispatch(setToolbarConfigItem({ key, value: nextVal }));
      if (window.electronAPI?.profileSetToolbarConfig) {
        window.electronAPI.profileSetToolbarConfig({
          profileId: currentProfile?.profileId,
          toolbarConfig: { [key]: nextVal },
        });
      }
    },
    [dispatch, currentProfile?.profileId]
  );

  const handleReset = useCallback(() => {
    dispatch(resetToolbarConfig());
    if (window.electronAPI?.profileSetToolbarConfig) {
      window.electronAPI.profileSetToolbarConfig({
        profileId: currentProfile?.profileId,
        toolbarConfig: { ...DEFAULT_TOOLBAR_CONFIG },
      });
    }
  }, [dispatch, currentProfile?.profileId]);

  return (
    <div className="customize-toolbar-panel">
      {/* Top Preview Card */}
      <div className="customize-toolbar-preview-card">
        <div className="customize-toolbar-preview-mockup">
          <div className="mockup-window-controls">
            <span className="mockup-control-btn mockup-control--min" title="Minimize">
              <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                <rect y="4.5" width="10" height="1.2" rx="0.6" />
              </svg>
            </span>
            <span className="mockup-control-btn mockup-control--max" title="Maximize">
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="1" width="8" height="8" rx="1" />
              </svg>
            </span>
            <span className="mockup-control-btn mockup-control--close" title="Close">
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
                <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
              </svg>
            </span>
          </div>
          <div className="mockup-navbar">
            <div className="mockup-omnibox">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </div>
            <div className="mockup-nav-icons">
              <span className="mockup-icon-pill" />
              <span className="mockup-icon-pill" />
              <span className="mockup-icon-pill" />
              <span className="mockup-icon-avatar" />
              <span className="mockup-icon-dots" />
            </div>
          </div>
          <div className="mockup-webpage" />
        </div>

        <p className="customize-toolbar-preview-desc">Choose what buttons show in the toolbar</p>

        <button
          type="button"
          className="customize-toolbar-reset-btn"
          onClick={handleReset}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Reset to Default
        </button>
      </div>

      {/* Navigation Section */}
      <div className="customize-toolbar-section">
        <h3 className="customize-toolbar-section-title">Navigation</h3>

        {/* Home */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </span>
            <span className="customize-toolbar-label">Home</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.home}
            className={`toolbar-toggle-switch${toolbarConfig.home ? ' active' : ''}`}
            onClick={() => handleToggle('home', !toolbarConfig.home)}
            title="Toggle Home button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Forward */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </span>
            <span className="customize-toolbar-label">Forward</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.forward}
            className={`toolbar-toggle-switch${toolbarConfig.forward ? ' active' : ''}`}
            onClick={() => handleToggle('forward', !toolbarConfig.forward)}
            title="Toggle Forward button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Open In Split View */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 19H5V5h4v14zm10 0h-4V5h4v14z" />
              </svg>
            </span>
            <span className="customize-toolbar-label">Open In Split View</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.splitView}
            className={`toolbar-toggle-switch${toolbarConfig.splitView ? ' active' : ''}`}
            onClick={() => handleToggle('splitView', !toolbarConfig.splitView)}
            title="Toggle Open in Split View button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* New Incognito window */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 10h20M7 10l2-6h6l2 6" />
                <circle cx="7.5" cy="15.5" r="3.5" />
                <circle cx="16.5" cy="15.5" r="3.5" />
                <path d="M11 15.5h2" />
              </svg>
            </span>
            <span className="customize-toolbar-label">New Incognito window</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.newIncognito}
            className={`toolbar-toggle-switch${toolbarConfig.newIncognito ? ' active' : ''}`}
            onClick={() => handleToggle('newIncognito', !toolbarConfig.newIncognito)}
            title="Toggle New Incognito window button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* New Ghost window */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v11l4-2 4 2 4-2 4 2V10a8 8 0 0 0-8-8z" />
              </svg>
            </span>
            <span className="customize-toolbar-label">New Ghost window</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.newGhost}
            className={`toolbar-toggle-switch${toolbarConfig.newGhost ? ' active' : ''}`}
            onClick={() => handleToggle('newGhost', !toolbarConfig.newGhost)}
            title="Toggle New Ghost window button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>
      </div>

      {/* Your Chrome / Tools Section */}
      <div className="customize-toolbar-section">
        <h3 className="customize-toolbar-section-title">Your InviSurf</h3>

        {/* Bookmarks */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </span>
            <span className="customize-toolbar-label">Bookmarks</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.bookmarks}
            className={`toolbar-toggle-switch${toolbarConfig.bookmarks ? ' active' : ''}`}
            onClick={() => handleToggle('bookmarks', !toolbarConfig.bookmarks)}
            title="Toggle Bookmarks sidebar button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Reading list */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </span>
            <span className="customize-toolbar-label">Reading list</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.readingList}
            className={`toolbar-toggle-switch${toolbarConfig.readingList ? ' active' : ''}`}
            onClick={() => handleToggle('readingList', !toolbarConfig.readingList)}
            title="Toggle Reading list sidebar button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* History */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </span>
            <span className="customize-toolbar-label">History</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.history}
            className={`toolbar-toggle-switch${toolbarConfig.history ? ' active' : ''}`}
            onClick={() => handleToggle('history', !toolbarConfig.history)}
            title="Toggle History sidebar button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Downloads */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </span>
            <span className="customize-toolbar-label">Downloads</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.downloads}
            className={`toolbar-toggle-switch${toolbarConfig.downloads ? ' active' : ''}`}
            onClick={() => handleToggle('downloads', !toolbarConfig.downloads)}
            title="Toggle Downloads button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Delete browsing data */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </span>
            <span className="customize-toolbar-label">Delete browsing data</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.deleteBrowsingData}
            className={`toolbar-toggle-switch${toolbarConfig.deleteBrowsingData ? ' active' : ''}`}
            onClick={() => handleToggle('deleteBrowsingData', !toolbarConfig.deleteBrowsingData)}
            title="Toggle Delete browsing data button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Print */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
            </span>
            <span className="customize-toolbar-label">Print</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.print}
            className={`toolbar-toggle-switch${toolbarConfig.print ? ' active' : ''}`}
            onClick={() => handleToggle('print', !toolbarConfig.print)}
            title="Toggle Print button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Search this tab with Google Lens */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </span>
            <span className="customize-toolbar-label">Search this tab with Google Lens</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.lens}
            className={`toolbar-toggle-switch${toolbarConfig.lens ? ' active' : ''}`}
            onClick={() => handleToggle('lens', !toolbarConfig.lens)}
            title="Toggle Google Lens button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Developer Tools */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </span>
            <span className="customize-toolbar-label">Developer Tools</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.devTools}
            className={`toolbar-toggle-switch${toolbarConfig.devTools ? ' active' : ''}`}
            onClick={() => handleToggle('devTools', !toolbarConfig.devTools)}
            title="Toggle Developer Tools button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Arrange Window */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v7A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 3h-11zm0 1.2h4.9v7.6H2.5a.3.3 0 0 1-.3-.3v-7c0-.17.13-.3.3-.3zm6.1 0h4.9c.17 0 .3.13.3.3v7a.3.3 0 0 1-.3.3H8.6V4.2z" />
              </svg>
            </span>
            <span className="customize-toolbar-label">Arrange Window</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.arrangeWindow}
            className={`toolbar-toggle-switch${toolbarConfig.arrangeWindow ? ' active' : ''}`}
            onClick={() => handleToggle('arrangeWindow', !toolbarConfig.arrangeWindow)}
            title="Toggle Arrange Window button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>

        {/* Transparency Mode */}
        <div className="customize-toolbar-row">
          <div className="customize-toolbar-row-left">
            <span className="customize-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </span>
            <span className="customize-toolbar-label">Transparency Mode</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!toolbarConfig.transparency}
            className={`toolbar-toggle-switch${toolbarConfig.transparency ? ' active' : ''}`}
            onClick={() => handleToggle('transparency', !toolbarConfig.transparency)}
            title="Toggle Transparency Mode button"
          >
            <span className="toolbar-toggle-knob" />
          </button>
        </div>
      </div>
    </div>
  );
}

