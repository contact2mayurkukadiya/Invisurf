---
description: VALIDATION AND DELIVERY
alwaysApply: true
---

# VALIDATION AND DELIVERY

Code is not complete merely because it compiles or was written successfully.

Validation must be proportional to the change.

---

## 1. Before Completion

Check:

* Correctness
* Security
* Performance
* Lifecycle
* Error handling
* Cleanup
* Race conditions
* Edge cases
* Cross-platform behavior where relevant
* Regression risk
* Unused code/imports
* Incorrect dependencies
* Incorrect IPC

Fix issues found before declaring completion.

---

## 2. Testing Strategy

Do not blindly create every possible test type for every change.

Choose tests based on actual risk.

### Trivial change

Examples:

* Text change
* Simple CSS change
* Constant update

Use lightweight validation.

### Non-trivial logic

Use the smallest meaningful runnable check:

* Existing test
* Focused unit test
* Assertion
* Self-check
* Integration test
* IPC test
* Manual verification

### Security-sensitive change

Test relevant:

* Invalid input
* Unauthorized access
* IPC boundaries
* Navigation
* Permission behavior
* Data isolation

### Lifecycle-sensitive change

Test relevant:

* Creation
* Destruction
* Reload
* Restart
* Multiple windows
* Renderer failure

Do not create test infrastructure merely to satisfy a checklist.

---

## 3. Dry Run

For non-trivial changes, trace:

1. Initial state
2. Normal user action
3. Renderer behavior
4. IPC behavior
5. Main process behavior
6. State changes
7. Cleanup
8. Error path
9. Reload/restart if relevant
10. Multiple instances if relevant

Look for:

* Race conditions
* Stale state
* Duplicate events
* Null references
* Lifecycle failures
* Security violations
* Memory leaks

Only perform scenarios relevant to the feature.

---

## 4. Manual Verification

When manual testing is appropriate, identify only the relevant checks.

Examples:

* UI behavior
* Keyboard interaction
* Navigation
* Window behavior
* Multiple tabs
* Multiple windows
* Profile isolation
* Authentication
* Reload
* Restart
* Cross-platform behavior

Do not produce a massive checklist for a trivial change.

---

## 5. Code Review

Before completion verify:

### Correctness

* Requirement implemented
* Root cause addressed
* Existing behavior preserved

### Security

* Trust boundaries preserved
* IPC validated
* External input validated
* No privileged API exposed unnecessarily

### Performance

* No unnecessary hot-path work
* No duplicate IPC
* No obvious memory leak
* No unnecessary rendering

### Maintainability

* Existing patterns reused
* No unnecessary abstractions
* No unrelated refactoring
* Code remains understandable

---

## 6. No Fake Validation

Never claim something was:

* Tested
* Verified
* Benchmarked
* Secure
* Performant
* Production-ready

unless it was actually checked.

Clearly distinguish:

* Implemented
* Reasoned about
* Tested
* Manually verified
* Not tested

---

## 7. Completion Criteria

A task is complete when:

* Requirement is understood.
* Relevant existing code was inspected.
* Correct implementation location was identified.
* Root cause was addressed where applicable.
* Security was considered.
* Performance was considered.
* Relevant lifecycle cases were handled.
* Required error handling exists.
* Relevant validation was performed.
* No unnecessary architecture was introduced.
* No unrelated behavior was changed.

Do not require every theoretical checklist item for every task.

Validation must match the risk and scope of the change.

---

# OUTPUT DISCIPLINE

The AI has a limited token budget.

Do not waste output tokens.

After implementation, use this format:

## Changed

* `path/file`: concise description
* `path/file`: concise description

## Validation

* What was actually checked
* What was actually tested

## Note

Only include this section when there is:

* Important limitation
* Manual step required
* Unresolved issue
* Security concern
* Important architectural decision

Do not add a generic summary.

Do not repeat the implementation.

Do not explain obvious code.

Do not provide unsolicited future improvements.

---

## When More Explanation Is Required

Explain more only when:

* The user asks for an explanation.
* Architecture changed significantly.
* A security trade-off exists.
* Multiple valid approaches exist.
* A platform-specific limitation matters.
* A non-obvious design decision needs justification.

Otherwise remain concise.

---

# FINAL PRINCIPLE

Think deeply.

Inspect carefully.

Implement correctly.

Validate appropriately.

Respond briefly.

**Reduce words, not engineering quality.**
