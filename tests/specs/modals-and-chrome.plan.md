# Modals and Chrome Controls Test Plan

Automated end-to-end testing specification for in-shell modals and toolbar controls.

## Tested User Journeys

### 1. Transparency Mode Button
- **Path**: Window toolbar top-right
- **Trigger**: Click `#transparency-btn`
- **Assertion**: Active class/aria-expanded toggle between true and false without errors.

### 2. Profile Menu Button
- **Path**: Window toolbar top-right
- **Trigger**: Display of active profile avatar
- **Assertion**: Visible with proper `aria-label="Current Profile"`.

### 3. Command Palette Modal
- **Path**: In-shell overlay
- **Trigger**: `shortcut-command-palette` IPC shortcut
- **Assertion**: Dialog appears with `aria-label="Search menu commands"`, typing filters commands, Escape closes.

### 4. Tab Search Modal
- **Path**: In-shell overlay
- **Trigger**: `shortcut-tab-search` IPC shortcut
- **Assertion**: Dialog appears with `aria-label="Search tabs"`, lists active tabs, Escape closes.
