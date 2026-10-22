---
description: BROWSER ARCHITECTURE
alwaysApply: true
---

# BROWSER ARCHITECTURE

You are engineering a Chromium-based desktop browser using:

* Chromium
* Electron
* React
* Node.js
* JavaScript/TypeScript
* BrowserWindow
* WebContents
* WebContentsView
* Preload
* IPC
* Sessions / partitions

Treat browser functionality as critical infrastructure.

---

## 1. Process Architecture

Maintain clear boundaries between:

### Browser UI / React Renderer

Responsible for:

* UI
* User interaction
* UI state
* Presentation
* Browser chrome

### Preload

Responsible for:

* Narrow trusted bridge
* Explicit IPC APIs
* Renderer-to-main communication
* Validation where appropriate

Do not expose unrestricted Node.js APIs.

### Electron Main Process

Responsible for:

* Privileged operations
* BrowserWindow
* WebContentsView
* WebContents lifecycle
* Sessions
* Partitions
* Filesystem access
* Native APIs
* Permissions
* Navigation policies
* Browser orchestration

### Web Content

Treat webpage content as untrusted.

Never allow arbitrary website content to access privileged browser APIs.

---

## 2. Electron / Chromium Principles

Prefer official Electron and Chromium APIs.

Avoid:

* Undocumented APIs
* Monkey patching
* Fragile DOM hacks
* Arbitrary delays
* Timing hacks
* Focus-stealing workarounds
* Hide/show workarounds
* Renderer simulation of native behavior when native APIs exist

Use native capabilities whenever they correctly solve the problem.

Do not replace standard browser behavior unnecessarily.

---

## 3. WebContentsView / BrowserWindow

When working with browser views:

Consider:

* Ownership
* Creation
* Attachment
* Detachment
* Destruction
* Navigation
* Resize
* Visibility
* Focus
* Input
* Parent window lifecycle

Every created view must have a clear owner and cleanup path.

Never leave orphaned views.

Do not create additional BrowserWindows/WebContentsViews unless required.

Reuse the existing window/view architecture.

---

## 4. Browser Lifecycle

Always consider:

* Application startup
* Window creation
* Window destruction
* Renderer reload
* Renderer crash
* WebContents destruction
* Navigation
* Multiple windows
* Multiple tabs
* Profile/session changes
* Application restart
* Session restoration

Do not assume an object remains alive indefinitely.

Before operating on Electron objects, consider whether they may already have been destroyed.

---

## 5. Sessions and Profiles

Treat profiles and sessions as isolated browser state.

Consider:

* Cookies
* Local storage
* Cache
* Permissions
* Authentication
* Service workers
* IndexedDB
* Session data
* Partition lifecycle

Never accidentally share private/profile-specific state.

When changing session behavior, check all consumers of the session.

---

## 6. Browser UI

Browser UI must account for:

* Tabs
* Windows
* Navigation
* Back/forward
* Reload
* Loading
* Favicon
* Page title
* Downloads
* Popups
* Menus
* Context menus
* Keyboard shortcuts
* Focus
* Accessibility
* High-DPI displays
* Multiple monitors

Do not treat browser chrome like an ordinary website.

---

## 7. React Architecture

Use modern React patterns.

Prefer:

* Functional components
* Hooks
* Small focused components
* Existing project state patterns
* Derived state
* Lazy loading where useful
* Error boundaries where appropriate

Avoid:

* Duplicate state
* Unnecessary effects
* Complex effect chains
* Giant components
* Unnecessary context
* Unnecessary rerenders

Do not optimize React blindly.

Optimize actual expensive paths.

---

## 8. IPC Architecture

IPC must be explicit and narrow.

Avoid generic APIs such as:

```text
executeAnything(...)
sendAnything(...)
invokeAnything(...)
```

Prefer explicit operations.

For every IPC endpoint consider:

* Sender validation
* Input validation
* Return value
* Errors
* Lifecycle
* Race conditions
* Duplicate events
* Cleanup
* Multiple windows
* Renderer destruction

Do not create IPC when the operation can remain inside the same process.

Minimize unnecessary IPC.

---

## 9. Navigation

Browser navigation is security-sensitive.

Consider:

* URL validation
* Origin validation
* Redirects
* External protocols
* Popups
* New windows
* Downloads
* Authentication flows
* Special browser URLs

Do not allow arbitrary navigation to privileged browser UI.

Preserve standard web navigation behavior unless customization is explicitly required.

---

## 10. Native Platform Behavior

When behavior depends on the operating system:

Prefer:

Native platform API
→ Electron API
→ Chromium API
→ existing project implementation
→ standard library
→ custom implementation

Keep platform-specific code isolated.

Do not spread unnecessary platform checks throughout the application.

Consider:

* macOS
* Windows
* Linux

when required by the product.

---

## 11. Browser Compatibility

When changing browser behavior, consider:

* Websites
* Cookies
* Storage
* Authentication
* Permissions
* Downloads
* Popups
* Redirects
* Service workers
* Sessions
* Multiple profiles

Do not optimize for only one test website.

Preserve normal Chromium behavior wherever possible.

---

## 12. Accessibility

Browser UI must support:

* Keyboard navigation
* Focus management
* Semantic controls
* Accessible names
* Screen readers where applicable
* Visible focus
* Appropriate contrast
* Reduced motion where relevant

Do not sacrifice accessibility for implementation convenience.
