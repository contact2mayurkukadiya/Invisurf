# Tab Management Test Plan

## Application Overview
InviSurf features dynamic tabs with responsive auto-sizing, pinned tab support, active tab highlighting, and context menus.

## Test Scenarios

### 1. Tab Lifecycle Operations
**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 1.1. create-and-switch-tabs
**File:** `tests/e2e/tabs/tab-management.spec.js`
**Steps:**
  1. Verify initial tab bar contains at least 1 tab
    - expect: `.tab` locator count is at least 1
    - expect: `#add-tab` button is visible
  2. Click `#add-tab` button
    - expect: `.tab` count increases by 1
    - expect: the new tab becomes the active tab
  3. Click the first tab to switch back
    - expect: first tab has `.active` class
  4. Click tab close button on second tab
    - expect: `.tab` count returns to original count
