import React from 'react';
import { menuFindSvg } from '../../constants/appAssetUrls.js';

function ActionIcon({ action }) {
  if (action.zoomType === 'zoom-out') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="omnibox-icon"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="7" />
        <line x1="21" y1="21" x2="15.5" y2="15.5" />
        <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      </svg>
    );
  }
  if (action.zoomType === 'zoom-in') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="omnibox-icon"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="7" />
        <line x1="21" y1="21" x2="15.5" y2="15.5" />
        <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
        <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      </svg>
    );
  }
  if (action.iconSrc) {
    return (
      <img
        src={action.iconSrc}
        className="omnibox-icon"
        width={16}
        height={16}
        alt=""
      />
    );
  }
  return (
    <img src={menuFindSvg} className="omnibox-icon" width={16} height={16} alt="" />
  );
}

export default function OmniboxSuffix({ actions, popup, onActionClick }) {
  const suffixActions = actions.filter((a) => a.slot === 'suffix');
  if (suffixActions.length === 0) return null;

  return (
    <div className="omnibox-suffix">
      {suffixActions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`omnibox-action-btn omnibox-action-btn--suffix${popup === action.opensPopup ? ' omnibox-action-btn--active' : ''}`}
          title={action.title}
          aria-label={action.title}
          aria-expanded={popup === action.opensPopup}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => onActionClick(action, e)}
        >
          <ActionIcon action={action} />
        </button>
      ))}
    </div>
  );
}
