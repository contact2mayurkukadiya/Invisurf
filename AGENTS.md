<!-- CODEGRAPH_START -->
## CodeGraph & Pre-Planning Protocol

In repositories indexed by CodeGraph (`.codegraph/` exists at repo root):

### 1. Mandatory Pre-Planning Exploration
BEFORE formulating any plan, proposing architecture, or editing files for any feature/fix:
- **ALWAYS execute CodeGraph first**:
  - MCP Tool (if loaded): `codegraph_explore`
  - Shell: `codegraph explore "<feature concept, keywords, or symbols>"`
  - Or trace specifics with `codegraph node "<symbol>"`, `codegraph callers "<symbol>"`, etc.
- **Identify exact target files and symbols** directly from the call graph.
- **DO NOT** perform broad, codebase-wide grep searches, manual file hunting, or multi-directory crawls when CodeGraph can pinpoint the symbols and call paths in a single step.

### 2. Plan Formulation
- Anchor your implementation plan strictly around the symbols, callers/callees, and files returned by the graph.
- Navigate directly to the identified files rather than guessing file locations.

### 3. Keep Index Fresh
- If recent changes are unindexed or if `codegraph explore` reports shifted line numbers, run `codegraph sync` before exploring.

### 4. Mandatory Feature Testing & Verification (Playwright)
AFTER implementing any feature, bug fix, or UI change:
- **Never declare completion without testing**: Validate that the feature works end-to-end.
- **Use the `playwright-cli` skill**:
  - Launch/navigate to the relevant view (e.g. `playwright-cli open <url>` or attach to running instance).
  - Interact with elements, fill forms, trigger clicks, and verify DOM states via `playwright-cli snapshot`.
  - Check for console errors using `playwright-cli console`.
  - Capture visual proof of the working change using `playwright-cli screenshot`.
- Report the test steps and verification outcomes in your response.

### 5. Architecture & Engineering Rules
When planning and implementing any new module or feature, strictly adhere to the engineering guidelines in `.agents/rules/`:
- **01-core-engineering**: Understand before coding, check existing components/APIs first, minimal changes.
- **02-browser-architecture**: Electron main/renderer boundaries, IPC patterns, window/tab context isolation.
- **03-security-performance**: Context isolation, memory leaks, event listener cleanup, resource bounds.
- **04-validation-delivery**: Verification steps, edge cases, and regression avoidance.

<!-- CODEGRAPH_END -->
