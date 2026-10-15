# InviSurf Bookmarks & Bookmark Bar Scenario Test Plan

## Overview
InviSurf provides a complete bookmarking suite including:
- Omnibox / Toolbar Star Button with live state (disabled on internal pages, enabled on web pages, animated pop, and `.starred` state).
- In-Shell Bookmark Editor popup integration.
- Bookmark Bar with `.bk-items-container` displaying bookmarks and folders.
- Interactive Add Folder prompt (`#bk-folder-prompt`) with keyboard submission (`Enter`) and cancel (`Escape` or cancel button).
- Overflow detection (`.bk-overflow-btn`) when bookmark items exceed available horizontal bar width.

---

## Detailed Scenarios

### Scenario 1: Omnibox Star Button Availability & Active Toggle
- **ID**: `1.1 bookmark-star-availability-and-state`
- **Actions**:
  1. On NTP / internal tab, verify `#bookmark-btn` is disabled with title "This page cannot be bookmarked".
  2. Navigate tab to an external web page (`https://example.com`).
  3. Verify `#bookmark-btn` becomes enabled with title "Bookmark this page".
  4. Click `#bookmark-btn` -> triggers bookmark editor popup overlay.
  5. Inject bookmark item state in Redux / main -> verify `#bookmark-btn` acquires `.starred` class.

### Scenario 2: Bookmark Bar Structure & Navigation
- **ID**: `1.2 bookmark-bar-items-and-navigation`
- **Actions**:
  1. Verify `.bookmark-bar` is visible.
  2. Inject test bookmark item into the bookmark store (`bookmarks:add` or Redux update).
  3. Verify bookmark item renders in `.bk-items-container` with title and icon.
  4. Click bookmark item -> triggers navigation to the target URL.

### Scenario 3: Folder Prompt Workflow (Cancel & Submit)
- **ID**: `2.1 bookmark-folder-prompt-workflow`
- **Actions**:
  1. Click `button.bk-add-folder` ("Add folder").
  2. Verify `#bk-folder-prompt` appears with `#bk-folder-name`, `#bk-folder-ok`, `#bk-folder-cancel`.
  3. Type test folder name into `#bk-folder-name`.
  4. Click `#bk-folder-cancel` -> prompt closes, folder is not added.
  5. Click `button.bk-add-folder` again, enter folder name "Work Projects", and press `Enter` (or click OK).
  6. Verify prompt closes and folder is created in the bar.

### Scenario 4: Responsive Resizing & Overflow Button
- **ID**: `3.1 bookmark-bar-overflow-on-resize`
- **Actions**:
  1. Populate bookmark bar with multiple bookmarks.
  2. Resize window to compact width (600px).
  3. Verify `.bk-overflow-btn` appears for hidden bookmarks that don't fit.
  4. Resize window wide (1400px) -> all items become visible and `.bk-overflow-btn` is hidden.
