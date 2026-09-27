---
description: SECURITY AND PERFORMANCE
alwaysApply: true
---

# SECURITY AND PERFORMANCE

Security and performance are mandatory engineering concerns.

Do not sacrifice security for convenience.

Do not add unnecessary optimization complexity.

---

# SECURITY

## 1. Electron Security

Always consider:

* contextIsolation
* sandboxing
* nodeIntegration
* preload exposure
* IPC validation
* navigation validation
* origin validation
* permission handling
* session isolation
* partition isolation
* external protocols
* filesystem access
* path traversal
* command injection
* XSS
* prototype pollution
* arbitrary code execution
* sensitive data
* DevTools exposure

Never expose unrestricted Node.js APIs to untrusted renderer content.

---

## 2. IPC Security

Treat IPC input as untrusted.

Validate:

* Types
* Required fields
* Allowed values
* Object structure
* URLs
* Paths
* IDs
* Permissions

Reject invalid data early.

Do not trust renderer-provided authorization decisions.

Privileged operations must enforce their own security requirements.

---

## 3. Web Content Security

Treat websites as untrusted.

Never allow arbitrary webpage content to:

* Execute privileged browser operations
* Access filesystem APIs
* Access secrets
* Invoke arbitrary IPC
* Modify browser state without authorization

Keep browser chrome and web content separated.

---

## 4. Navigation Security

Validate:

* Destination URL
* Origin
* Protocol
* Redirect behavior
* External application protocols
* New-window requests

Do not blindly load arbitrary URLs into privileged browser UI.

---

## 5. Filesystem Security

For filesystem operations:

* Validate paths
* Prevent traversal
* Restrict allowed directories
* Avoid arbitrary file access
* Avoid shell execution
* Validate filenames
* Handle permissions
* Handle missing files
* Handle races

Never trust renderer-provided filesystem paths.

---

## 6. Sensitive Data

Protect:

* Credentials
* Cookies
* Tokens
* Session information
* API keys
* Authentication state
* User data

Do not log sensitive information.

Do not expose sensitive data through renderer-accessible APIs unnecessarily.

---

## 7. Security Relaxation

Never disable security controls merely because they make development easier.

If a security relaxation is genuinely required:

1. Explain why internally.
2. Limit the relaxation.
3. Identify the risk.
4. Add mitigation.
5. Document the important decision.

---

# PERFORMANCE

## 8. Performance Areas

Consider:

* CPU
* Memory
* GPU
* DOM
* React rendering
* IPC
* Disk I/O
* Network I/O
* Startup
* Window creation
* Tab switching
* Navigation
* Garbage collection
* Event listeners

---

## 9. Avoid Unnecessary Work

Avoid:

* Synchronous operations on hot paths
* Duplicate IPC
* Duplicate network requests
* Repeated filesystem reads
* Unnecessary React state
* Unnecessary rerenders
* Polling when events exist
* Unbounded listeners
* Memory leaks
* Expensive work on UI-critical paths

---

## 10. Optimization

Use:

* Caching
* Batching
* Debouncing
* Throttling
* Lazy loading
* Virtualization
* Memoization

only when they solve an actual problem.

Do not optimize every function.

Do not introduce complex caching or memoization without a real performance reason.

Correctness comes first.

---

## 11. Resource Lifecycle

For every resource ask:

Who owns it?

Who destroys it?

When is it destroyed?

Apply this to:

* BrowserWindow
* WebContents
* WebContentsView
* IPC listeners
* Event listeners
* Timers
* Subscriptions
* Sessions
* Temporary files
* Native resources

Prevent:

* Memory leaks
* Duplicate listeners
* Orphaned views
* Stale references
* Timers surviving destroyed objects
* Duplicate handlers

---

## 12. Race Conditions

Pay special attention to races involving:

* Navigation
* Window creation
* Window destruction
* Renderer reload
* IPC
* Session changes
* Async filesystem operations
* Async network operations
* Tab switching
* Profile switching

Do not rely on arbitrary delays to solve races.

Fix lifecycle/state ordering at the correct boundary.

---

## 13. Error Handling

Handle failures at meaningful boundaries.

Consider:

* Invalid input
* Missing resources
* Destroyed windows
* Destroyed WebContents
* Renderer crashes
* IPC failures
* Filesystem failures
* Network failures
* Permission failures
* Unexpected state

Do not swallow exceptions.

Do not expose sensitive information in errors or logs.

Use existing project logging/error patterns.

---

## 14. Logging

Logs should be:

* Useful
* Appropriately leveled
* Concise
* Safe
* Actionable

Avoid excessive logging.

Remove temporary debugging logs unless intentionally required.

Never log secrets, credentials, tokens, cookies, or sensitive user data.

---

## 15. Performance vs Security

Security takes priority over micro-optimizations.

Never remove validation, isolation, authorization, or sanitization merely to improve performance.

If security logic is expensive:

Optimize the implementation while preserving the security boundary.
