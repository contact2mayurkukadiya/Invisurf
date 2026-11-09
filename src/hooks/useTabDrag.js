import { useEffect, useRef } from 'react';

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

function getElementUnderneath(tabEl, clientX, clientY) {
  if (!tabEl) return document.elementFromPoint(clientX, clientY);
  const origPE = tabEl.style.pointerEvents;
  tabEl.style.pointerEvents = 'none';
  const el = document.elementFromPoint(clientX, clientY);
  tabEl.style.pointerEvents = origPE;
  return el;
}

/**
 * Pointer-based tab drag hook.
 * Attaches listeners imperatively to avoid triggering React re-renders
 * during animation. On drop, calls onDragEnd(newTabOrderIds[]).
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
}) {
  const tabRef = useRef(null);

  // Keep stable refs to callbacks so the effect never needs to re-run
  const cbRef = useRef({});
  cbRef.current = { tab, splitPair, rightTab, onSwitchTab, onDragEnd, onHideTooltip, isPinned, pinnedTabCount, isActive, tabCount, onDetachTab };

  useEffect(() => {
    const tabEl = tabRef.current;
    if (!tabEl) return;

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
      let rafId = null;

      const startX = e.clientX;
      const startY = e.clientY;
      const initialTabRect = tabEl.getBoundingClientRect();
      const grabOffsetX = Math.max(0, e.clientX - initialTabRect.left);
      const grabOffsetY = Math.max(0, e.clientY - initialTabRect.top);
      const tabWidth = initialTabRect.width;
      let offsetX = 0;

      let originalTabs = [];
      let originalRects = [];
      let draggingIndex = -1;
      let finalTargetIndex = -1;
      let dragBackgroundColor = '';
      let hoveredGroupId = null;
      let groupRegions = [];
      let slotBar = null;
      let exactBarTop = null;
      let exactBarHeight = 2.5;
      let bar = null;
      let draggingGid = null;

      const onMove = (me) => {
        if (isDetached) {
          if (!rafId) {
            const sx = me.screenX;
            const sy = me.screenY;
            rafId = requestAnimationFrame(() => {
              rafId = null;
              window.electronAPI?.tabDragMove?.({ screenX: sx, screenY: sy });
            });
          }
          return;
        }

        const deltaX = me.clientX - startX;
        const deltaY = me.clientY - startY;

        if (!dragStarted) {
          if (Math.hypot(deltaX, deltaY) < 6) return; // dead-zone
          dragStarted = true;
          try {
            tabEl.setPointerCapture(pointerId);
          } catch (_) {}

          bar = tabEl.closest('.tab-bar');
          originalTabs = Array.from(bar.querySelectorAll('.tab'));
          originalRects = originalTabs.map(t => t.getBoundingClientRect());
          draggingIndex = originalTabs.indexOf(tabEl);
          finalTargetIndex = draggingIndex;
          bar.classList.add('tab-bar--dragging');
          // Disable tab transitions during drag/drop to avoid jitter on cleanup.
          originalTabs.forEach((t) => { t.style.transition = 'none'; });

          const rect = originalRects[draggingIndex] || initialTabRect;
          offsetX = me.clientX - rect.left;
          tabEl.classList.add('tab-dragging');
          dragBackgroundColor = resolveTabDragBackgroundColor(tabEl);
          tabEl.style.backgroundColor = dragBackgroundColor;
          // Flag used by tooltip hover guard
          window._draggingTabId = id;

          // Requirement 3: Continuous bottom border on empty area during drag within group
          draggingGid = tabEl.getAttribute('data-group-id');
          const groupColor = tabEl.style.getPropertyValue('--group-color') || '#1a73e8';
          const track = tabEl.closest('.tab-track');
          if (draggingGid && track) {
            // Find the exact baseline Y position from existing bottom bar or sample tab
            const sampleTab = bar.querySelector(`.tab[data-group-id="${draggingGid}"]`) || tabEl;
            const tabRect = sampleTab.getBoundingClientRect();
            const trackRect = track.getBoundingClientRect();
            const baselineTopInTrack = (tabRect.bottom - 3) - trackRect.top;

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
              // Seamless 2px overlap into chip wrapper right edge to guarantee continuous baseline
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

          // Requirement 4: Cache expanded group regions along the tab strip
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
                firstMemberIndex: originalTabs.indexOf(memberTabs[0]),
                lastMemberIndex: originalTabs.indexOf(memberTabs[memberTabs.length - 1]),
              });
            } else {
              groupRegions.push({
                groupId: gid,
                left: chipRect.left - 5,
                right: chipRect.right + 10,
                firstMemberIndex: 0,
                lastMemberIndex: 0,
              });
            }
          });
        }

        // Check vertical detachment threshold (35px)
        if (!isDetached && Math.abs(deltaY) > 35) {
          isDetached = true;

          if (slotBar) {
            slotBar.remove();
            slotBar = null;
          }

          // Clear transforms on remaining tabs
          originalTabs.forEach((t) => {
            t.style.transform = '';
            t.style.transition = '';
            t.style.zIndex = '';
          });
          tabEl.classList.remove('tab-dragging');
          tabEl.style.backgroundColor = '';
          const barEl = tabEl.closest('.tab-bar');
          if (barEl) barEl.classList.remove('tab-bar--dragging');

          const count = cbRef.current.tabCount ?? originalTabs.length;
          const isSingle = count <= 1;
          const currentTab = cbRef.current.tab;
          const currentSplitPair = cbRef.current.splitPair;
          const currentRightTab = cbRef.current.rightTab;

          window.electronAPI?.tabDragDetach?.({
            tabId: id,
            screenX: me.screenX,
            screenY: me.screenY,
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

        // ── Constrain to tab container bounds ────────────────────────────
        const container = tabEl.closest('.tab-container');
        const boundsRect = container ? container.getBoundingClientRect() : tabEl.closest('.tab-bar').getBoundingClientRect();
        const tabW = originalRects[draggingIndex]?.width || tabWidth;
        const newX = Math.max(boundsRect.left, Math.min(me.clientX - offsetX, boundsRect.right - tabW));
        const dragDx = newX - (originalRects[draggingIndex]?.left || initialTabRect.left);
        const currentTabLeft = newX;
        const currentTabRight = newX + tabW;

        // ── Determine new target index using leading-edge threshold ───────
        let targetIndex = draggingIndex;

        // Moving left: tab's leading edge is currentTabLeft.
        // Switch when currentTabLeft crosses the center of tab i.
        for (let i = 0; i < draggingIndex; i++) {
          const center = originalRects[i].left + originalRects[i].width / 2;
          if (currentTabLeft < center) {
            targetIndex = i;
            break;
          }
        }

        // Moving right: tab's leading edge is currentTabRight.
        // Switch when currentTabRight crosses the center of tab i.
        for (let i = originalTabs.length - 1; i > draggingIndex; i--) {
          const center = originalRects[i].left + originalRects[i].width / 2;
          if (currentTabRight > center) {
            targetIndex = i;
            break;
          }
        }

        // Requirement 4: Check if hovering over any expanded group's area
        // Overlapping a grouped tab even a little bit joins the group
        hoveredGroupId = null;
        for (const region of groupRegions) {
          const overlap = Math.max(0, Math.min(currentTabRight, region.right) - Math.max(currentTabLeft, region.left));
          if (overlap > 12 || (me.clientX >= region.left && me.clientX <= region.right)) {
            hoveredGroupId = region.groupId;
            if (currentTabRight < region.left + 50 || me.clientX < region.left + 50) {
              targetIndex = region.firstMemberIndex;
            }
            break;
          }
        }

        // Check if hovering over an expanded group chip or its child tabs
        const elUnder = getElementUnderneath(tabEl, me.clientX, me.clientY);
        const groupHolder = elUnder?.closest('[data-group-id]');
        if (groupHolder) {
          const isCollapsed = groupHolder.classList.contains('group-chip--collapsed') || groupHolder.classList.contains('group-chip-wrapper--collapsed');
          if (!isCollapsed) {
            const gid = groupHolder.getAttribute('data-group-id');
            if (gid) {
              hoveredGroupId = gid;
              // If hovering over the group chip directly, target the group's first member index
              if (groupHolder.classList.contains('group-chip') || groupHolder.classList.contains('group-chip-wrapper')) {
                const firstMemberIndex = originalTabs.findIndex(t => t.getAttribute('data-group-id') === gid);
                if (firstMemberIndex !== -1) {
                  targetIndex = firstMemberIndex;
                }
              }
            }
          }
        }

        // Requirement 3: Keep empty area under dragging tab connected with bottom border (no animation lag)
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
              // Seamless 2px overlap into chip wrapper right edge to guarantee continuous baseline
              slotLeft = (chipRect.right - trackRect.left) - 2;
              slotWidth = (slotRect.right + 5) - (chipRect.right - 2);
            } else {
              slotLeft = slotRect.left - trackRect.left;
              slotWidth = slotRect.width + 5;
            }

            slotBar.style.transition = 'none';
            slotBar.style.left = `${slotLeft}px`;
            slotBar.style.width = `${slotWidth}px`;
            slotBar.style.bottom = 'auto';
          }
        }

        const pinCount = cbRef.current.pinnedTabCount || 0;
        if (pinCount > 0 && !cbRef.current.isPinned) {
          targetIndex = Math.max(pinCount, targetIndex);
        }
        finalTargetIndex = targetIndex;

        // ── Animate via transform (no DOM reorder during drag) ───────────
        const draggedWidthWithGap = (originalRects[draggingIndex]?.width || tabWidth) + 5;
        originalTabs.forEach((t, i) => {
          if (i === draggingIndex) {
            t.style.transform = `translateX(${dragDx}px)`;
            t.style.zIndex = '9999';
            return;
          }
          if (targetIndex < draggingIndex && i >= targetIndex && i < draggingIndex) {
            t.style.transform = `translateX(${draggedWidthWithGap}px)`;
          } else if (targetIndex > draggingIndex && i > draggingIndex && i <= targetIndex) {
            t.style.transform = `translateX(-${draggedWidthWithGap}px)`;
          } else {
            t.style.transform = '';
          }
        });
      };

      const onUp = (me) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        try {
          tabEl.releasePointerCapture(pointerId);
        } catch (_) {}

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (isDetached) {
          window.electronAPI?.tabDragEnd?.({
            screenX: me?.screenX || 0,
            screenY: me?.screenY || 0,
          });
          window._draggingTabId = null;
          return;
        }

        if (dragStarted) {
          if (slotBar) {
            slotBar.remove();
            slotBar = null;
          }

          let dropGroupId = hoveredGroupId;
          if (!dropGroupId) {
            const currentTabLeft = (tabEl.getBoundingClientRect?.()?.left) || 0;
            const currentTabRight = currentTabLeft + (tabEl.getBoundingClientRect?.()?.width || tabWidth);
            for (const region of groupRegions) {
              const overlap = Math.max(0, Math.min(currentTabRight, region.right) - Math.max(currentTabLeft, region.left));
              if (overlap > 12 || (me?.clientX >= region.left && me?.clientX <= region.right)) {
                dropGroupId = region.groupId;
                break;
              }
            }
          }
          const upEl = getElementUnderneath(tabEl, me?.clientX || 0, me?.clientY || 0);
          const upGroupHolder = upEl?.closest('[data-group-id]');
          if (upGroupHolder) {
            const isCollapsed = upGroupHolder.classList.contains('group-chip--collapsed') || upGroupHolder.classList.contains('group-chip-wrapper--collapsed');
            if (!isCollapsed) {
              const gid = upGroupHolder.getAttribute('data-group-id');
              if (gid) {
                dropGroupId = gid;
                if (upGroupHolder.classList.contains('group-chip') || upGroupHolder.classList.contains('group-chip-wrapper')) {
                  const firstMemberIndex = originalTabs.findIndex(t => t.getAttribute('data-group-id') === gid);
                  if (firstMemberIndex !== -1) {
                    finalTargetIndex = firstMemberIndex;
                  }
                }
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

          const clearTransformsOnly = () => {
            originalTabs.forEach((t) => {
              t.style.transform = '';
              t.style.zIndex = '';
            });
          };
          const restoreTransitionsLater = () => {
            window.requestAnimationFrame(() => {
              originalTabs.forEach((t) => {
                t.style.transition = '';
              });
            });
          };

          if (didReorder) {
            // Build new id order and hand off to Redux
            const ids = originalTabs.map(t => t.id);
            const [moved] = ids.splice(draggingIndex, 1);
            let dropIndex = finalTargetIndex !== -1 ? finalTargetIndex : draggingIndex;
            const pc = cbRef.current.pinnedTabCount || 0;
            if (pc > 0 && !cbRef.current.isPinned) {
              dropIndex = Math.max(pc, dropIndex);
            }
            ids.splice(dropIndex, 0, moved);
            cbRef.current.onDragEnd(ids, { movedTabId: id, targetGroupId: dropGroupId });
          }

          if (!didReorder) {
            clearTransformsOnly();
            restoreTransitionsLater();
          } else {
            // Preserve visual positions through React reorder, then clear transforms.
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                clearTransformsOnly();
                restoreTransitionsLater();
              });
            });
          }
        }

        tabEl.classList.remove('tab-dragging');
        tabEl.style.backgroundColor = '';
        const barEl = tabEl.closest('.tab-bar');
        if (barEl) {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              barEl.classList.remove('tab-bar--dragging');
            });
          });
        }
        window._draggingTabId = null;
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
    };
  }, [id]);

  return tabRef;
}
