import React, { useState, useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setSplitRatio } from '../../store/browserSlice';
import SplitTabChooser from './SplitTabChooser';
import { useOptionalTabOverlay } from '../../context/TabOverlayContext';
import './SplitDivider.css';

export default function SplitDivider() {
  const dispatch = useDispatch();
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const tabs = useSelector((s) => s.browser.tabs);
  const splitGroups = useSelector((s) => s.browser.splitGroups);
  const sidePanel = useSelector((s) => s.browser.sidePanel);
  const screenShare = useSelector((s) => s.browser.screenShare);

  const currentTab = currentTabId ? tabs[currentTabId] : null;
  const splitPair = Object.values(splitGroups || {}).find(
    (p) => p.leftTabId === currentTabId || p.rightTabId === currentTabId
  ) || null;

  const [isDragging, setIsDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(null);
  const rafIdRef = useRef(null);
  const pendingRatioRef = useRef(null);
  const overlayContext = useOptionalTabOverlay();
  const splitSnapshot = overlayContext?.splitSnapshot;

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  if (!splitPair) return null;
  if (sidePanel?.isOpen && sidePanel?.activePanelId === 'lens') return null;

  const isStacked = !!splitPair.isStacked;
  const effectiveRatio = isDragging && dragRatio !== null ? dragRatio : (splitPair.ratio || 0.5);
  const sidePanelWidth = sidePanel?.isOpen ? (sidePanel.width || 360) : 0;
  const availableWidth = Math.max(300, window.innerWidth - sidePanelWidth);
  const isTabSharing = Boolean(screenShare?.active && screenShare?.sourceKind === 'tab');
  const uiHeight = 122 + (isTabSharing ? 38 : 0);
  const availableHeight = Math.max(200, window.innerHeight - uiHeight); // UI_HEIGHT (122px) + screen sharing banner (38px)

  // Exact card metrics matching splitTabManager.js layout
  const leftMargin = 8;
  const topMargin = 4;
  const bottomMargin = 8;
  const rightMargin = sidePanelWidth > 0 ? 6 : 8;
  const paneGap = 8; // Spacing between the two panes

  // Horizontal metrics
  const usableTotalWidth = Math.max(0, availableWidth - leftMargin - rightMargin - paneGap);
  const minViewWidth = 240;

  let leftWidth = Math.floor(usableTotalWidth * effectiveRatio);
  let rightWidth = usableTotalWidth - leftWidth;

  if (usableTotalWidth >= minViewWidth * 2) {
    if (leftWidth < minViewWidth) {
      leftWidth = minViewWidth;
      rightWidth = usableTotalWidth - leftWidth;
    } else if (rightWidth < minViewWidth) {
      rightWidth = minViewWidth;
      leftWidth = usableTotalWidth - rightWidth;
    }
  }

  const leftX = leftMargin;
  const rightX = leftMargin + leftWidth + paneGap;
  const dividerX = leftMargin + leftWidth;

  // Vertical stacked metrics
  const paneWidth = Math.max(0, availableWidth - leftMargin - rightMargin);
  const usableTotalHeight = Math.max(0, availableHeight - topMargin - bottomMargin - paneGap);
  const minViewHeight = 120;

  let topHeight = Math.floor(usableTotalHeight * effectiveRatio);
  let bottomHeight = usableTotalHeight - topHeight;

  if (usableTotalHeight >= minViewHeight * 2) {
    if (topHeight < minViewHeight) {
      topHeight = minViewHeight;
      bottomHeight = usableTotalHeight - topHeight;
    } else if (bottomHeight < minViewHeight) {
      bottomHeight = minViewHeight;
      topHeight = usableTotalHeight - bottomHeight;
    }
  }

  const paneX = leftMargin;
  const topY = topMargin;
  const bottomY = topMargin + topHeight + paneGap;
  const dividerY = topMargin + topHeight;

  const sendIpcRatio = (ratio, isLive = true) => {
    pendingRatioRef.current = ratio;
    if (isLive) {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (pendingRatioRef.current !== null) {
            window.electronAPI?.splitTabSetRatio?.(splitPair.id, pendingRatioRef.current, { isLive: true });
          }
        });
      }
    } else {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      window.electronAPI?.splitTabSetRatio?.(splitPair.id, ratio, { isLive: false });
    }
  };

  const handlePointerDown = (e) => {
    if (e.button !== 0 || splitPair.isChoosing) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch (_) {}

    setIsDragging(true);
    setDragRatio(effectiveRatio);

    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      if (isStacked) {
        const currentAvail = Math.max(200, window.innerHeight - 122);
        const usable = Math.max(100, currentAvail - topMargin - bottomMargin - paneGap);
        const rawRatio = (moveEvent.clientY - 122 - topMargin) / usable;
        const clamped = Math.max(0.2, Math.min(0.8, rawRatio));
        setDragRatio(clamped);
        sendIpcRatio(clamped, true);
      } else {
        const currentAvail = Math.max(300, window.innerWidth - sidePanelWidth);
        const usable = Math.max(100, currentAvail - leftMargin - rightMargin - paneGap);
        const rawRatio = (moveEvent.clientX - leftMargin) / usable;
        const clamped = Math.max(0.2, Math.min(0.8, rawRatio));
        setDragRatio(clamped);
        sendIpcRatio(clamped, true);
      }
    };

    const onPointerUp = (upEvent) => {
      try {
        upEvent.target.releasePointerCapture?.(upEvent.pointerId);
      } catch (_) {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      let finalRatio = 0.5;
      if (isStacked) {
        const currentAvail = Math.max(200, window.innerHeight - 122);
        const usable = Math.max(100, currentAvail - topMargin - bottomMargin - paneGap);
        finalRatio = Math.max(0.2, Math.min(0.8, (upEvent.clientY - 122 - topMargin) / usable));
      } else {
        const currentAvail = Math.max(300, window.innerWidth - sidePanelWidth);
        const usable = Math.max(100, currentAvail - leftMargin - rightMargin - paneGap);
        finalRatio = Math.max(0.2, Math.min(0.8, (upEvent.clientX - leftMargin) / usable));
      }

      setIsDragging(false);
      setDragRatio(null);

      dispatch(setSplitRatio({ splitId: splitPair.id, ratio: finalRatio }));
      sendIpcRatio(finalRatio, false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleDoubleClick = (e) => {
    if (splitPair.isChoosing) return;
    e.preventDefault();
    e.stopPropagation();
    const defaultRatio = 0.5;
    dispatch(setSplitRatio({ splitId: splitPair.id, ratio: defaultRatio }));
    window.electronAPI?.splitTabSetRatio?.(splitPair.id, defaultRatio);
  };

  const isLeftFocused = splitPair.focusedSide === 'left';
  const isRightFocused = splitPair.focusedSide === 'right';
  const isSwapped = !!splitPair.isSwapped;

  // Screen-side active outline border reflection
  const isScreenLeftFocused = (!isSwapped && isLeftFocused) || (isSwapped && isRightFocused);
  const isScreenRightFocused = (!isSwapped && isRightFocused) || (isSwapped && isLeftFocused);

  const chooserX = isSwapped ? leftX : rightX;
  const chooserWidth = isSwapped ? leftWidth : rightWidth;
  const chooserY = isSwapped ? topY : bottomY;
  const chooserHeight = isSwapped ? topHeight : bottomHeight;

  const dragClass = isDragging
    ? (isStacked ? ' split-overlay-container--dragging-row' : ' split-overlay-container--dragging')
    : '';

  return (
    <div
      className={`split-overlay-container split-divider${dragClass}`}
      style={{ right: sidePanelWidth }}
    >
      {/* First subview card frame (Left in horizontal, Top in stacked) */}
      <div
        className={`split-subview-frame split-subview-frame--${isStacked ? 'top' : 'left'}${isScreenLeftFocused ? ' split-subview-frame--focused' : ''}`}
        style={isStacked ? {
          left: paneX,
          top: topY,
          width: paneWidth,
          height: topHeight,
        } : {
          left: leftX,
          top: topMargin,
          width: leftWidth,
          bottom: bottomMargin,
        }}
      >
        {splitSnapshot?.firstDataUrl && (
          <img
            src={splitSnapshot.firstDataUrl}
            alt=""
            className="split-subview-snapshot-img"
            draggable={false}
          />
        )}
      </div>

      {/* Second subview card frame (Right in horizontal, Bottom in stacked) */}
      <div
        className={`split-subview-frame split-subview-frame--${isStacked ? 'bottom' : 'right'}${isScreenRightFocused ? ' split-subview-frame--focused' : ''}`}
        style={isStacked ? {
          left: paneX,
          top: bottomY,
          width: paneWidth,
          height: bottomHeight,
        } : {
          left: rightX,
          top: topMargin,
          width: rightWidth,
          bottom: bottomMargin,
        }}
      >
        {splitSnapshot?.secondDataUrl && (
          <img
            src={splitSnapshot.secondDataUrl}
            alt=""
            className="split-subview-snapshot-img"
            draggable={false}
          />
        )}
      </div>

      {/* Second pane Tab Chooser list when splitPair is in choosing state */}
      {splitPair.isChoosing && (
        <SplitTabChooser
          splitPair={splitPair}
          style={isStacked ? {
            left: paneX,
            top: chooserY,
            width: paneWidth,
            height: chooserHeight,
          } : {
            left: chooserX,
            top: topMargin,
            width: chooserWidth,
            bottom: bottomMargin,
          }}
        />
      )}

      {/* Interactive Divider Sash positioned in the 8px gap between panes */}
      {!splitPair.isChoosing && (
        <div
          className={`split-divider-handle${isStacked ? ' split-divider-handle--horizontal' : ''}${isDragging ? ' split-divider-handle--dragging' : ''}`}
          style={isStacked ? {
            left: paneX,
            top: dividerY,
            width: paneWidth,
            height: paneGap,
          } : {
            left: dividerX,
            top: topMargin,
            width: paneGap,
            bottom: bottomMargin,
          }}
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          title="Drag to resize split view • Double-click to reset (50/50)"
        >
          <div className="split-divider-pill" />
        </div>
      )}
    </div>
  );
}
