import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

function formatBytes(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(num) / Math.log(1024)), units.length - 1);
    const val = num / Math.pow(1024, i);
    return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
    const speed = Number(bytesPerSec);
    if (!Number.isFinite(speed) || speed <= 0) return '';
    return `${formatBytes(speed)}/s`;
}

export function renderDownloadPanel(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.anchorRect || {};
    const width = 360;
    const metrics = getCompactMenuMetrics(payload);
    const pad = 8;
    const left0 = Math.round(r.left != null ? r.left : 0);
    const w0 = Math.max(1, Math.round(r.width != null ? r.width : 32));
    const top0 = Math.round(r.top != null ? r.top : 0);
    const h0 = Math.max(1, Math.round(r.height != null ? r.height : 32));
    const left = Math.max(pad, Math.min(left0 + w0 - width, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0 + h0 + 6, metrics.viewportHeight - 260 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(220, Math.min(metrics.viewportHeight - top - pad, 440)) + 'px';
    DOM.panel.style.padding = '0';
    DOM.panel.style.borderRadius = '12px';
    DOM.panel.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.2)';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';

    // 1. Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '14px 16px 12px 16px';
    header.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(128,128,128,0.15))';

    const title = document.createElement('span');
    title.textContent = 'Recent Download History';
    title.style.fontSize = '14px';
    title.style.fontWeight = '600';
    title.style.color = 'inherit';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = 'inherit';
    closeBtn.style.opacity = '0.6';
    closeBtn.style.padding = '4px';
    closeBtn.style.margin = '-4px';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.borderRadius = '50%';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.6'; };
    closeBtn.onclick = () => {
        hideAll({ hideLens: false });
        notifyHost({ type: 'dismiss', reason: 'close' });
    };

    header.appendChild(title);
    header.appendChild(closeBtn);
    DOM.panel.appendChild(header);

    // 2. Body List
    const body = document.createElement('div');
    body.style.flex = '1 1 auto';
    body.style.overflowY = 'auto';
    body.style.padding = '6px 0';

    const activeList = Array.isArray(payload.active) ? payload.active : [];
    const historyList = Array.isArray(payload.history) ? payload.history.slice(0, 3) : [];
    const hasItems = activeList.length > 0 || historyList.length > 0;

    if (!hasItems) {
        const empty = document.createElement('div');
        empty.style.padding = '24px 16px';
        empty.style.textAlign = 'center';
        empty.style.fontSize = '13px';
        empty.style.opacity = '0.7';
        empty.textContent = 'No recent downloads';
        body.appendChild(empty);
    }

    // Render active items
    activeList.forEach((item) => {
        const row = document.createElement('div');
        row.style.padding = '10px 16px';
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '6px';
        row.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(128,128,128,0.08))';

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '12px';

        // Document icon
        const icon = document.createElement('div');
        icon.style.flexShrink = '0';
        icon.style.opacity = '0.7';
        icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
        topRow.appendChild(icon);

        const textCol = document.createElement('div');
        textCol.style.flex = '1 1 auto';
        textCol.style.minWidth = '0';

        const name = document.createElement('div');
        name.style.fontSize = '13px';
        name.style.fontWeight = '500';
        name.style.whiteSpace = 'nowrap';
        name.style.overflow = 'hidden';
        name.style.textOverflow = 'ellipsis';
        name.title = item.filename || 'download';
        name.textContent = item.filename || 'download';
        textCol.appendChild(name);

        const sub = document.createElement('div');
        sub.style.fontSize = '11.5px';
        sub.style.opacity = '0.65';
        sub.style.marginTop = '2px';
        const isPaused = item.state === 'paused';
        const received = Number(item.receivedBytes) || 0;
        const total = Number(item.totalBytes) || 0;
        const speed = formatSpeed(item.speedBytesPerSec);
        if (isPaused) {
            sub.textContent = `${formatBytes(received)} • Paused`;
        } else if (received === 0) {
            sub.textContent = 'Starting...';
        } else if (total > 0) {
            sub.textContent = `${formatBytes(received)} of ${formatBytes(total)}${speed ? ' • ' + speed : ''}`;
        } else {
            sub.textContent = `${formatBytes(received)} downloaded${speed ? ' • ' + speed : ''}`;
        }
        textCol.appendChild(sub);
        topRow.appendChild(textCol);

        // Actions: Pause/Resume and Cancel
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.alignItems = 'center';
        actions.style.gap = '6px';
        actions.style.flexShrink = '0';

        // Pause/Resume button
        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button';
        pauseBtn.title = isPaused ? 'Resume download' : 'Pause download';
        pauseBtn.style.background = 'transparent';
        pauseBtn.style.border = 'none';
        pauseBtn.style.cursor = 'pointer';
        pauseBtn.style.color = 'inherit';
        pauseBtn.style.padding = '4px';
        pauseBtn.style.display = 'flex';
        pauseBtn.style.alignItems = 'center';
        pauseBtn.style.justifyContent = 'center';
        pauseBtn.innerHTML = isPaused
            ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'
            : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        pauseBtn.onclick = (e) => {
            e.stopPropagation();
            notifyHost({
                type: 'downloadAction',
                action: isPaused ? 'resume' : 'pause',
                id: item.id,
            });
        };
        actions.appendChild(pauseBtn);

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.title = 'Cancel download';
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.border = 'none';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.color = 'inherit';
        cancelBtn.style.opacity = '0.75';
        cancelBtn.style.padding = '4px';
        cancelBtn.style.display = 'flex';
        cancelBtn.style.alignItems = 'center';
        cancelBtn.style.justifyContent = 'center';
        cancelBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            notifyHost({
                type: 'downloadAction',
                action: 'cancel',
                id: item.id,
            });
        };
        actions.appendChild(cancelBtn);
        topRow.appendChild(actions);

        row.appendChild(topRow);

        // Progress bar
        const track = document.createElement('div');
        track.style.width = '100%';
        track.style.height = '3.5px';
        track.style.background = 'var(--chrome-tab-separator, rgba(128,128,128,0.2))';
        track.style.borderRadius = '2px';
        track.style.overflow = 'hidden';
        track.style.marginTop = '2px';

        const fill = document.createElement('div');
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : (received > 0 ? 30 : 0);
        fill.style.width = `${received > 0 ? (total > 0 ? Math.max(2, percent) : 35) : 2}%`;
        fill.style.height = '100%';
        fill.style.borderRadius = '2px';
        fill.style.background = isPaused ? '#fbbc05' : 'var(--chrome-accent, #1a73e8)';
        fill.style.transition = 'width 0.2s ease';
        track.appendChild(fill);
        row.appendChild(track);

        body.appendChild(row);
    });

    // Render recent history items
    historyList.forEach((item) => {
        const row = document.createElement('div');
        row.style.padding = '10px 16px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '12px';
        row.style.borderBottom = '1px solid var(--chrome-tab-separator, rgba(128,128,128,0.08))';

        const icon = document.createElement('div');
        icon.style.flexShrink = '0';
        icon.style.opacity = '0.6';
        icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
        row.appendChild(icon);

        const textCol = document.createElement('div');
        textCol.style.flex = '1 1 auto';
        textCol.style.minWidth = '0';

        const isCompleted = item.state === 'completed';
        const isDeleted = isCompleted && item.fileExists === false;
        const isCancelled = item.state === 'cancelled';
        const isFailed = item.state === 'failed';

        const name = document.createElement('div');
        name.style.fontSize = '13px';
        name.style.fontWeight = '500';
        name.style.whiteSpace = 'nowrap';
        name.style.overflow = 'hidden';
        name.style.textOverflow = 'ellipsis';
        name.title = item.filename || 'download';
        if (isDeleted || isCancelled || isFailed) {
            name.style.textDecoration = 'line-through';
            name.style.opacity = '0.6';
        }
        name.textContent = item.filename || 'download';
        textCol.appendChild(name);

        const sub = document.createElement('div');
        sub.style.fontSize = '11.5px';
        sub.style.opacity = '0.6';
        sub.style.marginTop = '2px';
        const sizeStr = formatBytes(item.receivedBytes || item.totalBytes);
        if (isDeleted) {
            sub.textContent = `${sizeStr} • Deleted`;
        } else if (isCompleted) {
            sub.textContent = `${sizeStr} • Complete`;
        } else if (isCancelled) {
            sub.textContent = 'Cancelled';
        } else {
            sub.textContent = 'Failed';
        }
        textCol.appendChild(sub);
        row.appendChild(textCol);

        // Click on the item itself opens it in default OS software
        if (isCompleted && !isDeleted && item.savePath) {
            row.style.cursor = 'pointer';
            row.title = `Open ${item.filename || 'file'}`;
            row.onmouseenter = () => { row.style.background = 'var(--chrome-tab-hover-bg, rgba(128,128,128,0.08))'; };
            row.onmouseleave = () => { row.style.background = 'transparent'; };
            row.onclick = () => {
                hideAll({ hideLens: false });
                notifyHost({
                    type: 'downloadAction',
                    action: 'openFile',
                    savePath: item.savePath,
                });
            };
        }

        // Actions: Show in folder or Retry
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.alignItems = 'center';
        actions.style.gap = '6px';
        actions.style.flexShrink = '0';

        if (isCompleted && !isDeleted && item.savePath) {
            const folderBtn = document.createElement('button');
            folderBtn.type = 'button';
            folderBtn.title = 'Show in folder';
            folderBtn.style.background = 'transparent';
            folderBtn.style.border = 'none';
            folderBtn.style.cursor = 'pointer';
            folderBtn.style.color = 'inherit';
            folderBtn.style.opacity = '0.7';
            folderBtn.style.padding = '4px';
            folderBtn.style.display = 'flex';
            folderBtn.style.alignItems = 'center';
            folderBtn.style.justifyContent = 'center';
            folderBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
            folderBtn.onclick = (e) => {
                e.stopPropagation();
                notifyHost({
                    type: 'downloadAction',
                    action: 'showInFolder',
                    savePath: item.savePath,
                });
            };
            actions.appendChild(folderBtn);
        } else if ((isCancelled || isFailed) && item.url) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.title = 'Retry download';
            retryBtn.style.background = 'transparent';
            retryBtn.style.border = 'none';
            retryBtn.style.cursor = 'pointer';
            retryBtn.style.color = 'inherit';
            retryBtn.style.opacity = '0.7';
            retryBtn.style.padding = '4px';
            retryBtn.style.display = 'flex';
            retryBtn.style.alignItems = 'center';
            retryBtn.style.justifyContent = 'center';
            retryBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
            retryBtn.onclick = (e) => {
                e.stopPropagation();
                notifyHost({
                    type: 'downloadAction',
                    action: 'retry',
                    id: item.id,
                });
            };
            actions.appendChild(retryBtn);
        }

        row.appendChild(actions);
        body.appendChild(row);
    });

    DOM.panel.appendChild(body);

    // 3. Footer: "Full Download History"
    const footer = document.createElement('button');
    footer.type = 'button';
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'space-between';
    footer.style.width = '100%';
    footer.style.padding = '12px 16px';
    footer.style.background = 'transparent';
    footer.style.border = 'none';
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, rgba(128,128,128,0.15))';
    footer.style.color = 'inherit';
    footer.style.fontSize = '13px';
    footer.style.fontWeight = '500';
    footer.style.cursor = 'pointer';
    footer.style.transition = 'background 0.15s ease';

    const footerText = document.createElement('span');
    footerText.textContent = 'Full Download History';

    const footerIcon = document.createElement('span');
    footerIcon.style.opacity = '0.6';
    footerIcon.style.display = 'flex';
    footerIcon.style.alignItems = 'center';
    footerIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';

    footer.appendChild(footerText);
    footer.appendChild(footerIcon);

    footer.onmouseenter = () => { footer.style.background = 'var(--chrome-tab-hover-bg, rgba(128,128,128,0.1))'; };
    footer.onmouseleave = () => { footer.style.background = 'transparent'; };

    footer.onclick = () => {
        hideAll({ hideLens: false });
        notifyHost({ type: 'openDownloadsPage' });
    };

    DOM.panel.appendChild(footer);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}
