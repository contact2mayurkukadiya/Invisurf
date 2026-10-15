# Permissions Test Plan

## Application Overview
InviSurf implements an enterprise permission queue managing hardware and privacy access (camera, microphone, geolocation, notifications). Prompts are coordinated through an overlay dialog with deduplication and auto-cancellation on navigation.

## Test Scenarios

### 1. Permission Prompt Queue & Overlay
**Seed:** `tests/e2e/fixtures/seed.spec.js`

#### 1.1. permission-prompt-display-and-resolve
**File:** `tests/e2e/permissions/permissions.spec.js`
**Steps:**
  1. Trigger permission request in main process for current tab
    - expect: prompt is enqueued in PermissionPromptQueue
    - expect: prompt indicator or overlay is triggered
  2. Resolve prompt with 'allow'
    - expect: callback fires with 'allow' decision
    - expect: permission state persisted for origin
