import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentTab } from '../store/browserSlice';
import './ScreenShareBanner.css';

/**
 * Screen Sharing Banner displayed directly beneath the BookmarkBar.
 * Accurately matches Chrome's native presentation banner UI and styling.
 */
export default function ScreenShareBanner({ currentTabId }) {
  const dispatch = useDispatch();
  const screenShare = useSelector((s) => s.browser.screenShare);
  const tabs = useSelector((s) => s.browser.tabs);

  // Production-grade UX: Tab presentation banner is strictly shown only when tabs are shared
  if (!screenShare || !screenShare.active || screenShare.sourceKind !== 'tab') {
    return null;
  }

  const {
    sharedTabId,
    sharedHost = '',
    sharedTitle = '',
    requestingTabId,
    requestingHost = '',
    surfaceSwitching = 'include',
    state: shareState = 'idle',
  } = screenShare;

  const normalizeTabId = (id) => (id !== null && id !== undefined ? String(id).replace(/^tab:/, '') : null);
  const normCurrent = normalizeTabId(currentTabId);
  const normShared = normalizeTabId(sharedTabId);
  const normRequesting = normalizeTabId(requestingTabId);

  const isMeetingTab = Boolean(normCurrent && normRequesting && normCurrent === normRequesting);
  const isSharedTab = Boolean(normCurrent && normShared && normCurrent === normShared);

  const currentTab = tabs?.[currentTabId];
  const currentUrl = (currentTab?.url || '').trim().toLowerCase();
  const isRestrictedTab =
    !currentUrl ||
    currentUrl.startsWith('invisurf:') ||
    currentUrl.startsWith('chrome:') ||
    currentUrl.startsWith('about:') ||
    currentUrl.startsWith('devtools:') ||
    currentUrl.startsWith('data:') ||
    Boolean(currentTab?.isNewTab);

  const isSwitching = shareState === 'switching';
  const showSwitchButton =
    !isSharedTab &&
    !isMeetingTab &&
    !isRestrictedTab &&
    surfaceSwitching !== 'exclude';

  const handleStopSharing = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (window.electronAPI?.stopScreenShare) {
      window.electronAPI.stopScreenShare();
    }
  };

  const handleShareThisTabInstead = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (isSwitching) return;
    if (window.electronAPI?.switchScreenShareTab && currentTabId) {
      window.electronAPI.switchScreenShareTab(currentTabId);
    }
  };

  const handleJumpToTab = (targetId, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (targetId) {
      dispatch(setCurrentTab(targetId));
      if (window.electronAPI?.switchTab) {
        window.electronAPI.switchTab(targetId);
      }
    }
  };

  const displaySharedHost = sharedHost || 'tab';
  const displayRequestingHost = requestingHost || 'meet.google.com';

  return (
    <div className="screen-share-banner-bar screen-share-banner-wrapper">
      {/* Chrome Screen Share Presentation Icon */}
      <div className="screen-share-banner-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74zM4 6h16v10H4V6z" />
        </svg>
      </div>

      {/* Dynamic Context Message Matching User Screenshots */}
      <div className="screen-share-banner-content">
        {isMeetingTab ? (
          <>
            <span className="screen-share-text">Sharing</span>
            <button
              type="button"
              className="screen-share-chip"
              onClick={(e) => handleJumpToTab(sharedTabId, e)}
              title={sharedTitle ? `Jump to ${sharedTitle} (${displaySharedHost})` : `Jump to ${displaySharedHost}`}
            >
              {displaySharedHost}
            </button>
            <span className="screen-share-text">to this tab</span>
          </>
        ) : isSharedTab ? (
          <>
            <span className="screen-share-text">Sharing this tab to</span>
            <button
              type="button"
              className="screen-share-chip"
              onClick={(e) => handleJumpToTab(requestingTabId, e)}
              title={`Jump to ${displayRequestingHost}`}
            >
              {displayRequestingHost}
            </button>
          </>
        ) : (
          <>
            <span className="screen-share-text">Sharing</span>
            <button
              type="button"
              className="screen-share-chip"
              onClick={(e) => handleJumpToTab(sharedTabId, e)}
              title={sharedTitle ? `Jump to ${sharedTitle} (${displaySharedHost})` : `Jump to ${displaySharedHost}`}
            >
              {displaySharedHost}
            </button>
            <span className="screen-share-text">to</span>
            <button
              type="button"
              className="screen-share-chip"
              onClick={(e) => handleJumpToTab(requestingTabId, e)}
              title={`Jump to ${displayRequestingHost}`}
            >
              {displayRequestingHost}
            </button>
          </>
        )}
      </div>

      {/* Subtle Vertical Divider */}
      <div className="screen-share-divider" aria-hidden="true" />

      {/* Interactive Action Buttons */}
      <div className="screen-share-banner-actions">
        {showSwitchButton && (
          <button
            type="button"
            className={`screen-share-switch-btn${isSwitching ? ' screen-share-switch-btn--switching' : ''}`}
            onClick={handleShareThisTabInstead}
            disabled={isSwitching}
            title={isSwitching ? 'Switching tab sharing...' : 'Share this tab instead'}
          >
            {isSwitching ? 'Switching...' : 'Share this tab instead'}
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
  );
}
