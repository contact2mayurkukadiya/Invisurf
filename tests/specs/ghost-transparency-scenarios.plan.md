# InviSurf Window Transparency & Ghost Mode Scenario Test Plan

## Overview
InviSurf incorporates stealth transparency and ghost window modes:
- Transparency Toolbar Button (`#transparency-btn`) in `WindowOpacityControl.jsx`.
- Real-time opacity range validation (MIN_OPACITY 2% to MAX_OPACITY 100%).
- Overlay menu synchronization (`transparencyMenu` kind, `transparencySetOpacity` event).
- Dedicated Ghost Window features:
  - Ghost Mode status badge (`button.ghost-badge`).
  - Interactive vs Passthrough click-through toggling (`ghost:toggle-click-through`).
  - Passthrough indicator dot (`.ghost-badge-dot--passthrough`).
  - Ghost drag coordination (`ghost:drag`).

---

## Detailed Scenarios

### Scenario 1: Transparency Button & Popup State
- **ID**: `1.1 transparency-toolbar-trigger-and-aria-state`
- **Actions**:
  1. Verify `#transparency-btn` is rendered in the toolbar.
  2. Verify initial `aria-expanded="false"`, `aria-label="Transparency Mode"`.
  3. Click `#transparency-btn` -> `aria-expanded` becomes `"true"`, gains active styling.
  4. Click again -> `aria-expanded` returns to `"false"`.

### Scenario 2: Opacity Adjustment & Host Event Sync
- **ID**: `1.2 transparency-opacity-change-and-bounds`
- **Actions**:
  1. Trigger opacity change event (`transparencySetOpacity`) via overlay event channel.
  2. Verify window opacity updates dynamically.
  3. Verify values clamp within safe boundaries (0.02 to 1.0).

### Scenario 3: Ghost Window Badge & Click-Through Passthrough
- **ID**: `2.1 ghost-mode-badge-and-passthrough-toggle`
- **Actions**:
  1. In ghost window shell or mock environment, verify `ghost-badge` presence.
  2. Dispatch `ghost:click-through-changed` with `{ isClickThrough: true }`.
  3. Verify badge updates label to "Ghost • Passthrough" and dot gains `.ghost-badge-dot--passthrough`.
  4. Dispatch `{ isClickThrough: false }` -> badge restores interactive status.
