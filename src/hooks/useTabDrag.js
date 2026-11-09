import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

function isTransparentDragBackground(bg) {
  if (!bg) return true;
  const normalized = bg.trim().toLowerCase();
  return (
    normalized === 'transparent'
    || normalized === 'rgba(0, 0, 0, 0)'
    || normalized === 'rgba(0,0,0,0)'
  );
}

function isStealthTabChrome(tabEl) {
  return !!tabEl.closest('.header--stealth-window');
}

function readChromeCssVar(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || '';
}

/**
 * Match the tab's visible fill: use computed background when set (e.g. hover),
 * otherwise the active slider token (active tabs are transparent over the slider).
 */
function resolveTabDragBackgroundColor(tabEl) {
  const computed = window.getComputedStyle(tabEl).backgroundColor;
  if (!isTransparentDragBackground(computed)) {
    return computed;
  }

  const sliderToken = isStealthTabChrome(tabEl)
    ? '--chrome-slider-stealth'
    : '--chrome-slider';
  const fromToken = readChromeCssVar(sliderToken);
  if (fromToken) return fromToken;

  const headerBg = readChromeCssVar('--chrome-header-bg');
  if (headerBg) return headerBg;

  return computed;
}

/**
 * DSA Optimization: Binary search helpers for finding target tab index.
 * Since tab centers along the strip are strictly monotonically increasing,
 * we can locate the crossed tab center in O(log N) steps.
 */
function findLeftTargetIndex(tabCenters, low, high, currentTabLeft) {
  let result = high + 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (currentTabLeft < tabCenters[mid]) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

function findRightTargetIndex(tabCenters, low, high, currentTabRight) {
  let result = low - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (currentTabRight > tabCenters[mid]) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/**
 * High-performance pointer-based tab drag hook.
 *
 * Performance & Memory optimizations:
 * 1. Coalesces pointermove events with requestAnimationFrame (caps work to 60/120Hz display refresh).
 * 2. Uses O(log N) binary search on cached Float64Array tab centers instead of linear array scans.
 * 3. Uses Int8Array shift diffing to only touch DOM elements whose transform direction actually changed.
 * 4. Eliminates forced synchronous layout thrashing (document.elementFromPoint) via pre-cached group intervals.
 * 5. Uses hardware-accelerated translate3d transforms.
 * 6. Smooth drop animation snaps the tab directly into place, followed by atomic flushSync handoff
 *    and instant transform clearance in the same render frame, eliminating all visual flicker.
 *
 * @param {object} opts
 * @param {string}   opts.id          - This tab's Redux ID
 * @param {Function} opts.onSwitchTab - Switch to this tab on click
 * @param {Function} opts.onDragEnd   - Called with new ordered ID array on drop
 * @param {Function} opts.onHideTooltip
 * @param {boolean}  [opts.isPinned] - pinned tabs cannot be dragged
 * @param {number}   [opts.pinnedTabCount] - unpinned tabs cannot move left of this index
 * @param {boolean}  [opts.isActive] - if true, pointer tap does not call onSwitchTab (no redundant switch)
 * @returns {React.RefObject} ref – attach to the <div className="tab"> element
 */
export function useTabDrag({
  id,
  tab,
  splitPair,
  rightTab,
  onSwitchTab,
  onDragEnd,
  onHideTooltip,
  isPinned = false,
  pinnedTabCount = 0,
  isActive = false,
  tabCount = 1,
  onDetachTab,
  onGetFallbackTabId,
}) {
  const tabRef = useRef(null);

  // Keep stable refs to callbacks so the effect never needs to re-run
  const cbRef = useRef({});
  cbRef.current = { tab, splitPair, rightTab, onSwitchTab, onDragEnd, onHideTooltip, isPinned, pinnedTabCount, isActive, tabCount, onDetachTab, onGetFallbackTabId };

  useEffect(() => {
    const tabEl = tabRef.current;
    if (!tabEl) return;

    let dropTimer = null;
    let moveRafId = null;
    let detachRafId = null;
    let slotBar = null;

    const handlePointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.close-btn')) return;

      if (!cbRef.current.isActive) {
        cbRef.current.onSwitchTab(id);
      }
      cbRef.current.onHideTooltip();

      if (cbRef.current.isPinned) return;

      const pointerId = e.pointerId;

      let dragStarted = false;
      let isDetached = false;
      let isDropping = false;

      const startX = e.clientX;
      const startY = e.clientY;
      const initialTabRect = tabEl.getBoundingClientRect();
      const grabOffsetX = Math.max(0, e.clientX - initialTabRect.left);
      const grabOffsetY = Math.max(0, e.clientY - initialTabRect.top);
      const tabWidth = initialTabRect.width;
      let offsetX = 0;

      let originalTabs = [];
      let originalRects = [];
      let tabCenters = null;
      let tabShifts = null;
      let draggingIndex = -1;
      let finalTargetIndex = -1;
      let dragDx = 0;
      let dragBackgroundColor = '';
      let hoveredGroupId = null;
      let groupRegions = [];
      let bar = null;
      let draggingGid = null;
      let draggedWidthWithGap = 0;
      let boundsLeft = 0;
      let boundsRight = 0;

      let latestClientX = startX;
      let latestClientY = startY;
      let latestScreenX = e.screenX;
      let latestScreenY = e.screenY;

      const startDrag = (me) => {
        dragStarted = true;
        try {
          tabEl.setPointerCapture(pointerId);
        } catch (_) {}

        bar = tabEl.closest('.tab-bar');
        originalTabs = Array.from(bar.querySelectorAll('.tab'));
        const count = originalTabs.length;
        originalRects = originalTabs.map((t) => t.getBoundingClientRect());
        tabCenters = new Float64Array(count);
        tabShifts = new Int8Array(count);

        for (let i = 0; i < count; i++) {
          tabCenters[i] = originalRects[i].left + originalRects[i].width * 0.5;
        }

        draggingIndex = originalTabs.indexOf(tabEl);
        finalTargetIndex = draggingIndex;

        const rect = originalRects[draggingIndex] || initialTabRect;
        draggedWidthWithGap = (rect.width || tabWidth) + 5;
        offsetX = me.clientX - rect.left;

        const container = tabEl.closest('.tab-container');
        const boundsRect = container ? container.getBoundingClientRect() : bar.getBoundingClientRect();
        boundsLeft = boundsRect.left;
        boundsRight = boundsRect.right;

        bar.classList.add('tab-bar--dragging');
        tabEl.classList.add('tab-dragging');
        tabEl.style.zIndex = '9999';
        dragBackgroundColor = resolveTabDragBackgroundColor(tabEl);
        tabEl.style.backgroundColor = dragBackgroundColor;
        window._draggingTabId = id;

        // Continuous bottom border placeholder on empty area during drag within group
        draggingGid = tabEl.getAttribute('data-group-id');
        const groupColor = tabEl.style.getPropertyValue('--group-color') || '#1a73e8';
        const track = tabEl.closest('.tab-track');
        if (draggingGid && track) {
          const sampleTab = bar.querySelector(`.tab[data-group-id="${draggingGid}"]`) || tabEl;
          const tabR = sampleTab.getBoundingClientRect();
          const trackRect = track.getBoundingClientRect();
          const baselineTopInTrack = (tabR.bottom - 3) - trackRect.top;

          slotBar = document.createElement('div');
          slotBar.className = 'tab-group-drag-placeholder-bar';
          slotBar.style.backgroundColor = groupColor;
          slotBar.style.transition = 'none';

          const chipWrapper = bar.querySelector(`.group-chip-wrapper[data-group-id="${draggingGid}"]`);
          const chipRect = chipWrapper ? chipWrapper.getBoundingClientRect() : null;
          const memberTabs = originalTabs.filter(t => t.getAttribute('data-group-id') === draggingGid);
          const firstMemberIndex = memberTabs.length > 0 ? originalTabs.indexOf(memberTabs[0]) : 0;
          const isFirstGroupSlot = draggingIndex <= firstMemberIndex;

          let initLeft, initWidth;
          if (isFirstGroupSlot && chipRect) {
            initLeft = (chipRect.right - trackRect.left) - 2;
            initWidth = (rect.right + 5) - (chipRect.right - 2);
          } else {
            initLeft = rect.left - trackRect.left;
            initWidth = rect.width + 5;
          }

          slotBar.style.left = `${initLeft}px`;
          slotBar.style.width = `${initWidth}px`;
          slotBar.style.top = `${baselineTopInTrack}px`;
          slotBar.style.height = '2px';
          slotBar.style.bottom = 'auto';
          track.appendChild(slotBar);
        }

        // Cache expanded group regions along the tab strip (with chip boundaries)
        groupRegions = [];
        const groupChips = bar.querySelectorAll('.group-chip-wrapper:not(.group-chip-wrapper--collapsed)');
        groupChips.forEach((chipWrapper) => {
          const gid = chipWrapper.querySelector('.group-chip')?.getAttribute('data-group-id') || chipWrapper.getAttribute('data-group-id');
          if (!gid) return;
          const chipRect = chipWrapper.getBoundingClientRect();
          const memberTabs = originalTabs.filter(t => t.getAttribute('data-group-id') === gid);
          if (memberTabs.length > 0) {
            const firstRect = memberTabs[0].getBoundingClientRect();
            const lastRect = memberTabs[memberTabs.length - 1].getBoundingClientRect();
            groupRegions.push({
              groupId: gid,
              left: Math.min(chipRect.left, firstRect.left),
              right: lastRect.right + 10,
              chipLeft: chipRect.left,
              chipRight: chipRect.right,
              firstMemberIndex: originalTabs.indexOf(memberTabs[0]),
              lastMemberIndex: originalTabs.indexOf(memberTabs[memberTabs.length - 1]),
            });
          } else {
            groupRegions.push({
              groupId: gid,
              left: chipRect.left - 5,
              right: chipRect.right + 10,
              chipLeft: chipRect.left,
              chipRight: chipRect.right,
              firstMemberIndex: 0,
              lastMemberIndex: 0,
            });
          }
        });
      };

      const updateDrag = () => {
        moveRafId = null;
        if (isDetached || isDropping) return;

        const deltaY = latestClientY - startY;

        // Vertical detachment threshold (35px)
        if (Math.abs(deltaY) > 35) {
          isDetached = true;

          if (slotBar) {
            slotBar.remove();
            slotBar = null;
          }

          originalTabs.forEach((t) => {
            t.style.transform = '';
            t.style.transition = '';
            t.style.zIndex = '';
          });
          tabEl.classList.remove('tab-dragging');
          tabEl.style.backgroundColor = '';
          if (bar) bar.classList.remove('tab-bar--dragging');

          const count = cbRef.current.tabCount ?? originalTabs.length;
          const isSingle = count <= 1;
          const currentTab = cbRef.current.tab;
          const currentSplitPair = cbRef.current.splitPair;
          const currentRightTab = cbRef.current.rightTab;
          const fallbackTabId = cbRef.current.onGetFallbackTabId?.(id, currentSplitPair) || null;

          window.electronAPI?.tabDragDetach?.({
            tabId: id,
            fallbackTabId,
            screenX: latestScreenX,
            screenY: latestScreenY,
            grabOffsetX,
            grabOffsetY,
            tabWidth,
            isSingleTab: isSingle,
            tabData: currentTab ? {
              url: currentTab.url,
              title: currentTab.title,
              favicon: currentTab.favicon || null,
              isLoading: !!currentTab.isLoading,
              groupId: currentTab.groupId || null,
            } : undefined,
            splitPair: currentSplitPair ? { ...currentSplitPair } : undefined,
            rightTabData: currentRightTab ? {
              url: currentRightTab.url,
              title: currentRightTab.title,
              favicon: currentRightTab.favicon || null,
              isLoading: !!currentRightTab.isLoading,
            } : undefined,
          });

          if (!isSingle) {
            cbRef.current.onDetachTab?.(id, currentSplitPair);
          }
          return;
        }

        // Constrain to tab container bounds
        const tabW = originalRects[draggingIndex]?.width || tabWidth;
        const newX = Math.max(boundsLeft, Math.min(latestClientX - offsetX, boundsRight - tabW));
        dragDx = newX - (originalRects[draggingIndex]?.left || initialTabRect.left);
        const currentTabLeft = newX;
        const currentTabRight = newX + tabW;

        // Apply hardware-accelerated transform to dragged tab
        tabEl.style.transform = `translate3d(${dragDx}px, 0, 0)`;

        // DSA Binary Search to find target slot index
        let targetIndex = draggingIndex;
        if (draggingIndex > 0 && currentTabLeft < tabCenters[draggingIndex - 1]) {
          targetIndex = findLeftTargetIndex(tabCenters, 0, draggingIndex - 1, currentTabLeft);
        } else if (draggingIndex < originalTabs.length - 1 && currentTabRight > tabCenters[draggingIndex + 1]) {
          targetIndex = findRightTargetIndex(tabCenters, draggingIndex + 1, originalTabs.length - 1, currentTabRight);
        }

        // Check expanded group regions (pure arithmetic, zero forced layout hit-testing!)
        hoveredGroupId = null;
        for (let r = 0; r < groupRegions.length; r++) {
          const region = groupRegions[r];
          const overlap = Math.max(0, Math.min(currentTabRight, region.right) - Math.max(currentTabLeft, region.left));
          if (overlap > 12 || (latestClientX >= region.left && latestClientX <= region.right)) {
            hoveredGroupId = region.groupId;
            if (latestClientX >= region.chipLeft && latestClientX <= region.chipRight) {
              targetIndex = region.firstMemberIndex;
            } else if (currentTabRight < region.left + 50 || latestClientX < region.left + 50) {
              targetIndex = region.firstMemberIndex;
            }
            break;
          }
        }

        const pinCount = cbRef.current.pinnedTabCount || 0;
        if (pinCount > 0 && !cbRef.current.isPinned) {
          targetIndex = Math.max(pinCount, targetIndex);
        }
        finalTargetIndex = targetIndex;

        // Keep empty area under dragging tab connected with bottom border (no lag)
        if (slotBar) {
          const track = tabEl.closest('.tab-track');
          if (track) {
            const trackRect = track.getBoundingClientRect();
            const currentSlotIndex = (targetIndex >= 0 && targetIndex < originalRects.length)
              ? targetIndex
              : draggingIndex;
            const slotRect = originalRects[currentSlotIndex] || initialTabRect;

            const chipWrapper = bar.querySelector(`.group-chip-wrapper[data-group-id="${draggingGid}"]`);
            const chipRect = chipWrapper ? chipWrapper.getBoundingClientRect() : null;
            const memberTabs = originalTabs.filter(t => t.getAttribute('data-group-id') === draggingGid);
            const firstMemberIndex = memberTabs.length > 0 ? originalTabs.indexOf(memberTabs[0]) : 0;
            const isFirstGroupSlot = currentSlotIndex <= firstMemberIndex;

            let slotLeft, slotWidth;
            if (isFirstGroupSlot && chipRect) {
              slotLeft = (chipRect.right - trackRect.left) - 2;
              slotWidth = (slotRect.right + 5) - (chipRect.right - 2);
            } else {
              slotLeft = slotRect.left - trackRect.left;
              slotWidth = slotRect.width + 5;
            }

            slotBar.style.left = `${slotLeft}px`;
            slotBar.style.width = `${slotWidth}px`;
          }
        }

        // Minimal DOM update: diff shift states and update only modified sibling tabs
        for (let i = 0; i < originalTabs.length; i++) {
          if (i === draggingIndex) continue;
          let desired = 0;
          if (targetIndex < draggingIndex && i >= targetIndex && i < draggingIndex) {
            desired = 1;
          } else if (targetIndex > draggingIndex && i > draggingIndex && i <= targetIndex) {
            desired = -1;
          }
          if (tabShifts[i] !== desired) {
            tabShifts[i] = desired;
            originalTabs[i].style.transform = desired === 0
              ? ''
              : (desired > 0 ? `translate3d(${draggedWidthWithGap}px, 0, 0)` : `translate3d(-${draggedWidthWithGap}px, 0, 0)`);
          }
        }
      };

      const onMove = (me) => {
        if (isDropping) return;

        if (isDetached) {
          if (!detachRafId) {
            const sx = me.screenX;
            const sy = me.screenY;
            detachRafId = requestAnimationFrame(() => {
              detachRafId = null;
              window.electronAPI?.tabDragMove?.({ screenX: sx, screenY: sy });
            });
          }
          return;
        }

        const deltaX = me.clientX - startX;
        const deltaY = me.clientY - startY;

        if (!dragStarted) {
          if (Math.hypot(deltaX, deltaY) < 6) return; // dead-zone
          startDrag(me);
        }

        latestClientX = me.clientX;
        latestClientY = me.clientY;
        latestScreenX = me.screenX;
        latestScreenY = me.screenY;

        if (!moveRafId) {
          moveRafId = requestAnimationFrame(updateDrag);
        }
      };

      const onUp = (me) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        try {
          tabEl.releasePointerCapture(pointerId);
        } catch (_) {}

        if (moveRafId) {
          cancelAnimationFrame(moveRafId);
          moveRafId = null;
        }
        if (detachRafId) {
          cancelAnimationFrame(detachRafId);
          detachRafId = null;
        }

        if (isDetached) {
          window.electronAPI?.tabDragEnd?.({
            screenX: me?.screenX || 0,
            screenY: me?.screenY || 0,
          });
          window._draggingTabId = null;
          return;
        }

        if (!dragStarted) {
          return;
        }

        isDropping = true;

        let dropGroupId = hoveredGroupId;
        if (!dropGroupId) {
          const currentTabLeft = (tabEl.getBoundingClientRect?.()?.left) || 0;
          const currentTabRight = currentTabLeft + (originalRects[draggingIndex]?.width || tabWidth);
          for (const region of groupRegions) {
            const overlap = Math.max(0, Math.min(currentTabRight, region.right) - Math.max(currentTabLeft, region.left));
            if (overlap > 12 || (me?.clientX >= region.left && me?.clientX <= region.right)) {
              dropGroupId = region.groupId;
              break;
            }
          }
        }

        // If joining a group, ensure target index is within/adjacent to that group's members
        if (dropGroupId) {
          const targetRegion = groupRegions.find(r => r.groupId === dropGroupId);
          if (targetRegion) {
            if (finalTargetIndex < targetRegion.firstMemberIndex) {
              finalTargetIndex = targetRegion.firstMemberIndex;
            } else if (finalTargetIndex > targetRegion.lastMemberIndex + 1) {
              finalTargetIndex = targetRegion.lastMemberIndex + 1;
            }
          }
        }

        const currentTabGroupId = tabEl.getAttribute('data-group-id') || null;
        const isGroupChange = dropGroupId && dropGroupId !== currentTabGroupId;
        const didReorder = (finalTargetIndex !== -1 && finalTargetIndex !== draggingIndex) || isGroupChange;

        // Calculate exact target offset in pixels
        let targetDx = 0;
        if (didReorder && finalTargetIndex >= 0 && finalTargetIndex < originalRects.length) {
          if (finalTargetIndex > draggingIndex) {
            targetDx = (originalRects[finalTargetIndex].right - originalRects[draggingIndex].width) - originalRects[draggingIndex].left;
          } else if (finalTargetIndex < draggingIndex) {
            targetDx = originalRects[finalTargetIndex].left - originalRects[draggingIndex].left;
          }
        }

        // Dynamic duration based on remaining distance to travel (e.g. 90ms - 150ms)
        const distance = Math.abs(targetDx - dragDx);
        const duration = Math.min(150, Math.max(90, Math.round(distance * 0.4)));

        // Smooth drop snap animation
        tabEl.classList.add('tab-dropping');
        tabEl.style.setProperty('--drop-duration', `${duration}ms`);
        tabEl.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0, 0, 1)`;
        tabEl.style.transform = `translate3d(${targetDx}px, 0, 0)`;

        dropTimer = setTimeout(() => {
          dropTimer = null;
          isDropping = false;

          if (slotBar) {
            slotBar.remove();
            slotBar = null;
          }

          if (!didReorder) {
            originalTabs.forEach((t) => {
              t.style.transform = '';
              t.style.zIndex = '';
              t.style.transition = '';
            });
            tabEl.classList.remove('tab-dragging', 'tab-dropping');
            tabEl.style.backgroundColor = '';
            if (bar) bar.classList.remove('tab-bar--dragging');
            window._draggingTabId = null;
            return;
          }

          // Build new id order and hand off to Redux
          const ids = originalTabs.map((t) => t.id);
          const [moved] = ids.splice(draggingIndex, 1);
          let dropIndex = finalTargetIndex !== -1 ? finalTargetIndex : draggingIndex;
          const pc = cbRef.current.pinnedTabCount || 0;
          if (pc > 0 && !cbRef.current.isPinned) {
            dropIndex = Math.max(pc, dropIndex);
          }
          ids.splice(dropIndex, 0, moved);

          // Disable transitions before React DOM reorder to prevent backward motion
          originalTabs.forEach((t) => {
            t.style.transition = 'none';
          });

          // Synchronously commit to React DOM with flushSync
          flushSync(() => {
            cbRef.current.onDragEnd(ids, { movedTabId: id, targetGroupId: dropGroupId });
          });

          // React has now synchronously reordered the DOM nodes in .tab-track.
          // Instantly clear transforms so new DOM order matches final visual position in the SAME paint frame.
          originalTabs.forEach((t) => {
            t.style.transform = '';
            t.style.zIndex = '';
            t.style.transition = '';
          });
          tabEl.classList.remove('tab-dragging', 'tab-dropping');
          tabEl.style.backgroundColor = '';
          if (bar) bar.classList.remove('tab-bar--dragging');
          window._draggingTabId = null;
        }, duration);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    };

    // Middle-click closes
    const handleMouseDown = (e) => {
      if (e.button === 1) { e.preventDefault(); }
    };

    tabEl.addEventListener('pointerdown', handlePointerDown);
    tabEl.addEventListener('mousedown', handleMouseDown);

    return () => {
      tabEl.removeEventListener('pointerdown', handlePointerDown);
      tabEl.removeEventListener('mousedown', handleMouseDown);
      if (dropTimer) {
        clearTimeout(dropTimer);
        dropTimer = null;
      }
      if (moveRafId) {
        cancelAnimationFrame(moveRafId);
        moveRafId = null;
      }
      if (detachRafId) {
        cancelAnimationFrame(detachRafId);
        detachRafId = null;
      }
      if (slotBar) {
        slotBar.remove();
        slotBar = null;
      }
    };
  }, [id]);

  return tabRef;
}
