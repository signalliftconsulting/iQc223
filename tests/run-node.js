#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// IQcadence — Node.js Test Runner (CI-compatible)
// Mirrors browser stubs from tests/index.html, runs all suites,
// exits with code 1 if any test fails.
// Usage: node tests/run-node.js
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ─── Minimal DOM stubs ───────────────────────────────────────
const _elements = {};

function _mkEl(tag) {
  const el = {
    tagName: (tag || 'DIV').toUpperCase(), className: '', id: '', textContent: '',
    innerHTML: '', style: { cssText: '', display: '' },
    dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); if (child.id) _elements[child.id] = child; return child; },
    insertBefore(child) { this.children.unshift(child); if (child.id) _elements[child.id] = child; return child; },
    removeChild(child) { if (child.id) delete _elements[child.id]; },
    remove() { if (this.id) delete _elements[this.id]; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
  };
  return el;
}

global.document = {
  getElementById: (id) => _elements[id] || null,
  createElement: (tag) => _mkEl(tag),
  createTextNode: (text) => ({ textContent: text }),
  body: {
    prepend() {},
    appendChild(child) { if (child.id) _elements[child.id] = child; },
    removeChild(child) { if (child.id) delete _elements[child.id]; },
    insertBefore() {},
  },
  head: { appendChild() {} },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

global.window = {
  __IQCADENCE_CONFIG__: {},
  addEventListener() {},
  onerror: null,
  location: { origin: 'http://localhost', href: 'http://localhost' },
};

global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.setTimeout = global.setTimeout;
global.clearTimeout = global.clearTimeout;
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
};
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ data: [] }) });

// ─── App stubs (match tests/index.html) ──────────────────────
global.supabase = { createClient() { return { from() { return { select() { return { eq() { return { limit() { return Promise.resolve({ data: [] }); } }; } }; } }; } }; } };
global.currentUser = null;
global.sb = null;
global._currentPage = 'tests';
global.isAdmin = () => false;
global.nav = () => {};
global.closeColFilter = () => {};
global.closeAlertFilter = () => {};
global.renderCustomers = () => {};
global.renderAlerts = () => {};
global.renderWebhookLog = () => {};
global.loadAuditLog = () => {};
global.updateThresholdLabels = () => {};
global.rv = () => {};
global.syncRevenue = () => {};
global.showWhatsNew = () => {};
global.authSignOut = () => {};
global.getMomentum = () => 'flat';
global._integrationCache = {};
global.toast = () => {};
global.DEFAULT_THRESHOLDS = { critical: 25, risk: 50, watch: 65, healthy: 90 };
global.thresholds = { critical: 25, risk: 50, watch: 65, healthy: 90 };

// ─── Load source modules ─────────────────────────────────────
const root = path.resolve(__dirname, '..');

function loadFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const vm = require('vm');
  vm.runInThisContext(code, { filename: filePath });
}

// Suppress console.log from source modules during test loading
const origLog = console.log;
console.log = () => {};

loadFile(path.join(root, 'js/src/state.js'));
loadFile(path.join(root, 'js/src/utils.js'));
loadFile(path.join(root, 'js/src/scoring.js'));
loadFile(path.join(root, 'js/src/csv.js'));

// Ensure escHtml is available
if (typeof escHtml === 'undefined') {
  global.escHtml = (str) => String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

console.log = origLog;

// ─── Load test framework + suites ────────────────────────────
loadFile(path.join(__dirname, 'runner.js'));
loadFile(path.join(__dirname, 'test-utils.js'));
loadFile(path.join(__dirname, 'test-scoring.js'));
loadFile(path.join(__dirname, 'test-csv.js'));

// ─── Run tests (headless) ────────────────────────────────────
// Override runTests to capture results without DOM rendering
let totalPassed = 0;
let totalFailed = 0;

for (const suite of _suites) {
  _currentSuite = suite;
  suite.tests = [];
  try {
    suite.fn();
  } catch (e) {
    suite.tests.push({ name: '(suite error)', passed: false, error: e.message || String(e) });
  }

  let sp = 0, sf = 0;
  for (const t of suite.tests) {
    if (t.passed) sp++; else sf++;
  }
  totalPassed += sp;
  totalFailed += sf;

  const icon = sf ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
  console.log(`${icon} ${suite.name} (${sp}/${sp + sf} passed)`);

  for (const t of suite.tests) {
    if (!t.passed) {
      console.log(`  \x1b[31m✗ ${t.name}\x1b[0m`);
      if (t.error) console.log(`    ${t.error}`);
    }
  }
}

const total = totalPassed + totalFailed;
console.log('');
if (totalFailed) {
  console.log(`\x1b[31m${totalPassed}/${total} tests passed — ${totalFailed} FAILED\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32m${totalPassed}/${total} tests passed — All green!\x1b[0m`);
  process.exit(0);
}
