import React, { useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setSplitRatio } from '../../store/browserSlice';
import SplitTabChooser from './SplitTabChooser';
import './SplitDivider.css';

export default function SplitDivider() {
  const dispatch = useDispatch();
  const currentTabId = useSelector((s) => s.browser.currentTabId);
  const tabs = useSelector((s) => s.browser.tabs);
  const splitGroups = useSelector((s) => s.browser.splitGroups);
  const sidePanel = useSelector((s) => s.browser.sidePanel);

  const currentTab = currentTabId ? tabs[currentTabId] : null;
  const splitPair = Object.values(splitGroups || {}).find(
    (p) => p.leftTabId === currentTabId || p.rightTabId === currentTabId
  ) || null;

  const [isDragging, setIsDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(null);
  const lastIpcTimeRef = useRef(0);

  if (!splitPair) return null;

  const effectiveRatio = isDragging && dragRatio !== null ? dragRatio : (splitPair.ratio || 0.5);
  const sidePanelWidth = sidePanel?.isOpen ? (sidePanel.width || 360) : 0;
  const availableWidth = Math.max(300, window.innerWidth - sidePanelWidth);

  // Exact card metrics matching splitTabManager.js layout
  const leftMargin = 8;
  const topMargin = 4;
  const bottomMargin = 8;
  const rightMargin = sidePanelWidth > 0 ? 6 : 8;
  const paneGap = 8; // Spacing between the two panes

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

  const sendIpcRatio = (ratio) => {
    const now = performance.now();
    if (now - lastIpcTimeRef.current >= 16) { // ~60fps throttle
      lastIpcTimeRef.current = now;
      window.electronAPI?.splitTabSetRatio?.(splitPair.id, ratio);
    }
  };

  const handlePointerDown = (e) => {
    if (e.button !== 0 || splitPair.isChoosing) return;
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragRatio(effectiveRatio);

    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      const currentAvail = Math.max(300, window.innerWidth - sidePanelWidth);
      const usable = Math.max(100, currentAvail - leftMargin - rightMargin - paneGap);
      const rawRatio = (moveEvent.clientX - leftMargin) / usable;
      const clamped = Math.max(0.2, Math.min(0.8, rawRatio));

      setDragRatio(clamped);
      sendIpcRatio(clamped);
    };

    const onPointerUp = (upEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      const currentAvail = Math.max(300, window.innerWidth - sidePanelWidth);
      const usable = Math.max(100, currentAvail - leftMargin - rightMargin - paneGap);
      const finalRatio = Math.max(0.2, Math.min(0.8, (upEvent.clientX - leftMargin) / usable));

      setIsDragging(false);
      setDragRatio(null);

      dispatch(setSplitRatio({ splitId: splitPair.id, ratio: finalRatio }));
      window.electronAPI?.splitTabSetRatio?.(splitPair.id, finalRatio);
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

  return (
    <div
      className={`split-overlay-container split-divider${isDragging ? ' split-overlay-container--dragging' : ''}`}
      style={{ right: sidePanelWidth }}
    >
      {/* Left subview card frame: active pane displays outline border with theme color */}
      <div
        className={`split-subview-frame split-subview-frame--left${isScreenLeftFocused ? ' split-subview-frame--focused' : ''}`}
        style={{
          left: leftX,
          top: topMargin,
          width: leftWidth,
          bottom: bottomMargin,
        }}
      />

      {/* Right subview card frame: active pane displays outline border with theme color */}
      <div
        className={`split-subview-frame split-subview-frame--right${isScreenRightFocused ? ' split-subview-frame--focused' : ''}`}
        style={{
          left: rightX,
          top: topMargin,
          width: rightWidth,
          bottom: bottomMargin,
        }}
      />

      {/* Second pane Tab Chooser list when splitPair is in choosing state */}
      {splitPair.isChoosing && (
        <SplitTabChooser
          splitPair={splitPair}
          style={{
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
          className={`split-divider-handle${isDragging ? ' split-divider-handle--dragging' : ''}`}
          style={{
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
