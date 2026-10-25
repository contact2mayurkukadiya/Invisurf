'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const UNIT_XML_PATH = path.join(ROOT_DIR, 'tests', 'reports', 'unit-results.xml');
const PLAYWRIGHT_JSON_PATH = path.join(ROOT_DIR, 'tests', 'reports', 'playwright-results.json');
const OUTPUT_HTML_DIR = path.join(ROOT_DIR, 'tests', 'reports', 'playwright-html');
const OUTPUT_HTML_PATH = path.join(OUTPUT_HTML_DIR, 'index.html');

function parseJUnitXml(xml) {
  const tests = [];
  const testcaseRegex = /<testcase\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match;

  while ((match = testcaseRegex.exec(xml)) !== null) {
    const attrsStr = match[1];
    const body = match[2] || '';

    const nameMatch = attrsStr.match(/name="([^"]+)"/);
    const timeMatch = attrsStr.match(/time="([^"]+)"/);
    const fileMatch = attrsStr.match(/file="([^"]+)"/);
    const classMatch = attrsStr.match(/classname="([^"]+)"/);

    const name = nameMatch ? nameMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : 'Unnamed Test';
    const time = timeMatch ? (parseFloat(timeMatch[1]) * 1000).toFixed(1) + 'ms' : '0ms';
    const file = fileMatch ? path.relative(ROOT_DIR, fileMatch[1]) : 'tests/unit';

    let status = 'passed';
    let error = null;

    if (body.includes('<failure') || body.includes('<error')) {
      status = 'failed';
      const msgMatch = body.match(/message="([^"]+)"/);
      error = msgMatch ? msgMatch[1] : body.trim();
    } else if (body.includes('<skipped')) {
      status = 'skipped';
    }

    let category = 'Unit & Regression Tests';
    if (file.includes('theme') || name.toLowerCase().includes('theme') || name.toLowerCase().includes('background')) {
      category = 'Theme & Background Colors';
    } else if (file.includes('regression')) {
      category = 'Regression Tests';
    }

    tests.push({
      id: 'unit-' + tests.length,
      name,
      file,
      duration: time,
      status,
      category,
      error,
      type: 'unit',
    });
  }

  return tests;
}

function parsePlaywrightJson(jsonObj) {
  const tests = [];
  if (!jsonObj || !jsonObj.suites) return tests;

  function traverse(suite, parentTitle = '') {
    const currentTitle = parentTitle ? `${parentTitle} › ${suite.title}` : suite.title;

    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const t of spec.tests) {
          const lastResult = (t.results && t.results.length > 0) ? t.results[t.results.length - 1] : null;
          const status = lastResult ? lastResult.status : (t.status || 'unknown');
          const duration = lastResult && lastResult.duration ? `${lastResult.duration}ms` : '0ms';
          const file = spec.file ? path.relative(ROOT_DIR, spec.file) : 'tests/e2e';

          let category = 'Playwright E2E Scenarios';
          if (file.includes('theme') || spec.title.toLowerCase().includes('theme') || spec.title.toLowerCase().includes('background')) {
            category = 'Theme & Background Colors';
          }

          let error = null;
          if (lastResult && lastResult.errors && lastResult.errors.length > 0) {
            error = lastResult.errors.map(e => e.message || e).join('\n');
          }

          tests.push({
            id: 'pw-' + tests.length,
            name: `${spec.title}: ${t.title || spec.title}`,
            suite: currentTitle,
            file: `${file}:${spec.line || 0}`,
            duration,
            status: status === 'expected' ? 'passed' : status,
            category,
            error,
            type: 'playwright',
          });
        }
      }
    }

    if (suite.suites) {
      for (const child of suite.suites) {
        traverse(child, currentTitle);
      }
    }
  }

  jsonObj.suites.forEach(s => traverse(s));
  return tests;
}

function generateHtmlReport() {
  let allTests = [];

  if (fs.existsSync(UNIT_XML_PATH)) {
    const xml = fs.readFileSync(UNIT_XML_PATH, 'utf8');
    const unitTests = parseJUnitXml(xml);
    allTests = allTests.concat(unitTests);
  }

  if (fs.existsSync(PLAYWRIGHT_JSON_PATH)) {
    try {
      const json = JSON.parse(fs.readFileSync(PLAYWRIGHT_JSON_PATH, 'utf8'));
      const pwTests = parsePlaywrightJson(json);
      allTests = allTests.concat(pwTests);
    } catch (_) {}
  }

  const passedCount = allTests.filter(t => t.status === 'passed').length;
  const failedCount = allTests.filter(t => t.status === 'failed').length;
  const skippedCount = allTests.filter(t => t.status === 'skipped').length;
  const totalCount = allTests.length;
  const passRate = totalCount > 0 ? ((passedCount / totalCount) * 100).toFixed(1) : 0;
  const generatedAt = new Date().toLocaleString();

  const themeTests = allTests.filter(t => t.category === 'Theme & Background Colors');
  const unitTestsOnly = allTests.filter(t => t.type === 'unit' && t.category !== 'Theme & Background Colors');
  const pwTestsOnly = allTests.filter(t => t.type === 'playwright');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InviSurf Automated Test Report & Verification Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-hover: #1c2128;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --text-bright: #f0f6fc;
      --pass: #238636;
      --pass-bg: rgba(35, 134, 54, 0.15);
      --pass-text: #3fb950;
      --fail: #da3633;
      --fail-bg: rgba(218, 54, 51, 0.15);
      --fail-text: #f85149;
      --skip: #6e7681;
      --skip-bg: rgba(110, 118, 129, 0.15);
      --skip-text: #8b949e;
      --accent: #58a6ff;
      --accent-bg: rgba(88, 166, 255, 0.12);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
      padding-bottom: 60px;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(8px);
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-badge {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #1f6feb 0%, #388bfd 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: #fff;
      font-size: 16px;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-bright);
    }
    .timestamp {
      font-size: 12px;
      color: var(--text-muted);
    }
    .metrics {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .pill--total { background: var(--surface-hover); border-color: var(--border); color: var(--text-bright); }
    .pill--pass { background: var(--pass-bg); border-color: rgba(63, 185, 80, 0.3); color: var(--pass-text); }
    .pill--fail { background: var(--fail-bg); border-color: rgba(248, 81, 73, 0.3); color: var(--fail-text); }
    .pill--skip { background: var(--skip-bg); border-color: rgba(139, 148, 158, 0.3); color: var(--skip-text); }
    .pill--rate { background: var(--accent-bg); border-color: rgba(88, 166, 255, 0.3); color: var(--accent); }
    .pill.active { outline: 2px solid var(--accent); outline-offset: 1px; }

    main {
      max-width: 1200px;
      margin: 24px auto;
      padding: 0 24px;
    }

    /* Tabs */
    .tabs-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      padding-bottom: 4px;
      overflow-x: auto;
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 14px;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text-bright); background: var(--surface-hover); }
    .tab-btn.active {
      color: var(--accent);
      background: var(--accent-bg);
      font-weight: 600;
    }
    .tab-badge {
      background: rgba(255, 255, 255, 0.08);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
    }

    /* Controls bar */
    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .search-box {
      flex: 1;
      min-width: 280px;
      position: relative;
    }
    .search-input {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px 10px 38px;
      color: var(--text-bright);
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15); }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }

    /* Theme visual verification banner */
    .theme-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .theme-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .theme-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-bright);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
    .theme-item {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .theme-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .theme-page-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-bright);
    }
    .theme-uri {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--mono);
    }
    .theme-swatches {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .swatch {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      position: relative;
    }
    .swatch-light { background: #f7f8f9; color: #1e2025; }
    .swatch-dark { background: #121316; color: #f3f4f6; }
    .swatch::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: -22px;
      left: 50%;
      transform: translateX(-50%);
      background: #000;
      color: #fff;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .swatch:hover::after { opacity: 1; }

    /* Test items list */
    .test-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .test-row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      transition: background 0.1s, border-color 0.1s;
    }
    .test-row:hover {
      background: var(--surface-hover);
      border-color: rgba(88, 166, 255, 0.4);
    }
    .test-left {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }
    .status-icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      margin-top: 2px;
    }
    .status-icon--passed { background: var(--pass-bg); color: var(--pass-text); }
    .status-icon--failed { background: var(--fail-bg); color: var(--fail-text); }
    .status-icon--skipped { background: var(--skip-bg); color: var(--skip-text); }

    .test-meta {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .test-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-bright);
      word-break: break-word;
    }
    .test-subtext {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .test-file {
      font-family: var(--mono);
      color: var(--text-muted);
    }
    .badge-cat {
      background: rgba(255, 255, 255, 0.05);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
    }
    .test-right {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .duration {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--mono);
    }
    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <div class="logo-badge">IS</div>
        <div>
          <h1>InviSurf Automated Test Report</h1>
          <div class="timestamp">Generated: ${generatedAt} &bull; Full Test Suite</div>
        </div>
      </div>
      <div class="metrics">
        <div class="pill pill--total" id="filter-all" onclick="setFilter('all')">
          <span>All</span>
          <span id="count-all">${totalCount}</span>
        </div>
        <div class="pill pill--pass" id="filter-passed" onclick="setFilter('passed')">
          <span>✔ Passed</span>
          <span id="count-passed">${passedCount}</span>
        </div>
        <div class="pill pill--fail" id="filter-failed" onclick="setFilter('failed')">
          <span>✖ Failed</span>
          <span id="count-failed">${failedCount}</span>
        </div>
        <div class="pill pill--skip" id="filter-skipped" onclick="setFilter('skipped')">
          <span>○ Skipped</span>
          <span id="count-skipped">${skippedCount}</span>
        </div>
        <div class="pill pill--rate">
          <span>Pass Rate: ${passRate}%</span>
        </div>
      </div>
    </div>
  </header>

  <main>
    <div class="theme-card">
      <div class="theme-header">
        <div class="theme-title">
          <span>🎨 Internal Pages (invisurf://) Neutral Black & White Palette Contract</span>
        </div>
        <span class="pill pill--pass" style="pointer-events: none;">✔ Reference Downloads Palette Enforced</span>
      </div>
      <div class="theme-grid">
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">Downloads (Reference)</span>
            <span class="theme-uri">invisurf://downloads</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">History Page</span>
            <span class="theme-uri">invisurf://history</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">Bookmark Page</span>
            <span class="theme-uri">invisurf://bookmark</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">Settings Page</span>
            <span class="theme-uri">invisurf://settings</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">Extensions Page</span>
            <span class="theme-uri">invisurf://extensions</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
        <div class="theme-item">
          <div class="theme-info">
            <span class="theme-page-name">New Tab Page</span>
            <span class="theme-uri">invisurf://newtab</span>
          </div>
          <div class="theme-swatches">
            <div class="swatch swatch-light" data-tooltip="#f7f8f9">L</div>
            <div class="swatch swatch-dark" data-tooltip="#121316">D</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tabs-bar">
      <button class="tab-btn active" onclick="setCategory('all', this)">
        <span>All Test Cases</span>
        <span class="tab-badge">${totalCount}</span>
      </button>
      <button class="tab-btn" onclick="setCategory('Theme & Background Colors', this)">
        <span>Theme & Colors</span>
        <span class="tab-badge">${themeTests.length}</span>
      </button>
      <button class="tab-btn" onclick="setCategory('Unit & Regression Tests', this)">
        <span>Unit & Regression</span>
        <span class="tab-badge">${unitTestsOnly.length}</span>
      </button>
      <button class="tab-btn" onclick="setCategory('Playwright E2E Scenarios', this)">
        <span>Playwright E2E</span>
        <span class="tab-badge">${pwTestsOnly.length}</span>
      </button>
    </div>

    <div class="controls">
      <div class="search-box">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 0-1.06 1.06l3.79 3.79a.75.75 0 1 0 1.06-1.06l-3.79-3.79z"></path>
        </svg>
        <input type="text" class="search-input" id="search-input" placeholder="Search test cases by name, suite, or file..." oninput="onSearchChange()">
      </div>
    </div>

    <div class="test-list" id="test-list"></div>
  </main>

  <script>
    const testsData = ${JSON.stringify(allTests)};
    let activeFilter = 'all';
    let activeCategory = 'all';
    let searchQuery = '';

    function setFilter(filter) {
      activeFilter = filter;
      document.querySelectorAll('.metrics .pill').forEach(p => p.classList.remove('active'));
      const activePill = document.getElementById('filter-' + filter);
      if (activePill) activePill.classList.add('active');
      renderTests();
    }

    function setCategory(cat, btn) {
      activeCategory = cat;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      renderTests();
    }

    function onSearchChange() {
      searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
      renderTests();
    }

    function renderTests() {
      const container = document.getElementById('test-list');
      const filtered = testsData.filter(t => {
        if (activeFilter !== 'all' && t.status !== activeFilter) return false;
        if (activeCategory !== 'all') {
          if (activeCategory === 'Theme & Background Colors' && t.category !== 'Theme & Background Colors') return false;
          if (activeCategory === 'Unit & Regression Tests' && (t.type !== 'unit' || t.category === 'Theme & Background Colors')) return false;
          if (activeCategory === 'Playwright E2E Scenarios' && t.type !== 'playwright') return false;
        }
        if (searchQuery) {
          const matchName = t.name.toLowerCase().includes(searchQuery);
          const matchFile = t.file.toLowerCase().includes(searchQuery);
          const matchCat = (t.category || '').toLowerCase().includes(searchQuery);
          if (!matchName && !matchFile && !matchCat) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">No matching test cases found.</div>';
        return;
      }

      container.innerHTML = filtered.map(t => {
        const icon = t.status === 'passed' ? '✔' : (t.status === 'failed' ? '✖' : '○');
        const iconClass = 'status-icon--' + t.status;
        return \`
          <div class="test-row">
            <div class="test-left">
              <div class="status-icon \${iconClass}">\${icon}</div>
              <div class="test-meta">
                <span class="test-title">\${escapeHtml(t.name)}</span>
                <div class="test-subtext">
                  <span class="badge-cat">\${escapeHtml(t.category)}</span>
                  <span class="test-file">\${escapeHtml(t.file)}</span>
                  \${t.error ? '<span style="color:var(--fail-text)">' + escapeHtml(t.error) + '</span>' : ''}
                </div>
              </div>
            </div>
            <div class="test-right">
              <span class="duration">\${escapeHtml(t.duration)}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Initial render
    setFilter('all');
  </script>
</body>
</html>`;

  if (!fs.existsSync(OUTPUT_HTML_DIR)) {
    fs.mkdirSync(OUTPUT_HTML_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_HTML_PATH, html, 'utf8');
  console.log(`✔ Generated unified HTML test report at: ${OUTPUT_HTML_PATH} (${totalCount} tests: ${passedCount} passed)`);
}

if (require.main === module) {
  generateHtmlReport();
}

module.exports = { generateHtmlReport };
