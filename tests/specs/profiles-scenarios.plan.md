# InviSurf Profiles & Profile Management Scenario Test Plan

## Overview
InviSurf implements full multi-profile isolation with distinct user data, encrypted histories, cookies, and bookmarks per profile. The profiles feature contains:
- Profile Picker initial landing window (`profile-picker.html`) with branding, card grid, and card click launching.
- In-shell Profile Menu toolbar button (`.profile-menu__trigger`) with aria labels and overlay menu.
- Profile Editor Modal (`ProfileEditorModal.jsx`) allowing profile renaming, avatar preset selection, and creation of new profiles.
- Profile deletion and lifecycle invariants.

---

## Detailed Scenarios

### Scenario 1: Profile Picker Display & Card Navigation
- **ID**: `1.1 profile-picker-landing-and-selection`
- **Actions**:
  1. Launch Profile Picker window.
  2. Verify hero branding ("InviSurf") and subtitle ("Who's using this browser?").
  3. Verify at least one profile card (`.pp-card:not(.pp-card--add)`) is visible.
  4. Verify Add Profile card (`.pp-card--add`) is present.

### Scenario 2: Profile Creation via Picker Modal
- **ID**: `1.2 profile-creation-modal-workflow`
- **Actions**:
  1. Click `.pp-card--add`.
  2. Modal opens with name input `#profile-editor-name`.
  3. Type new profile name "Engineering Profile".
  4. Click Cancel button -> modal closes without creating profile.
  5. Re-open modal, enter "QA Test Profile", and submit.
  6. Verify new profile is saved and card appears in picker.

### Scenario 3: In-Shell Profile Toolbar Trigger & Menu
- **ID**: `2.1 profile-menu-toolbar-trigger`
- **Actions**:
  1. Inside browser shell window, locate `.profile-menu__trigger`.
  2. Verify trigger is visible with `aria-label` matching active profile.
  3. Click trigger -> `aria-expanded` toggles to `true` and profile menu overlay opens.
  4. Press `Escape` or click outside -> `aria-expanded` toggles to `false`.

### Scenario 4: Profile Editor Modal Inside Shell
- **ID**: `2.2 profile-editor-shell-modal`
- **Actions**:
  1. Open profile editor modal inside browser shell.
  2. Verify name input is populated with current profile name.
  3. Test avatar preset selection and cancelling cleanly.
