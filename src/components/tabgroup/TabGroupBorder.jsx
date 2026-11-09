import React from 'react';

/**
 * Pixel-perfect Chrome-parity connected tab group outline & baseline.
 *
 * For an active tab: renders the continuous rounded contour:
 * - __left: Top-Left corner (convex), left vertical bar, and bottom-left fillet (concave)
 * - __top: Top horizontal bar
 * - __right: Top-Right corner (convex), right vertical bar, and bottom-right fillet (concave)
 * All components share exact mathematical centerlines with zero gap and zero overlap.
 *
 * For an inactive tab: renders the baseline underline with exact offsets so it meets
 * neighboring fillets, tabs, and group chips seamlessly.
 */
export default function TabGroupBorder({
  groupColor,
  isActive,
  isFirstInGroup = false,
  isLastInGroup = false,
  prevTabIsActiveInGroup = false,
  nextTabIsActiveInGroup = false,
}) {
  if (!groupColor) return null;

  if (isActive) {
    return (
      <div className="tab-group-active-border" style={{ color: groupColor }} aria-hidden="true">
        {/* Left Contour */}
        <div className="tab-group-active-border__left">
          <svg
            className="tab-group-active-border__corner-tl"
            viewBox="0 0 10 10"
            width="10"
            height="10"
          >
            <path
              d="M 1 10 A 9 9 0 0 1 10 1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
            />
          </svg>
          <div className="tab-group-active-border__left-bar" />
          <svg
            className="tab-group-active-border__fillet-bl"
            viewBox="0 0 11 10"
            width="11"
            height="10"
          >
            <path
              d="M 1 9 A 10 9 0 0 0 11 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="butt"
            />
          </svg>
        </div>

        {/* Top Horizontal Bar */}
        <div className="tab-group-active-border__top tab-group-active-border__top-bar" />

        {/* Right Contour */}
        <div className="tab-group-active-border__right">
          <svg
            className="tab-group-active-border__corner-tr"
            viewBox="0 0 10 10"
            width="10"
            height="10"
          >
            <path
              d="M 0 1 A 9 9 0 0 1 9 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
            />
          </svg>
          <div className="tab-group-active-border__right-bar" />
          <svg
            className="tab-group-active-border__fillet-br"
            viewBox="0 0 11 10"
            width="11"
            height="10"
          >
            <path
              d="M 0 0 A 10 9 0 0 0 10 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="butt"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Inactive tab in group: bottom baseline along y = baseline (bottom: 1px, height: 2px)
  // If previous tab in group is active, its right fillet extends into this tab's slot,
  // meeting this tab's baseline at left: 4px with 0px overlap and 0px gap.
  const left = prevTabIsActiveInGroup ? '4px' : '0px';

  // If next tab in group is active, its left fillet extends into this tab's slot,
  // so this tab's baseline ends at right: 4px with 0px overlap and 0px gap.
  // If next tab is inactive and not the last in group, bridge the 5px gap with right: -5px.
  // If this is the last tab in group, terminate cleanly at right: 0px.
  const right = nextTabIsActiveInGroup
    ? '4px'
    : (isLastInGroup ? '0px' : '-5px');

  return (
    <div
      className="tab-group-bottom-bar"
      style={{
        backgroundColor: groupColor,
        left,
        right,
      }}
      aria-hidden="true"
    />
  );
}
