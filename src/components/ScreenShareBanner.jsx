import React from 'react';
import { useSelector } from 'react-redux';
import './ScreenShareBanner.css';

/**
 * Screen Sharing Banner displayed directly beneath the BookmarkBar
 * Adapts to user's chosen theme and matches Chrome's presentation banner UX.
 */
export default function ScreenShareBanner({ currentTabId }) {
  const screenShare = useSelector((s) => s.browser.screenShare);

  if (!screenShare || !screenShare.active) {
    return null;
  }

  const {
    sourceKind = 'tab',
    sharedTabId,
    sharedHost = 'tab',
    requestingTabId,
    requestingHost = 'Meeting',
  } = screenShare;

  const isMeetingTab = currentTabId === requestingTabId;
  const isSharedTab = currentTabId === sharedTabId;

  const handleStopSharing = () => {
    if (window.electronAPI?.stopScreenShare) {
      window.electronAPI.stopScreenShare();
    }
  };

  const handleShareThisTabInstead = () => {
    if (window.electronAPI?.switchScreenShareTab && currentTabId) {
      window.electronAPI.switchScreenShareTab(currentTabId);
    }
  };

  const handleJumpToTab = (targetId) => {
    if (window.electronAPI?.switchTab && targetId) {
      window.electronAPI.switchTab(targetId);
    }
  };

  return (
    <div className="screen-share-banner-wrapper">
      <div className="screen-share-banner-pill">
        {/* Screen / Cast Presentation Icon */}
        <div className="screen-share-banner-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <polyline points="10 9 14 9 14 13" />
            <line x1="14" y1="9" x2="9" y2="14" />
          </svg>
        </div>

        {/* Dynamic Context Message */}
        <div className="screen-share-banner-text">
          {sourceKind !== 'tab' ? (
            <span>Sharing your screen to <span className="screen-share-host">{requestingHost}</span></span>
          ) : isMeetingTab ? (
            <span>Sharing <span className="screen-share-host">{sharedHost}</span> to this tab</span>
          ) : isSharedTab ? (
            <span>Sharing this tab to <span className="screen-share-host">{requestingHost}</span></span>
          ) : (
            <span>Sharing <span className="screen-share-host">{sharedHost}</span> to <span className="screen-share-host">{requestingHost}</span></span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="screen-share-banner-actions">
          {sourceKind === 'tab' && !isSharedTab && !isMeetingTab && (
            <button
              type="button"
              className="screen-share-switch-btn"
              onClick={handleShareThisTabInstead}
              title="Share this tab to meeting instead"
            >
              Share this tab instead
            </button>
          )}

          {sourceKind === 'tab' && isSharedTab && requestingTabId && (
            <button
              type="button"
              className="screen-share-jump-btn"
              onClick={() => handleJumpToTab(requestingTabId)}
              title={`View tab: ${requestingHost}`}
            >
              View tab: {requestingHost}
            </button>
          )}

          {sourceKind === 'tab' && isMeetingTab && sharedTabId && (
            <button
              type="button"
              className="screen-share-jump-btn"
              onClick={() => handleJumpToTab(sharedTabId)}
              title={`View tab: ${sharedHost}`}
            >
              View tab: {sharedHost}
            </button>
          )}

          <button
            type="button"
            className="screen-share-stop-btn"
            onClick={handleStopSharing}
            title="Stop sharing"
          >
            Stop sharing
          </button>
        </div>
      </div>
    </div>
  );
}

