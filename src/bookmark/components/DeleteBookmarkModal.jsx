import React, { useEffect, useRef, useState } from 'react';
import AssetMaskIcon from '../../components/AssetMaskIcon';
import { folderSvg } from '../../constants/appAssetUrls';
import { KEYBOARD } from '../../constants/conditionStrings.js';

function buildFaviconUrl(url) {
  if (!url) return '';
  try {
    const domain = new URL(url).hostname;
    if (!domain) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  } catch {
    return '';
  }
}

export default function DeleteBookmarkModal({ target, onConfirm, onClose }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [faviconHidden, setFaviconHidden] = useState(false);
  const deleteBtnRef = useRef(null);

  useEffect(() => {
    deleteBtnRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === KEYBOARD.ESCAPE && !isDeleting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDeleting, onClose]);

  if (!target) return null;

  const isMultiple = target.type === 'multiple';
  const isFolder = !isMultiple && (target.isFolder || !target.entry?.url);
  const title = target.entry?.title || target.title || 'Untitled';
  const url = target.entry?.url || target.url || '';
  const count = target.count || (target.ids ? target.ids.length : 1);

  const dialogTitle = isMultiple
    ? `Delete ${count} bookmarks?`
    : isFolder
      ? 'Delete folder?'
      : 'Delete bookmark?';

  const dialogDesc = isMultiple
    ? `Are you sure you want to delete ${count} selected items?`
    : isFolder
      ? `Are you sure you want to delete "${title}" and all its contents?`
      : `Are you sure you want to delete this bookmark?`;

  const faviconSrc = !isFolder && url ? buildFaviconUrl(url) : '';

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="b-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="b-delete-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div className="b-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="b-delete-modal-title" className="b-modal-title">
          {dialogTitle}
        </h3>

        <p className="b-delete-modal-desc">{dialogDesc}</p>

        {!isMultiple && (
          <div className="b-delete-modal-preview">
            <div className="b-delete-modal-preview-icon" aria-hidden="true">
              {isFolder ? (
                <AssetMaskIcon icon={folderSvg} size={18} className="b-row-folder-icon" />
              ) : faviconSrc && !faviconHidden ? (
                <img
                  className="b-row-favicon"
                  src={faviconSrc}
                  alt=""
                  onError={() => setFaviconHidden(true)}
                />
              ) : (
                <span className="b-row-favicon" />
              )}
            </div>
            <div className="b-delete-modal-preview-text">
              <span className="b-delete-modal-preview-title" title={title}>
                {title}
              </span>
              {!isFolder && url && (
                <span className="b-delete-modal-preview-url" title={url}>
                  {url}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="b-modal-footer">
          <button
            type="button"
            className="b-modal-cancel"
            disabled={isDeleting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={deleteBtnRef}
            type="button"
            className="b-modal-delete"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
