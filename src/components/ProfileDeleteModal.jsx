import React, { useCallback, useEffect, useState } from 'react';
import ProfileAvatar from './ProfileAvatar';
import './ProfileDeleteModal.css';
import { KEYBOARD } from '../constants/conditionStrings.js';

export default function ProfileDeleteModal({
  open,
  profile,
  onClose,
  onDeleted,
}) {
  const [summary, setSummary] = useState({
    historyCount: 0,
    bookmarksCount: 0,
    loading: true,
  });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [effectiveTheme, setEffectiveTheme] = useState('light');

  // Synchronize effective light or dark theme strictly based on Invisurf settings
  useEffect(() => {
    let unsub = null;
    const evaluateTheme = async () => {
      try {
        const forced = typeof document !== 'undefined'
          ? document.documentElement.getAttribute('data-forced-appearance')
          : null;
        if (forced === 'dark') {
          setEffectiveTheme('dark');
          return;
        }
        if (forced === 'light') {
          setEffectiveTheme('light');
          return;
        }

        const settings = await window.electronAPI.settingsGet?.();
        const ct = settings?.colorTheme;
        if (ct === 'dark') {
          setEffectiveTheme('dark');
          return;
        }
        if (ct === 'light') {
          setEffectiveTheme('light');
          return;
        }

        const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
        setEffectiveTheme(systemDark ? 'dark' : 'light');
      } catch {
        const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
        setEffectiveTheme(systemDark ? 'dark' : 'light');
      }
    };

    evaluateTheme();
    const mql = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;
    mql?.addEventListener?.('change', evaluateTheme);
    if (window.electronAPI?.onSettingsChanged) {
      unsub = window.electronAPI.onSettingsChanged(() => evaluateTheme());
    }

    return () => {
      mql?.removeEventListener?.('change', evaluateTheme);
      if (typeof unsub === 'function') unsub();
    };
  }, [open]);

  // Load summary data (browsing history & bookmarks count) when opened
  useEffect(() => {
    if (!open || !profile?.profileId) return;
    let cancelled = false;
    setSummary({ historyCount: 0, bookmarksCount: 0, loading: true });
    setError(null);
    setDeleting(false);

    (async () => {
      try {
        const res = await window.electronAPI.profileGetDataSummary?.(profile.profileId);
        if (!cancelled && res?.ok) {
          setSummary({
            historyCount: res.historyCount || 0,
            bookmarksCount: res.bookmarksCount || 0,
            loading: false,
          });
        } else if (!cancelled) {
          setSummary({ historyCount: 0, bookmarksCount: 0, loading: false });
        }
      } catch {
        if (!cancelled) {
          setSummary({ historyCount: 0, bookmarksCount: 0, loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, profile?.profileId]);

  const handleDelete = useCallback(async () => {
    if (deleting || !profile?.profileId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await window.electronAPI.profileDelete?.(profile.profileId);
      if (!res?.ok) {
        setError(res?.error || 'Could not delete profile.');
        setDeleting(false);
        return;
      }
      onDeleted?.();
    } catch (err) {
      setError(err?.message || 'Could not delete profile.');
      setDeleting(false);
    }
  }, [deleting, profile?.profileId, onDeleted]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === KEYBOARD.ESCAPE && !deleting) {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, deleting, onClose]);

  if (!open || !profile) return null;

  const displayName = profile.displayName || profile.profileId || 'Profile';

  return (
    <div className={`profile-delete-overlay profile-delete-overlay--${effectiveTheme}`} role="presentation">
      <button
        type="button"
        className="profile-delete-backdrop"
        tabIndex={-1}
        aria-label="Close dialog"
        disabled={deleting}
        onClick={() => {
          if (!deleting) onClose?.();
        }}
      />
      <div
        className="profile-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-delete-title"
        aria-describedby="profile-delete-desc"
      >
        <h2 id="profile-delete-title" className="profile-delete-title">
          Delete this profile and its data?
        </h2>
        <p id="profile-delete-desc" className="profile-delete-subtitle">
          This will permanently delete your browsing data from this device.
        </p>

        <div className="profile-delete-card">
          <div className="profile-delete-card-identity">
            <span className="profile-delete-card-name" title={displayName}>
              {displayName}
            </span>
            <div className="profile-delete-avatar-wrap" aria-hidden="true">
              <ProfileAvatar profile={profile} size="lg" />
            </div>
          </div>

          <div className="profile-delete-card-stats">
            <div className="profile-delete-stat-row">
              <span className="profile-delete-stat-label">Browsing history</span>
              <span className="profile-delete-stat-value">
                {summary.loading ? '…' : summary.historyCount}
              </span>
            </div>
            <div className="profile-delete-stat-row">
              <span className="profile-delete-stat-label">Bookmarks</span>
              <span className="profile-delete-stat-value">
                {summary.loading ? '…' : summary.bookmarksCount}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="profile-delete-error" role="alert">
            {error}
          </div>
        )}

        <div className="profile-delete-actions">
          <button
            type="button"
            className="profile-delete-btn profile-delete-btn--cancel"
            disabled={deleting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="profile-delete-btn profile-delete-btn--delete"
            disabled={deleting}
            onClick={handleDelete}
            autoFocus
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
