# Omnibox Detailed Feature Test Plan

## Application Overview

The Omnibox is InviSurf's primary address and navigation bar. It is responsible for URL input, query autocompletion, real-time draft handling, navigation controls (reload, back, forward), SSL/security indicators, site permissions management, and on-device cookie data controls via the Site Info padlock overlay. It must also adapt responsively across window dimensions without visual clipping or overflow.

## Test Scenarios

### 1. Omnibox Core Interactions & Navigation

**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 1.1. omnibox-typing-and-drafts
**File:** `tests/e2e/omnibox/omnibox-detailed-scenarios.spec.js`

**Steps:**
  1. Click into the Omnibox input (`#url-input`)
    - expect: input is focused and interactive
  2. Type search text query: "playwright testing framework"
    - expect: `#url-input` value matches typed text
  3. Select all text with keyboard shortcut and replace with a direct URL `https://example.com`
    - expect: value updates cleanly
  4. Press Escape to clear or revert uncommitted drafts
    - expect: input handles draft reversion safely

#### 1.2. omnibox-navigation-and-history-controls
**File:** `tests/e2e/omnibox/omnibox-detailed-scenarios.spec.js`

**Steps:**
  1. Navigate to `https://example.com` by pressing Enter in `#url-input`
    - expect: omnibox reflects `https://example.com`
  2. Verify reload button (`#reload-btn`) is clickable and initiates reload
    - expect: `#reload-btn` triggers reload without errors
  3. Navigate to a second URL `https://github.com`
    - expect: navigation succeeds and URL updates
  4. Verify Back button (`#back-btn`) is enabled and click it
    - expect: browser navigates back to `https://example.com`
  5. Verify Forward button (`#forward-btn`) is enabled and click it
    - expect: browser navigates forward to `https://github.com`

### 2. Site Info, Permissions & Cookies Overlays

**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 2.1. omnibox-site-info-and-permissions-popup
**File:** `tests/e2e/omnibox/omnibox-detailed-scenarios.spec.js`

**Steps:**
  1. Navigate to an external website `https://example.com`
    - expect: site information button (`button.omnibox-action-btn--prefix[title="View site information"]`) appears in prefix slot
  2. Click the site information button
    - expect: button receives active state (`aria-expanded="true"`)
  3. Access the shell overlay layer
    - expect: Site Info panel is displayed with domain "example.com"
    - expect: rows for "Connection is secure", "Cookies and site data", and "Site permissions" are visible
  4. Click "Site permissions" row
    - expect: sub-panel opens with "Site permissions" header
    - expect: permission selectors (`select`) exist for camera, microphone, notifications
    - expect: "Reset permissions" button is rendered
  5. Close the Site Info popup
    - expect: popup closes and prefix button resets `aria-expanded="false"`

#### 2.2. omnibox-cookie-box-popup
**File:** `tests/e2e/omnibox/omnibox-detailed-scenarios.spec.js`

**Steps:**
  1. Open site information button on `https://example.com`
    - expect: Site Info panel opens in overlay
  2. Click "Cookies and site data" row
    - expect: cookie sub-panel opens with "Cookies and site data" header
    - expect: heading "On-device site data" is visible
    - expect: "Manage on-device site data" action button is available
  3. Dismiss cookie box by clicking close or pressing Escape
    - expect: overlay panel is dismissed cleanly

### 3. Responsive Layout & Window Resizing

**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 3.1. omnibox-responsive-resizing
**File:** `tests/e2e/omnibox/omnibox-detailed-scenarios.spec.js`

**Steps:**
  1. Set window size to standard desktop (1280x800)
    - expect: omnibox input, prefix button, and navigation controls fit comfortably
  2. Resize window to compact width (800x600)
    - expect: `#url-input` remains fully visible and editable without horizontal scroll breaking
    - expect: reload, back, and forward buttons remain accessible
  3. Resize window to widescreen (1600x900)
    - expect: omnibox scales gracefully with max-width limits maintained
