import React from 'react';
import './InternalPageHeader.css';
import { logoPurpleLightSvg } from '../constants/appAssetUrls.js';

export default function InternalPageHeader({
  title,
  searchTerm = '',
  onSearchChange,
  searchPlaceholder = `Search ${title.toLowerCase()}`,
  showClearAll = false,
  onClearAll,
  clearAllLabel = 'Clear all',
  clearAllTitle = 'Clear all',
  leftExtra = null,
  rightExtra = null,
  className = '',
}) {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && searchTerm) {
      e.stopPropagation();
      onSearchChange?.('');
    }
  };

  return (
    <header className={`internal-page-header ${className}`.trim()}>
      <div className="internal-page-header__left">
        {leftExtra}
        <img
          src={logoPurpleLightSvg}
          width={26}
          height={26}
          alt="InviSurf"
          className="internal-page-header__logo"
        />
        <h1 className="internal-page-header__title">{title}</h1>
      </div>

      <div className="internal-page-header__center">
        <div className="internal-page-header__search-box">
          <svg
            className="internal-page-header__search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="internal-page-header__search-input"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => onSearchChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={searchPlaceholder}
          />
          {searchTerm ? (
            <button
              type="button"
              className="internal-page-header__search-clear-btn"
              onClick={() => onSearchChange?.('')}
              title="Clear search"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <div className="internal-page-header__right">
        {showClearAll && onClearAll ? (
          <button
            type="button"
            className="internal-page-header__clear-all-btn"
            onClick={onClearAll}
            title={clearAllTitle}
            aria-label={clearAllTitle}
          >
            {clearAllLabel}
          </button>
        ) : null}
        {rightExtra}
      </div>
    </header>
  );
}
