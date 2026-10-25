#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);

const isUnitOnly = args.includes('--unit');
const isRegressionOnly = args.includes('--regression');
const isE2EOnly = args.includes('--e2e');
const isCoverage = args.includes('--coverage') || (!isUnitOnly && !isRegressionOnly && !isE2EOnly);

console.log('\n======================================================');
console.log('   InviSurf Automated Test Suite & Coverage Runner    ');
console.log('======================================================\n');

let allPassed = true;

function runStep(title, cmd, cmdArgs) {
  console.log(`▶ Running: ${title}...`);
  const start = Date.now();
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_HTML_OPEN: 'never',
      NODE_ENV: 'test',
    },
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  if (res.status === 0) {
    console.log(`✔ ${title} PASSED (${elapsed}s)\n`);
  } else {
    console.error(`✖ ${title} FAILED with exit code ${res.status} (${elapsed}s)\n`);
    allPassed = false;
  }
  return res.status === 0;
}

if (isE2EOnly) {
  runStep('Playwright E2E Tests', 'npx', ['playwright', 'test', '--config=playwright.config.js']);
} else if (isUnitOnly) {
  const unitArgs = [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    '--test-reporter-destination=tests/reports/unit-results.xml',
    'tests/unit/**/*.test.js',
  ];
  runStep('Unit Tests', 'node', unitArgs);
} else if (isRegressionOnly) {
  const regArgs = [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    '--test-reporter-destination=tests/reports/unit-results.xml',
    'tests/regression/**/*.test.js',
  ];
  runStep('Regression Tests', 'node', regArgs);
} else {
  // Default master run: Unit + Regression with Coverage + JUnit XML
  const testArgs = [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    '--test-reporter-destination=tests/reports/unit-results.xml',
    ...(isCoverage ? ['--experimental-test-coverage'] : []),
    'tests/unit/**/*.test.js',
    'tests/regression/**/*.test.js',
  ];
  runStep('Unit & Regression Test Suites with Coverage', 'node', testArgs);

  if (args.includes('--with-e2e')) {
    runStep('Playwright E2E Tests', 'npx', ['playwright', 'test', '--config=playwright.config.js']);
  }
}

console.log('------------------------------------------------------');
if (allPassed) {
  console.log('✅ ALL TEST SUITES PASSED SUCCESSFULLY\n');
} else {
  console.error('❌ SOME TESTS FAILED\n');
}

// Generate the unified HTML report combining all executed tests
try {
  const { generateHtmlReport } = require('./generate-html-report');
  generateHtmlReport();
} catch (err) {
  console.warn('Could not generate unified HTML report:', err.message);
}

// Automatically show the HTML report in browser only when explicitly requested via --open
const reportDir = path.join(ROOT_DIR, 'tests', 'reports', 'playwright-html');
const hasReport = fs.existsSync(path.join(reportDir, 'index.html'));

if (hasReport) {
  console.log(`\n✔ HTML Test Report generated at:\n  ${path.join(reportDir, 'index.html')}`);
  console.log('  To view the interactive HTML report on browser, run:\n    npm run test:report\n');
}

if (args.includes('--open') && hasReport) {
  console.log('▶ Opening InviSurf HTML Test Report on browser...');
  console.log('  Command: npx playwright show-report tests/reports/playwright-html --port 0\n');
  spawnSync('npx', ['playwright', 'show-report', 'tests/reports/playwright-html', '--port', '0'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });
}

process.exit(allPassed ? 0 : 1);
