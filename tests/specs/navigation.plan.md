# Navigation & Omnibox Test Plan

## Application Overview
InviSurf browser provides a modern unified omnibox supporting direct URL entry, search engine querying, formatted domain presentation, and navigation controls (back, forward, reload).

## Test Scenarios

### 1. Omnibox Navigation Controls
**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 1.1. omnibox-url-navigation
**File:** `tests/e2e/navigation/navigation.spec.js`
**Steps:**
  1. Launch InviSurf browser shell
    - expect: title matches InviSurf
    - expect: `#url-input` is visible in the omnibox bar
  2. Focus and enter URL 'https://example.com' into `#url-input`
    - expect: input value matches 'https://example.com'
  3. Press 'Enter' to initiate navigation
    - expect: navigation IPC event is dispatched to active tab
  4. Click reload button (`#reload-btn`)
    - expect: reload action dispatched without errors
  5. Click back button (`#back-btn`)
    - expect: goBack action dispatched without errors
