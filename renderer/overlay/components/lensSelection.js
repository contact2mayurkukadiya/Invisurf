import { hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';

const LENS_MAGNIFIER_ZOOM = 2.0;
const LENS_MAGNIFIER_RADIUS = 60;

let lensLayer = null;
let siteFrame = null;
let bgBlurImg = null;
let bgOverlay = null;
let canvasFrame = null;
let sharpImg = null;
let exitBtn = null;
let chip = null;
let magnifier = null;
let selectionMask = null;
let selection = null;
let actions = null;
let copyToast = null;
let sidebarFrame = null;

let cachedSnapshotDataUrl = '';
let lensPointerId = null;
let isDragging = false;
let selectionStarted = false;
let currentRect = null;
let startX = 0;
let startY = 0;
let selectedRatio = null;
let copyToastTimer = null;
let lastPointerX = null;
let lastPointerY = null;

let currentCanvasX = 0;
let currentCanvasY = 0;
let currentCanvasW = 0;
let currentCanvasH = 0;
let currentContainer = { x: 8, y: 4, width: 800, height: 600 };

onHideAll((options) => {
    if (options && options.hideLens === false) return;
    hideLensSelection();
});

export function hideLensSelection() {
    lensPointerId = null;
    isDragging = false;
    currentRect = null;
    selectedRatio = null;
    selectionStarted = false;
    lastPointerX = null;
    lastPointerY = null;
    if (lensLayer && lensLayer.parentNode) {
        lensLayer.parentNode.removeChild(lensLayer);
    }
    lensLayer = null;
    siteFrame = null;
    bgBlurImg = null;
    bgOverlay = null;
    canvasFrame = null;
    sharpImg = null;
    exitBtn = null;
    chip = null;
    magnifier = null;
    selectionMask = null;
    selection = null;
    actions = null;
    copyToast = null;
    if (sidebarFrame && sidebarFrame.parentNode) {
        sidebarFrame.parentNode.removeChild(sidebarFrame);
    }
    sidebarFrame = null;
    cachedSnapshotDataUrl = '';
}

function computeGeometry(patch) {
    const containerRect = patch.containerBounds || patch.siteBounds || patch.leftPanelBounds || {};
    const container = {
        x: Math.round(Number(containerRect.x) || 8),
        y: Math.round(Number(containerRect.y) || 4),
        width: Math.round(Number(containerRect.width) || (window.innerWidth - 374)),
        height: Math.round(Number(containerRect.height) || (window.innerHeight - 12)),
    };
    const panelRadius = Math.max(12, Math.round(Number(patch.panelRadius) || 14));

    const sourceW = Math.max(1, Number(patch.sourceWidth) || container.width);
    const sourceH = Math.max(1, Number(patch.sourceHeight) || container.height);
    const sourceAspect = sourceW / sourceH;
    const containerAspect = container.width / container.height;

    let canvasW, canvasH, canvasX, canvasY;
    if (containerAspect > sourceAspect) {
        canvasH = container.height;
        canvasW = Math.round(canvasH * sourceAspect);
        canvasX = Math.round((container.width - canvasW) / 2);
        canvasY = 0;
    } else {
        canvasW = container.width;
        canvasH = Math.round(canvasW / sourceAspect);
        canvasX = 0;
        canvasY = Math.round((container.height - canvasH) / 2);
    }

    return { container, panelRadius, canvasW, canvasH, canvasX, canvasY };
}

function updateSidebarFrame(patch) {
    if (!sidebarFrame) return;
    const sb = patch && (patch.sidebarBounds || patch.leftPanelBounds);
    if (patch && patch.hasSearchResults && patch.sidebarBounds && patch.sidebarBounds.width > 0 && patch.sidebarBounds.height > 0) {
        sidebarFrame.style.left = patch.sidebarBounds.x + 'px';
        sidebarFrame.style.top = patch.sidebarBounds.y + 'px';
        sidebarFrame.style.width = patch.sidebarBounds.width + 'px';
        sidebarFrame.style.height = patch.sidebarBounds.height + 'px';
        sidebarFrame.style.display = 'block';
    } else {
        sidebarFrame.style.display = 'none';
    }
}

function positionActions(rect) {
    if (!actions) return;
    const actionWidth = 140;
    const left = Math.max(6, Math.min(currentCanvasW - actionWidth - 6, rect.x));
    const below = rect.y + rect.height + 8;
    const top = below + 114 < currentCanvasH ? below : Math.max(6, rect.y - 118);
    actions.style.left = left + 'px';
    actions.style.top = top + 'px';
    actions.classList.add('co-visible');
}

function showSelection(rect, complete, animate) {
    if (!selection) return;
    selection.style.left = rect.x + 'px';
    selection.style.top = rect.y + 'px';
    selection.style.width = rect.width + 'px';
    selection.style.height = rect.height + 'px';
    selection.classList.toggle('co-lens-selection--complete', complete === true);
    selection.classList.toggle('co-lens-selection--animate', complete === true && animate === true);
    selection.classList.add('co-visible');
    positionActions(rect);
}

function showCopyToast() {
    if (!copyToast) return;
    const absCanvasX = currentContainer.x + currentCanvasX;
    const absCanvasY = currentContainer.y + currentCanvasY;
    const actionsLeft = actions ? Number.parseFloat(actions.style.left) || 0 : 0;
    const actionsTop = actions ? Number.parseFloat(actions.style.top) || 0 : 0;
    copyToast.style.left = Math.max(currentContainer.x + 6, absCanvasX + actionsLeft) + 'px';
    copyToast.style.top = Math.max(currentContainer.y + 6, absCanvasY + actionsTop - 36) + 'px';
    copyToast.classList.add('co-visible');
    if (copyToastTimer) clearTimeout(copyToastTimer);
    copyToastTimer = setTimeout(() => {
        copyToast.classList.remove('co-visible');
        copyToastTimer = null;
    }, 1600);
}

function hideLensCursorAids() {
    lastPointerX = null;
    lastPointerY = null;
    if (magnifier) magnifier.classList.remove('co-visible');
}

function moveCursorTooltipAndMagnifier(clientX, clientY) {
    lastPointerX = clientX;
    lastPointerY = clientY;
    const absCanvasX = currentContainer.x + currentCanvasX;
    const absCanvasY = currentContainer.y + currentCanvasY;
    const inCanvas = clientX >= absCanvasX && clientX <= absCanvasX + currentCanvasW &&
                     clientY >= absCanvasY && clientY <= absCanvasY + currentCanvasH;

    if (!inCanvas) {
        hideLensCursorAids();
        return;
    }

    // Never show magnifier or tooltip when near or hovering over the close/exit button
    if (exitBtn) {
        const btnRect = exitBtn.getBoundingClientRect();
        const buffer = 20;
        if (clientX >= btnRect.left - buffer && clientX <= btnRect.right + buffer &&
            clientY >= btnRect.top - buffer && clientY <= btnRect.bottom + buffer) {
            hideLensCursorAids();
            return;
        }
    }

    const hitEl = document.elementFromPoint(clientX, clientY);
    if (hitEl && (hitEl.closest?.('.co-lens-exit-btn') || hitEl.closest?.('.co-lens-actions'))) {
        hideLensCursorAids();
        return;
    }

    if (magnifier && cachedSnapshotDataUrl && !isDragging) {
        const zoom = LENS_MAGNIFIER_ZOOM;
        const radius = LENS_MAGNIFIER_RADIUS;
        const relX = clientX - absCanvasX;
        const relY = clientY - absCanvasY;

        magnifier.style.transform = `translate3d(${Math.round(clientX - radius)}px, ${Math.round(clientY - radius)}px, 0)`;
        magnifier.style.backgroundPosition = Math.round(radius - (relX * zoom)) + 'px ' + Math.round(radius - (relY * zoom)) + 'px';
        magnifier.classList.add('co-visible');
    } else if (magnifier) {
        magnifier.classList.remove('co-visible');
    }
}

function updateSelection(x, y) {
    const left = Math.max(0, Math.min(startX, x));
    const top = Math.max(0, Math.min(startY, y));
    const right = Math.min(currentCanvasW, Math.max(startX, x));
    const bottom = Math.min(currentCanvasH, Math.max(startY, y));
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    currentRect = { x: left, y: top, width, height };
    selectedRatio = null;
    showSelection(currentRect, false);
    if (actions) actions.classList.remove('co-visible');
}

export function renderLensSelection(patch) {
    const { container, panelRadius, canvasW, canvasH, canvasX, canvasY } = computeGeometry(patch);
    currentContainer = container;
    currentCanvasW = canvasW;
    currentCanvasH = canvasH;
    currentCanvasX = canvasX;
    currentCanvasY = canvasY;

    if (patch.snapshotDataUrl && patch.snapshotDataUrl !== cachedSnapshotDataUrl) {
        cachedSnapshotDataUrl = patch.snapshotDataUrl;
    }

    if (patch.selectionRatio && typeof patch.selectionRatio === 'object') {
        selectedRatio = {
            x: Math.max(0, Math.min(1, Number(patch.selectionRatio.x) || 0)),
            y: Math.max(0, Math.min(1, Number(patch.selectionRatio.y) || 0)),
            width: Math.max(0, Math.min(1, Number(patch.selectionRatio.width) || 0)),
            height: Math.max(0, Math.min(1, Number(patch.selectionRatio.height) || 0)),
        };
    }

    // FAST-PATH: If overlay elements already exist, update geometry instantaneously without DOM reconstruction
    if (lensLayer && lensLayer.parentNode && siteFrame && canvasFrame) {
        siteFrame.style.left = container.x + 'px';
        siteFrame.style.top = container.y + 'px';
        siteFrame.style.width = container.width + 'px';
        siteFrame.style.height = container.height + 'px';
        siteFrame.style.borderRadius = panelRadius + 'px';

        canvasFrame.style.left = canvasX + 'px';
        canvasFrame.style.top = canvasY + 'px';
        canvasFrame.style.width = canvasW + 'px';
        canvasFrame.style.height = canvasH + 'px';

        if (sharpImg && cachedSnapshotDataUrl && sharpImg.src !== cachedSnapshotDataUrl) {
            sharpImg.src = cachedSnapshotDataUrl;
        }
        if (bgBlurImg && cachedSnapshotDataUrl && bgBlurImg.src !== cachedSnapshotDataUrl) {
            bgBlurImg.src = cachedSnapshotDataUrl;
        }
        if (magnifier) {
            const nextBgW = Math.round(canvasW * LENS_MAGNIFIER_ZOOM);
            const nextBgH = Math.round(canvasH * LENS_MAGNIFIER_ZOOM);
            const nextBgSize = `${nextBgW}px ${nextBgH}px`;
            if (magnifier.style.backgroundSize !== nextBgSize) {
                magnifier.style.backgroundSize = nextBgSize;
            }
            if (cachedSnapshotDataUrl) {
                const bgUrl = 'url("' + cachedSnapshotDataUrl.replace(/"/g, '\\"') + '")';
                if (magnifier.style.backgroundImage !== bgUrl) {
                    magnifier.style.backgroundImage = bgUrl;
                }
            }
            if (lastPointerX !== null && lastPointerY !== null && magnifier.classList.contains('co-visible')) {
                moveCursorTooltipAndMagnifier(lastPointerX, lastPointerY);
            }
        }

        if (chip) {
            chip.style.left = Math.round(canvasW / 2) + 'px';
            if (patch.hasSelection || selectedRatio) chip.classList.add('co-hidden');
            else chip.classList.remove('co-hidden');
        }

        if (selectedRatio && selectedRatio.width > 0 && selectedRatio.height > 0) {
            const r = {
                x: Math.round(selectedRatio.x * canvasW),
                y: Math.round(selectedRatio.y * canvasH),
                width: Math.max(8, Math.round(selectedRatio.width * canvasW)),
                height: Math.max(8, Math.round(selectedRatio.height * canvasH)),
            };
            showSelection(r, true, false);
        }

        if (sidebarFrame) {
            updateSidebarFrame(patch);
        }
        return;
    }

    // INITIAL RENDER: Create DOM structure matching Chrome's Lens UI
    hideAll({ hideLens: true });

    lensLayer = document.createElement('div');
    lensLayer.className = 'co-lens-layer';
    lensLayer.setAttribute('role', 'application');
    lensLayer.setAttribute('aria-label', 'Search with Google Lens selection area');

    // Left Section Card Frame (with overflow: hidden to prevent ANY child spillover)
    siteFrame = document.createElement('div');
    siteFrame.className = 'co-lens-site-frame';
    siteFrame.style.left = container.x + 'px';
    siteFrame.style.top = container.y + 'px';
    siteFrame.style.width = container.width + 'px';
    siteFrame.style.height = container.height + 'px';
    siteFrame.style.borderRadius = panelRadius + 'px';

    // 1. Chrome-like Blurred Cover Background Image
    bgBlurImg = document.createElement('img');
    bgBlurImg.className = 'co-lens-cover-blur';
    bgBlurImg.alt = '';
    if (cachedSnapshotDataUrl) {
        bgBlurImg.src = cachedSnapshotDataUrl;
    }
    siteFrame.appendChild(bgBlurImg);

    // Subtle dark contrast overlay
    bgOverlay = document.createElement('div');
    bgOverlay.className = 'co-lens-cover-overlay';
    siteFrame.appendChild(bgOverlay);

    // 2. Aspect-Ratio Preserving Foreground Canvas Frame
    canvasFrame = document.createElement('div');
    canvasFrame.className = 'co-lens-canvas-frame';
    canvasFrame.style.left = canvasX + 'px';
    canvasFrame.style.top = canvasY + 'px';
    canvasFrame.style.width = canvasW + 'px';
    canvasFrame.style.height = canvasH + 'px';

    sharpImg = document.createElement('img');
    sharpImg.className = 'co-lens-sharp-image';
    sharpImg.alt = '';
    if (cachedSnapshotDataUrl) {
        sharpImg.src = cachedSnapshotDataUrl;
    }
    canvasFrame.appendChild(sharpImg);

    // Chrome-like Exit Lens Button in canvas corner
    exitBtn = document.createElement('button');
    exitBtn.className = 'co-lens-exit-btn';
    exitBtn.type = 'button';
    exitBtn.title = 'Click to exit Google Lens';
    exitBtn.setAttribute('aria-label', 'Exit Google Lens');
    exitBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    canvasFrame.appendChild(exitBtn);

    // Instruction chip
    chip = document.createElement('div');
    chip.className = 'co-lens-chip';
    if (patch.hasSelection) chip.classList.add('co-hidden');
    chip.textContent = patch.hint || 'Select any text or image to search with Google Lens';
    chip.style.left = Math.round(canvasW / 2) + 'px';
    chip.style.top = '16px';
    canvasFrame.appendChild(chip);

    // Selection mask & Selection box (inside canvasFrame)
    selectionMask = document.createElement('div');
    selectionMask.className = 'co-lens-selection-mask';
    canvasFrame.appendChild(selectionMask);

    selection = document.createElement('div');
    selection.className = 'co-lens-selection';
    ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
        const cornerEl = document.createElement('div');
        cornerEl.className = 'co-lens-selection-corner co-lens-selection-corner--' + corner;
        selection.appendChild(cornerEl);
    });
    selectionMask.appendChild(selection);

    // Actions Menu (Copy text, Translate, Copy as image)
    actions = document.createElement('div');
    actions.className = 'co-lens-actions';
    const copyTextIcon = 'assets/images/poll-h.svg';
    const copyImageIcon = 'assets/images/picture.svg';
    actions.innerHTML = (patch.hasSelectionText
        ? '<button class="co-lens-action" type="button" data-action="copyText"><img class="co-lens-action-icon" src="' + copyTextIcon + '" alt="">Copy text</button>'
        : '') +
        '<button class="co-lens-action" type="button" data-action="translate"><svg class="co-lens-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>Translate</button>' +
        '<button class="co-lens-action" type="button" data-action="copyImage"><img class="co-lens-action-icon" src="' + copyImageIcon + '" alt="">Copy as image</button>';
    canvasFrame.appendChild(actions);

    siteFrame.appendChild(canvasFrame);
    lensLayer.appendChild(siteFrame);

    // 3. Magnifier, Tooltip, and Toast (overlay layer)
    magnifier = document.createElement('div');
    magnifier.className = 'co-lens-magnifier';
    magnifier.style.backgroundSize = Math.round(canvasW * LENS_MAGNIFIER_ZOOM) + 'px ' + Math.round(canvasH * LENS_MAGNIFIER_ZOOM) + 'px';
    if (cachedSnapshotDataUrl) {
        magnifier.style.backgroundImage = 'url("' + cachedSnapshotDataUrl.replace(/"/g, '\\"') + '")';
    }
    lensLayer.appendChild(magnifier);

    copyToast = document.createElement('div');
    copyToast.className = 'co-lens-copy-toast';
    copyToast.textContent = 'Copied';
    lensLayer.appendChild(copyToast);

    sidebarFrame = document.createElement('div');
    sidebarFrame.className = 'co-lens-sidebar-card-border';
    updateSidebarFrame(patch);
    lensLayer.appendChild(sidebarFrame);

    // Event Listeners
    exitBtn.addEventListener('pointerenter', () => hideLensCursorAids());
    exitBtn.addEventListener('pointerover', () => hideLensCursorAids());
    exitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    exitBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    exitBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hideLensCursorAids();
        notifyHost({ type: 'lensSelectionCancel', closeSidebar: true });
    });

    lensLayer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest?.('.co-lens-actions') || event.target.closest?.('.co-lens-exit-btn')) return;

        const absCanvasX = currentContainer.x + currentCanvasX;
        const absCanvasY = currentContainer.y + currentCanvasY;
        if (event.clientX < absCanvasX || event.clientX > absCanvasX + currentCanvasW ||
            event.clientY < absCanvasY || event.clientY > absCanvasY + currentCanvasH) {
            return;
        }

        isDragging = true;
        selectionStarted = true;
        if (chip) chip.classList.add('co-hidden');
        hideLensCursorAids();

        lensPointerId = event.pointerId;
        lensLayer.setPointerCapture(lensPointerId);

        startX = Math.max(0, Math.min(currentCanvasW, event.clientX - absCanvasX));
        startY = Math.max(0, Math.min(currentCanvasH, event.clientY - absCanvasY));
        currentRect = null;
        if (actions) actions.classList.remove('co-visible');
        if (selection) selection.classList.remove('co-visible', 'co-lens-selection--complete', 'co-lens-selection--animate');
        lensLayer.classList.add('co-lens-layer--dragging');
        updateSelection(startX, startY);
    });

    lensLayer.addEventListener('pointermove', (event) => {
        if (isDragging && lensPointerId === event.pointerId) {
            const absCanvasX = currentContainer.x + currentCanvasX;
            const absCanvasY = currentContainer.y + currentCanvasY;
            const relX = Math.max(0, Math.min(currentCanvasW, event.clientX - absCanvasX));
            const relY = Math.max(0, Math.min(currentCanvasH, event.clientY - absCanvasY));
            updateSelection(relX, relY);
        } else {
            moveCursorTooltipAndMagnifier(event.clientX, event.clientY);
        }
    });

    lensLayer.addEventListener('pointerup', (event) => {
        if (lensPointerId !== event.pointerId) return;
        try { lensLayer.releasePointerCapture(lensPointerId); } catch (_) { }
        lensPointerId = null;
        isDragging = false;
        lensLayer.classList.remove('co-lens-layer--dragging');

        let targetRect = currentRect;
        if (!targetRect || targetRect.width < 8 || targetRect.height < 8) {
            // Tap / single-click fallback: create an adaptive focus box around the clicked point
            const boxW = Math.min(currentCanvasW, Math.max(120, Math.round(currentCanvasW * 0.22)));
            const boxH = Math.min(currentCanvasH, Math.max(90, Math.round(currentCanvasH * 0.18)));
            const boxX = Math.max(0, Math.min(currentCanvasW - boxW, Math.round(startX - boxW / 2)));
            const boxY = Math.max(0, Math.min(currentCanvasH - boxH, Math.round(startY - boxH / 2)));
            targetRect = {
                x: boxX,
                y: boxY,
                width: boxW,
                height: boxH,
            };
        }

        currentRect = targetRect;
        selectedRatio = {
            x: currentRect.x / currentCanvasW,
            y: currentRect.y / currentCanvasH,
            width: currentRect.width / currentCanvasW,
            height: currentRect.height / currentCanvasH,
        };
        showSelection(currentRect, true, true);
        notifyHost({
            type: 'lensSelectionCapture',
            ratio: selectedRatio,
            rect: {
                x: Math.round(selectedRatio.x * currentCanvasW),
                y: Math.round(selectedRatio.y * currentCanvasH),
                width: Math.round(selectedRatio.width * currentCanvasW),
                height: Math.round(selectedRatio.height * currentCanvasH),
            },
        });
        moveCursorTooltipAndMagnifier(event.clientX, event.clientY);
    });

    lensLayer.addEventListener('pointerenter', (event) => {
        moveCursorTooltipAndMagnifier(event.clientX, event.clientY);
    });

    lensLayer.addEventListener('pointerleave', () => {
        hideLensCursorAids();
    });

    lensLayer.addEventListener('pointercancel', (event) => {
        if (lensPointerId !== event.pointerId) return;
        lensPointerId = null;
        isDragging = false;
        lensLayer.classList.remove('co-lens-layer--dragging');
        if (selection) selection.classList.remove('co-visible', 'co-lens-selection--complete', 'co-lens-selection--animate');
        currentRect = null;
    });

    actions.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'copyImage') {
            notifyHost({ type: 'lensCopyImage' });
            showCopyToast();
        } else if (action === 'copyText') {
            notifyHost({ type: 'lensCopyText' });
            showCopyToast();
        } else if (action === 'translate') {
            notifyHost({ type: 'lensTranslate' });
        }
    });

    if (selectedRatio && selectedRatio.width > 0 && selectedRatio.height > 0) {
        showSelection({
            x: Math.round(selectedRatio.x * canvasW),
            y: Math.round(selectedRatio.y * canvasH),
            width: Math.max(8, Math.round(selectedRatio.width * canvasW)),
            height: Math.max(8, Math.round(selectedRatio.height * canvasH)),
        }, true, false);
    } else if (patch.selectionRect && patch.hasSelection) {
        showSelection({
            x: Math.max(0, Number(patch.selectionRect.x) || 0),
            y: Math.max(0, Number(patch.selectionRect.y) || 0),
            width: Math.max(8, Number(patch.selectionRect.width) || 8),
            height: Math.max(8, Number(patch.selectionRect.height) || 8),
        }, true, false);
    }

    document.body.appendChild(lensLayer);
}