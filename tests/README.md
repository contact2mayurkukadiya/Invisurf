# InviSurf Automated Test Suite

Comprehensive testing architecture for InviSurf featuring unit, regression, and Playwright end-to-end tests with high code coverage.

---

## 📁 Directory Structure

```text
tests/
├── e2e/                         # Playwright End-to-End tests (Electron GUI automation)
│   ├── fixtures/
│   │   ├── electronApp.js       # Playwright Electron fixture with isolated temporary user profiles
│   │   └── seed.spec.js         # Seed spec for exploration & generation via playwright-cli
│   ├── navigation/              # Omnibox URL typing, enter, back, forward, reload
│   ├── tabs/                    # Tab opening, switching, closing, responsive track
│   └── bookmarks/               # Bookmark button, star indicator, popovers
├── unit/                        # Fast, deterministic logic tests targeting ~100% coverage
│   ├── permissions/             # PermissionPromptQueue, PermissionDatabase, types & RFC 6454 origins
│   ├── services/                # bookmarkService, settingsService, cookie policies
│   └── security/                # encryption.js (AES-256-GCM cipher, fallbacks, corruption resilience)
├── regression/                  # Bug reproductions and critical contract checks
│   ├── ipc/                     # Frontend <-> Main process IPC channel synchronization
│   └── permissions/             # Burst concurrency race condition handling (50+ simultaneous requests)
├── specs/                       # Markdown test plan specifications (plan → generate → heal workflow)
│   ├── navigation.plan.md
│   ├── tabs.plan.md
│   └── permissions.plan.md
├── helpers/
│   └── setupUnitTests.js        # Electron module mocks for running unit tests in pure Node
├── scripts/
│   └── run-all-tests.js         # Master automated test runner
└── playwright.config.js         # Playwright test configuration
```

---

## 🚀 Running Tests

### 1. Run All Core Tests with Code Coverage (Default)
```bash
npm test
```
*Executes all 52+ unit and regression tests with built-in V8 code coverage report in < 1 second.*

### 2. Run Only Unit Tests
```bash
npm run test:unit
```

### 3. Run Only Regression Tests
```bash
npm run test:regression
```

### 4. Run Built-in Coverage Report
```bash
npm run test:coverage
```

### 5. Run Playwright E2E Tests (Electron Automation)
```bash
npm run test:e2e
```

### 6. Run Everything (Unit + Regression + E2E + HTML Report)
```bash
npm run test:all
```
*Executes all unit, regression, and Playwright E2E suites, and automatically opens the Playwright HTML test report in your browser.*

### 7. View HTML Test Report Anytime
```bash
npm run test:report
# or directly:
npx playwright show-report tests/reports/playwright-html
```
*Launches the Playwright HTML test report web server and opens the results in your default browser.*

---

## 🛠️ Using the Playwright CLI Skill

This workspace is integrated with the `playwright-cli` agent skill. You can explore and record scenarios interactively:

```bash
# Start an interactive debugging session on the seed test:
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/fixtures/seed.spec.js --debug=cli

# Attach to the test session using playwright-cli:
playwright-cli attach <session-name>
```
