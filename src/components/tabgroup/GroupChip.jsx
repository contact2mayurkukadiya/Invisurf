import React, { useRef, useCallback } from 'react';
import { getGroupThemeColors } from '../../utils/tabGroupModel.js';

export default function GroupChip({
  group,
  tabCount = 1,
  isCollapsed = false,
  onToggleCollapse,
  onOpenEditor,
  onContextMenu,
  onMoveGroup,
  onDetachGroup,
  tabOrder = [],
  tabs = {},
  pinnedTabCount = 0,
  isDarkTheme = false,
  activeTabId = null,
}) {
  const chipRef = useRef(null);
  const wrapperRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const wasDraggedRef = useRef(false);
  const themeCols = getGroupThemeColors(group.color, isDarkTheme);

  const handleClick = (e) => {
    e.stopPropagation();
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      if (onOpenEditor && chipRef.current) {
        onOpenEditor(group.id, chipRef.current.getBoundingClientRect());
      }
      return;
    }
    clickTimeoutRef.current = setTimeout(() => {
      clickTimeoutRef.current = null;
      if (onToggleCollapse) onToggleCollapse(group.id);
    }, 220);
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    if (onOpenEditor && chipRef.current) {
      onOpenEditor(group.id, chipRef.current.getBoundingClientRect());
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    if (onOpenEditor && chipRef.current) {
      onOpenEditor(group.id, chipRef.current.getBoundingClientRect());
    }
    if (onContextMenu) {
      onContextMenu(e, group.id);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onToggleCollapse) onToggleCollapse(group.id);
    }
  };

  // Dragging the whole group along the tab strip & vertical detachment into new window
  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    const chipEl = chipRef.current;
    if (!chipEl) return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const isInitiallyCollapsed = !!isCollapsed;
    let dragStarted = false;
    let isDetached = false;
    let rafId = null;

    const bar = chipEl.closest('.tab-bar');
    const allTabs = bar ? Array.from(bar.querySelectorAll('.tab')) : [];
    const memberTabIds = tabOrder.filter((tid) => tabs[tid]?.groupId === group.id);
    const memberEls = memberTabIds.map((tid) => document.getElementById(tid)).filter(Boolean);
    const otherTabs = allTabs.filter((t) => !memberTabIds.includes(t.id));
    const groupInitialIndex = tabOrder.indexOf(memberTabIds[0]);
    const wrapperEl = wrapperRef.current || chipEl;
    const groupEls = [wrapperEl, ...memberEls];
    const startChipRect = wrapperEl.getBoundingClientRect();

    let targetIndex = groupInitialIndex;

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
        if (Math.hypot(deltaX, deltaY) < 6) return;
        dragStarted = true;
        wasDraggedRef.current = true;
        try {
          chipEl.setPointerCapture(pointerId);
        } catch (_) {}

        chipEl.classList.add('group-chip--dragging');
        wrapperEl.classList.add('group-chip-wrapper--dragging');
        bar?.classList.add('tab-bar--dragging');

        // Requirement 1: Temporarily collapse group while dragging like Chrome
        if (!isInitiallyCollapsed) {
          memberEls.forEach((el) => {
            el.classList.add('tab--collapsed-member');
          });
          wrapperEl.classList.add('group-chip-wrapper--collapsed');
          chipEl.classList.add('group-chip--collapsed');
        }

        allTabs.forEach((t) => { t.style.transition = 'none'; });
        groupEls.forEach((el) => { el.style.transition = 'none'; });
      }

      // Check vertical detachment threshold (35px) for detaching whole group into new window
      if (!isDetached && Math.abs(deltaY) > 35) {
        isDetached = true;

        chipEl.classList.remove('group-chip--dragging');
        wrapperEl.classList.remove('group-chip-wrapper--dragging');
        bar?.classList.remove('tab-bar--dragging');

        wrapperEl.style.transform = '';
        wrapperEl.style.zIndex = '';
        wrapperEl.style.transition = '';

        if (!isInitiallyCollapsed) {
          memberEls.forEach((el) => {
            el.classList.remove('tab--collapsed-member');
          });
          wrapperEl.classList.remove('group-chip-wrapper--collapsed');
          chipEl.classList.remove('group-chip--collapsed');
        }

        allTabs.forEach((t) => { t.style.transition = ''; });

        const memberTabsData = memberTabIds.map((tid) => ({
          id: tid,
          url: tabs[tid]?.url,
          title: tabs[tid]?.title,
          favicon: tabs[tid]?.favicon || null,
          isLoading: !!tabs[tid]?.isLoading,
          isStealth: !!tabs[tid]?.isStealth,
        }));

        const isSingle = memberTabIds.length >= tabOrder.length;

        window.electronAPI?.tabDragDetach?.({
          isGroupDetach: true,
          groupId: group.id,
          group: { ...group },
          memberTabIds,
          memberTabsData,
          activeTabId: activeTabId || memberTabIds[0],
          screenX: me.screenX,
          screenY: me.screenY,
          grabOffsetX: me.clientX - startChipRect.left,
          grabOffsetY: me.clientY - startChipRect.top,
          isSingleTab: isSingle,
        });

        if (!isSingle && onDetachGroup) {
          onDetachGroup(group.id, memberTabIds);
        }
        return;
      }

      // Translate the dragged chip element constrained strictly within tab strip boundaries
      const container = chipEl.closest('.tab-container');
      const boundsRect = container ? container.getBoundingClientRect() : bar.getBoundingClientRect();
      const chipW = startChipRect.width;
      const grabOffsetX = startX - startChipRect.left;
      const newX = Math.max(boundsRect.left, Math.min(me.clientX - grabOffsetX, boundsRect.right - chipW));
      const dragDx = newX - startChipRect.left;

      wrapperEl.style.transform = `translateX(${dragDx}px)`;
      wrapperEl.style.zIndex = '9999';

      // Determine target index using center threshold vs target tab / group chip center
      const currentChipLeft = newX;
      const currentChipRight = newX + chipW;
      const draggedChipCenter = newX + chipW / 2;
      let newTarget = groupInitialIndex;

      const otherGroupChips = bar
        ? Array.from(bar.querySelectorAll('.group-chip-wrapper')).filter(c => c.getAttribute('data-group-id') !== group.id)
        : [];

      // Build discrete strip units: standalone tabs and other groups
      const stripUnits = [];
      const processedGids = new Set([group.id]);

      for (let i = 0; i < tabOrder.length; i++) {
        const tid = tabOrder[i];
        const gid = tabs[tid]?.groupId;
        if (gid === group.id) continue;

        if (gid) {
          if (!processedGids.has(gid)) {
            processedGids.add(gid);
            const mIds = tabOrder.filter(id => tabs[id]?.groupId === gid);
            const chipWrap = bar.querySelector(`.group-chip-wrapper[data-group-id="${gid}"]`);
            const cEl = chipWrap?.querySelector('.group-chip') || chipWrap;
            const cRect = cEl?.getBoundingClientRect();
            const firstIdx = tabOrder.indexOf(mIds[0]);
            const lastIdx = tabOrder.indexOf(mIds[mIds.length - 1]);
            if (cRect) {
              stripUnits.push({
                type: 'group',
                groupId: gid,
                chipWrapper: chipWrap,
                chipRect: cRect,
                chipCenter: cRect.left + cRect.width / 2,
                firstIndex: firstIdx,
                lastIndex: lastIdx,
              });
            }
          }
        } else {
          const tabEl = document.getElementById(tid);
          if (tabEl) {
            const rect = tabEl.getBoundingClientRect();
            stripUnits.push({
              type: 'tab',
              tabId: tid,
              tabEl,
              rect,
              center: rect.left + rect.width / 2,
              index: i,
            });
          }
        }
      }

      if (stripUnits.length > 0) {
        if (dragDx > 0) {
          // Moving right: target switches as soon as dragged chip center crosses target center
          for (let i = stripUnits.length - 1; i >= 0; i--) {
            const unit = stripUnits[i];
            const threshold = unit.type === 'group' ? unit.chipCenter : unit.center;
            if (draggedChipCenter > threshold) {
              newTarget = unit.type === 'group' ? unit.lastIndex + 1 : unit.index + 1;
              break;
            }
          }
        } else if (dragDx < 0) {
          // Moving left: target switches as soon as dragged chip center crosses target center
          for (let i = 0; i < stripUnits.length; i++) {
            const unit = stripUnits[i];
            const threshold = unit.type === 'group' ? unit.chipCenter : unit.center;
            if (draggedChipCenter < threshold) {
              newTarget = unit.type === 'group' ? unit.firstIndex : unit.index;
              break;
            }
          }
        }
      }

      if (pinnedTabCount > 0) {
        newTarget = Math.max(pinnedTabCount, newTarget);
      }

      targetIndex = newTarget;

      // Animate other tabs and other group chips to visually switch positions with the dragged group chip
      const draggedWidthWithGap = chipW + 5;
      otherTabs.forEach((t) => {
        const idx = tabOrder.indexOf(t.id);
        if (newTarget > groupInitialIndex && idx > groupInitialIndex && idx < newTarget) {
          t.style.transform = `translateX(-${draggedWidthWithGap}px)`;
          t.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
        } else if (newTarget < groupInitialIndex && idx >= newTarget && idx < groupInitialIndex) {
          t.style.transform = `translateX(${draggedWidthWithGap}px)`;
          t.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
        } else {
          t.style.transform = '';
          t.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
        }
      });

      otherGroupChips.forEach((chipWrap) => {
        const gid = chipWrap.getAttribute('data-group-id');
        const firstTabId = tabOrder.find((tid) => tabs[tid]?.groupId === gid);
        const idx = firstTabId ? tabOrder.indexOf(firstTabId) : -1;
        if (idx !== -1) {
          if (newTarget > groupInitialIndex && idx > groupInitialIndex && idx < newTarget) {
            chipWrap.style.transform = `translateX(-${draggedWidthWithGap}px)`;
            chipWrap.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
          } else if (newTarget < groupInitialIndex && idx >= newTarget && idx < groupInitialIndex) {
            chipWrap.style.transform = `translateX(${draggedWidthWithGap}px)`;
            chipWrap.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
          } else {
            chipWrap.style.transform = '';
            chipWrap.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
          }
        }
      });
    };

    const onUp = (me) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);

      try {
        chipEl.releasePointerCapture(pointerId);
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
        return;
      }

      if (dragStarted) {
        chipEl.classList.remove('group-chip--dragging');
        wrapperEl.classList.remove('group-chip-wrapper--dragging');
        bar?.classList.remove('tab-bar--dragging');

        wrapperEl.style.transform = '';
        wrapperEl.style.zIndex = '';
        wrapperEl.style.transition = '';

        // Requirement 1: Re-expand group on release if it was initially expanded
        if (!isInitiallyCollapsed) {
          memberEls.forEach((el) => {
            el.classList.remove('tab--collapsed-member');
          });
          wrapperEl.classList.remove('group-chip-wrapper--collapsed');
          chipEl.classList.remove('group-chip--collapsed');
        }

        const barTabs = bar ? Array.from(bar.querySelectorAll('.tab')) : [];
        const trackTabs = Array.from(document.querySelectorAll('.tab'));
        new Set([...allTabs, ...barTabs, ...otherTabs, ...memberEls, ...trackTabs]).forEach((t) => {
          t.style.transform = '';
          t.style.transition = '';
        });

        const allGroupWrappers = bar ? Array.from(bar.querySelectorAll('.group-chip-wrapper')) : [];
        allGroupWrappers.forEach((cw) => {
          cw.style.transform = '';
          cw.style.transition = '';
        });

        if (targetIndex !== -1 && targetIndex !== groupInitialIndex && onMoveGroup) {
          onMoveGroup(group.id, targetIndex);
        }

        setTimeout(() => {
          wasDraggedRef.current = false;
        }, 80);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  const hasTitle = Boolean(group.title && group.title.trim());
  const ariaLabel = hasTitle
    ? `${group.title}, ${group.color} group, ${isCollapsed ? 'collapsed' : 'expanded'}, ${tabCount} tabs`
    : `Unnamed ${group.color} group, ${isCollapsed ? 'collapsed' : 'expanded'}, ${tabCount} tabs`;

  const chipStyle = {
    backgroundColor: themeCols.chipBg,
    color: themeCols.text,
    borderColor: themeCols.border,
  };

  const firstMemberTabId = tabOrder.find((tid) => tabs[tid]?.groupId === group.id);
  const firstTabIsActive = Boolean(firstMemberTabId && firstMemberTabId === activeTabId);

  return (
    <div
      ref={wrapperRef}
      data-group-id={group.id}
      className={`group-chip-wrapper${isCollapsed ? ' group-chip-wrapper--collapsed' : ''}${firstTabIsActive ? ' group-chip-wrapper--next-active' : ''}`}
      style={{ '--group-color': themeCols.underline }}
    >
      <div
        ref={chipRef}
        data-group-id={group.id}
        className={`group-chip${isCollapsed ? ' group-chip--collapsed' : ''}${!hasTitle ? ' group-chip--dot' : ''}`}
        style={chipStyle}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={!isCollapsed}
        aria-label={ariaLabel}
        title={group.title ? `${group.title} (${tabCount} tabs) - Click to ${isCollapsed ? 'expand' : 'collapse'}` : `${tabCount} tabs - Click to ${isCollapsed ? 'expand' : 'collapse'}`}
      >
        {hasTitle ? (
          <span className="group-chip-title">{group.title}</span>
        ) : (
          <span className="group-chip-dot-indicator" />
        )}
      </div>
    </div>
  );
}
