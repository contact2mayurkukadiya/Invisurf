import React from 'react';
import './SidePanel.css';

export default function LensPanel() {
  const handleStartSearch = () => {
    if (window.electronAPI?.runMenuCommand) {
      window.electronAPI.runMenuCommand('search-with-google-lens');
    }
  };

  return (
    <div className="lens-panel-container" role="region" aria-label="Google Lens Panel">
      <div className="lens-panel-empty-state">
        <div className="lens-panel-icon-wrap" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h3 className="lens-panel-title">Search with Google Lens</h3>

        <p className="lens-panel-subtitle">
          Select any text or image on the page to search for information, find matching images, or copy text.
        </p>

        <button
          type="button"
          id="lens-panel-start-search-btn"
          className="lens-panel-search-btn"
          onClick={handleStartSearch}
          title="Select an area on the page"
          aria-label="Select an area on the page"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Select area on page
        </button>

        <div className="lens-panel-features">
          <div className="lens-panel-feature-row">
            <div className="lens-panel-feature-dot" />
            <span>Search visual matches and products</span>
          </div>
          <div className="lens-panel-feature-row">
            <div className="lens-panel-feature-dot" />
            <span>Select and copy text from any image</span>
          </div>
          <div className="lens-panel-feature-row">
            <div className="lens-panel-feature-dot" />
            <span>Press Escape at any time to cancel</span>
          </div>
        </div>
      </div>
    </div>
  );
}
