/* ============================================================
   Minimal Test Framework — browser-runnable, zero dependencies
   ============================================================ */
var _suites = [];
var _totalPassed = 0;
var _totalFailed = 0;
var _currentSuite = null;

function describe(name, fn) {
  _suites.push({ name: name, fn: fn, tests: [] });
}

function it(name, fn) {
  if (!_currentSuite) return;
  var result = { name: name, passed: true, error: null };
  try {
    fn();
  } catch (e) {
    result.passed = false;
    result.error = e.message || String(e);
  }
  _currentSuite.tests.push(result);
}

function expect(val) {
  return {
    toBe: function(expected) {
      if (val !== expected) {
        throw new Error('Expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(val));
      }
    },
    toEqual: function(expected) {
      var a = JSON.stringify(val);
      var b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error('Expected ' + b + ' but got ' + a);
      }
    },
    toBeTruthy: function() {
      if (!val) {
        throw new Error('Expected truthy but got ' + JSON.stringify(val));
      }
    },
    toBeFalsy: function() {
      if (val) {
        throw new Error('Expected falsy but got ' + JSON.stringify(val));
      }
    },
    toBeGreaterThan: function(n) {
      if (!(val > n)) {
        throw new Error('Expected ' + val + ' > ' + n);
      }
    },
    toBeLessThan: function(n) {
      if (!(val < n)) {
        throw new Error('Expected ' + val + ' < ' + n);
      }
    },
    toBeGreaterThanOrEqual: function(n) {
      if (!(val >= n)) {
        throw new Error('Expected ' + val + ' >= ' + n);
      }
    },
    toBeLessThanOrEqual: function(n) {
      if (!(val <= n)) {
        throw new Error('Expected ' + val + ' <= ' + n);
      }
    },
    toBeNull: function() {
      if (val !== null) {
        throw new Error('Expected null but got ' + JSON.stringify(val));
      }
    },
    toContain: function(sub) {
      if (typeof val === 'string') {
        if (val.indexOf(sub) === -1) throw new Error('Expected "' + val + '" to contain "' + sub + '"');
      } else if (Array.isArray(val)) {
        if (val.indexOf(sub) === -1) throw new Error('Expected array to contain ' + JSON.stringify(sub));
      } else {
        throw new Error('toContain requires string or array, got ' + typeof val);
      }
    },
    toThrow: function() {
      if (typeof val !== 'function') {
        throw new Error('toThrow expects a function');
      }
      var threw = false;
      try { val(); } catch (e) { threw = true; }
      if (!threw) throw new Error('Expected function to throw but it did not');
    }
  };
}

function runTests() {
  _totalPassed = 0;
  _totalFailed = 0;

  var container = document.getElementById('test-results');
  if (!container) {
    container = document.createElement('div');
    container.id = 'test-results';
    document.body.appendChild(container);
  }
  container.innerHTML = '';

  for (var i = 0; i < _suites.length; i++) {
    var suite = _suites[i];
    _currentSuite = suite;
    suite.tests = [];
    try {
      suite.fn();
    } catch (e) {
      suite.tests.push({ name: '(suite error)', passed: false, error: e.message || String(e) });
    }

    var suiteDiv = document.createElement('div');
    suiteDiv.className = 'suite';

    var suitePassed = 0;
    var suiteFailed = 0;
    for (var j = 0; j < suite.tests.length; j++) {
      if (suite.tests[j].passed) suitePassed++;
      else suiteFailed++;
    }
    _totalPassed += suitePassed;
    _totalFailed += suiteFailed;

    var header = document.createElement('h2');
    header.className = 'suite-header ' + (suiteFailed ? 'has-failures' : 'all-pass');
    header.textContent = suite.name + ' (' + suitePassed + '/' + (suitePassed + suiteFailed) + ' passed)';
    suiteDiv.appendChild(header);

    for (var j = 0; j < suite.tests.length; j++) {
      var t = suite.tests[j];
      var row = document.createElement('div');
      row.className = 'test-row ' + (t.passed ? 'pass' : 'fail');
      row.innerHTML = '<span class="test-icon">' + (t.passed ? '&#10003;' : '&#10007;') + '</span> '
        + '<span class="test-name">' + t.name + '</span>'
        + (t.error ? '<div class="test-error">' + t.error + '</div>' : '');
      suiteDiv.appendChild(row);
    }

    container.appendChild(suiteDiv);
  }

  // Summary bar
  var summary = document.getElementById('test-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.id = 'test-summary';
    document.body.insertBefore(summary, container);
  }
  var total = _totalPassed + _totalFailed;
  summary.className = _totalFailed ? 'summary-fail' : 'summary-pass';
  summary.textContent = _totalPassed + ' / ' + total + ' tests passed'
    + (_totalFailed ? '  —  ' + _totalFailed + ' FAILED' : '  —  All green!');

  _currentSuite = null;
}
