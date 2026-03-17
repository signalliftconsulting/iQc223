// ─── GUIDED ONBOARDING WALKTHROUGH ──────────────────────────────────
// Floating checklist panel that guides users through key features after
// demo data is loaded. Persists progress in localStorage.

var _WT_KEY = 'iqc_walkthrough';
var _WT_SEEN = 'iqc_walkthrough_seen';

var _WT_STEPS = [
  { id: 'demo-loaded',       title: 'Demo data loaded',              desc: '75 accounts are ready to explore', auto: true },
  { id: 'portfolio-health',  title: 'See your portfolio health',     desc: 'Review KPIs, at-risk MRR, and renewal pipeline', view: 'homebase' },
  { id: 'check-alert',       title: 'Check your highest-risk alert', desc: 'See the alert that fired for your most critical account' },
  { id: 'customer-deepdive', title: 'Open a customer deep-dive',     desc: 'Explore health signals, score history, and playbook' },
  { id: 'qbr-prep',          title: 'Generate a QBR prep',           desc: 'See an auto-generated quarterly business review' },
  { id: 'connect-data',      title: 'Connect your own data',         desc: 'Import via CSV or connect an integration' }
];

// ── State helpers ───────────────────────────────────────────────────
function _wtGetState() {
  try {
    var raw = localStorage.getItem(_WT_KEY);
    if (raw) { var s = JSON.parse(raw); return { completed: s.completed || [], dismissed: !!s.dismissed, collapsed: !!s.collapsed }; }
  } catch(e) {}
  return { completed: [], dismissed: false, collapsed: false };
}

function _wtSaveState(s) {
  try { localStorage.setItem(_WT_KEY, JSON.stringify(s)); } catch(e) {}
}

function _wtIsActive() {
  try { return localStorage.getItem(_WT_SEEN) === '1'; } catch(e) { return false; }
}

// ── Init — called after demo data loads ─────────────────────────────
function _wtInit() {
  try { localStorage.setItem(_WT_SEEN, '1'); } catch(e) {}
  var s = _wtGetState();
  if (s.dismissed) return;
  // Auto-complete steps 0 and 1 (demo loaded + they're on homebase)
  if (s.completed.indexOf(0) === -1) s.completed.push(0);
  if (s.completed.indexOf(1) === -1) s.completed.push(1);
  _wtSaveState(s);
  _wtInjectPanel();
  _wtRender();
}

// ── Resume — called on page reload if walkthrough was active ────────
function _wtResume() {
  if (!_wtIsActive()) return;
  var s = _wtGetState();
  if (s.dismissed) return;
  if (!customers || !customers.length) return; // no data, don't show
  _wtInjectPanel();
  _wtRender();
}

// ── Inject panel DOM ────────────────────────────────────────────────
function _wtInjectPanel() {
  if (document.getElementById('iqc-wt')) return;

  // Inject pulse animation
  var style = document.createElement('style');
  style.textContent = '@keyframes iqcWtPulse{0%,100%{box-shadow:0 2px 12px rgba(37,99,235,.25)}50%{box-shadow:0 2px 24px rgba(37,99,235,.55)}}@keyframes iqcWtHighlight{0%{background:color-mix(in srgb,var(--teal) 20%,var(--surface))}100%{background:transparent}}';
  document.head.appendChild(style);

  var div = document.createElement('div');
  div.id = 'iqc-wt';
  div.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;font-family:var(--font)';
  document.body.appendChild(div);
}

// ── Render ──────────────────────────────────────────────────────────
function _wtRender() {
  var wrap = document.getElementById('iqc-wt');
  if (!wrap) return;
  var s = _wtGetState();
  var done = s.completed.length;
  var total = _WT_STEPS.length;
  var allDone = done >= total;
  var pct = Math.round(done / total * 100);

  // Find next incomplete step
  var nextIdx = -1;
  for (var i = 0; i < _WT_STEPS.length; i++) {
    if (s.completed.indexOf(i) === -1) { nextIdx = i; break; }
  }

  if (s.collapsed) {
    // FAB only
    var remaining = total - done;
    wrap.innerHTML = '<button onclick="_wtToggle()" style="width:52px;height:52px;border-radius:50%;border:none;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;animation:iqcWtPulse 2s ease-in-out infinite" title="Explore IQcadence">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 3 0 3 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-3 0-3"/></svg>' +
      (remaining > 0 ? '<span style="position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">' + remaining + '</span>' : '') +
      '</button>';
    return;
  }

  // Full panel
  var stepsHTML = '';
  for (var i = 0; i < _WT_STEPS.length; i++) {
    var step = _WT_STEPS[i];
    var isDone = s.completed.indexOf(i) !== -1;
    var isNext = i === nextIdx;
    var circleStyle, circleContent;

    if (isDone) {
      circleStyle = 'background:#16a34a;color:#fff';
      circleContent = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (isNext) {
      circleStyle = 'background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff';
      circleContent = '<span style="font-size:12px;font-weight:700">' + (i + 1) + '</span>';
    } else {
      circleStyle = 'background:var(--border);color:var(--muted)';
      circleContent = '<span style="font-size:12px;font-weight:700">' + (i + 1) + '</span>';
    }

    var titleColor = isDone ? 'var(--muted)' : 'var(--text)';
    var titleDeco = isDone ? 'line-through' : 'none';
    var clickable = !isDone && !step.auto;
    var cursor = clickable ? 'pointer' : 'default';
    var hoverBg = clickable ? 'onmouseenter="this.style.background=\'color-mix(in srgb, var(--teal) 6%, var(--surface))\'" onmouseleave="this.style.background=\'none\'"' : '';
    var onclick = clickable ? 'onclick="_wtStepClick(' + i + ')"' : '';

    stepsHTML += '<div ' + onclick + ' ' + hoverBg + ' style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;cursor:' + cursor + ';transition:background .15s;border-radius:6px;margin:0 4px">' +
      '<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;' + circleStyle + '">' + circleContent + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:var(--fs-sm);color:' + titleColor + ';text-decoration:' + titleDeco + '">' + step.title + '</div>' +
        '<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:1px;line-height:1.3">' + step.desc + '</div>' +
      '</div>' +
    '</div>';
  }

  // Footer
  var footerHTML = '';
  if (allDone) {
    footerHTML = '<div style="padding:14px 16px;border-top:1px solid var(--border);text-align:center">' +
      '<div style="font-weight:700;font-size:var(--fs-sm);color:#16a34a;margin-bottom:8px">Ready to see this for your real accounts?</div>' +
      '<div style="display:flex;gap:8px;justify-content:center">' +
        '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();_wtDismiss();nav(\'csv\')">Import CSV →</button>' +
        '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();_wtDismiss();nav(\'settings\')">Connect Integration →</button>' +
      '</div>' +
    '</div>';
  }

  wrap.innerHTML = '<div style="width:340px;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.12);overflow:hidden;display:flex;flex-direction:column">' +
    // Header
    '<div style="padding:14px 16px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div>' +
          '<div style="font-weight:700;font-size:var(--fs-md)">Explore IQcadence</div>' +
          '<div style="font-size:var(--fs-xs);opacity:.75;margin-top:2px">' + done + ' of ' + total + ' complete</div>' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<button onclick="_wtToggle()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center" title="Minimize">−</button>' +
          '<button onclick="_wtDismiss()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center" title="Close">×</button>' +
        '</div>' +
      '</div>' +
      '<div style="height:3px;background:rgba(255,255,255,.2);border-radius:2px;margin-top:10px"><div style="height:100%;background:#fff;border-radius:2px;width:' + pct + '%;transition:width .3s ease"></div></div>' +
    '</div>' +
    // Steps
    '<div style="padding:6px 0;max-height:340px;overflow-y:auto">' + stepsHTML + '</div>' +
    // Footer
    footerHTML +
  '</div>';
}

// ── Toggle collapse ─────────────────────────────────────────────────
function _wtToggle() {
  var s = _wtGetState();
  s.collapsed = !s.collapsed;
  _wtSaveState(s);
  _wtRender();
}

// ── Dismiss ─────────────────────────────────────────────────────────
function _wtDismiss() {
  var s = _wtGetState();
  s.dismissed = true;
  _wtSaveState(s);
  var w = document.getElementById('iqc-wt');
  if (w) w.style.display = 'none';
}

// ── Reset (for "Restart walkthrough" link) ──────────────────────────
function _wtReset() {
  try {
    localStorage.removeItem(_WT_KEY);
    localStorage.setItem(_WT_SEEN, '1');
  } catch(e) {}
  var w = document.getElementById('iqc-wt');
  if (w) w.style.display = '';
  _wtInit();
}

// ── Step click ──────────────────────────────────────────────────────
function _wtStepClick(idx) {
  var step = _WT_STEPS[idx];
  if (!step) return;

  // Execute action
  if (step.id === 'portfolio-health') {
    nav('homebase');
  } else if (step.id === 'check-alert') {
    nav('alerts');
    setTimeout(_wtHighlightTopAlert, 400);
  } else if (step.id === 'customer-deepdive') {
    _wtOpenHighestRiskCustomer();
  } else if (step.id === 'qbr-prep') {
    _wtOpenQBRForRiskiest();
  } else if (step.id === 'connect-data') {
    // Don't dismiss — let them see the final CTA
    nav('homebase');
    setTimeout(function() { showGettingStarted(); }, 200);
  }

  // Mark complete
  _wtCompleteStep(idx);
}

// ── Complete a step by index ────────────────────────────────────────
function _wtCompleteStep(idx) {
  var s = _wtGetState();
  if (s.completed.indexOf(idx) === -1) {
    s.completed.push(idx);
    _wtSaveState(s);
    _wtRender();
  }
}

// ── Complete by step ID (for hooks in other files) ──────────────────
function _wtCompleteIfActive(stepId) {
  if (!_wtIsActive()) return;
  for (var i = 0; i < _WT_STEPS.length; i++) {
    if (_WT_STEPS[i].id === stepId) { _wtCompleteStep(i); return; }
  }
}

// ── Nav hook — auto-complete view-based steps ───────────────────────
function _wtCheckNav(view) {
  if (!_wtIsActive()) return;
  for (var i = 0; i < _WT_STEPS.length; i++) {
    if (_WT_STEPS[i].view === view) _wtCompleteStep(i);
  }
  // Also: visiting alerts completes step 2
  if (view === 'alerts') _wtCompleteStep(2);
}

// ── Helper: highlight the top alert ─────────────────────────────────
function _wtHighlightTopAlert() {
  var list = document.getElementById('alerts-list');
  if (!list) return;
  // Find the first alert card
  var firstCard = list.querySelector('.card, [onclick*="openDetail"]');
  if (!firstCard) return;
  firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  firstCard.style.animation = 'iqcWtHighlight 1.5s ease';
  setTimeout(function() { firstCard.style.animation = ''; }, 1600);
}

// ── Helper: open highest-risk customer ──────────────────────────────
function _wtOpenHighestRiskCustomer() {
  var active = customers.filter(function(c) { return c.lifecycle !== 'churned'; });
  if (!active.length) return;
  // Sort by score ascending (worst first)
  active.sort(function(a, b) { return a.score - b.score; });
  var target = active[0];
  if (typeof openDetail === 'function') openDetail(target.id);
}

// ── Helper: open QBR for riskiest customer ──────────────────────────
function _wtOpenQBRForRiskiest() {
  var active = customers.filter(function(c) { return c.lifecycle !== 'churned'; });
  if (!active.length) return;
  active.sort(function(a, b) { return a.score - b.score; });
  var target = active[0];
  if (typeof openDetail === 'function') {
    openDetail(target.id);
    // Wait for detail modal to open, then trigger QBR
    setTimeout(function() {
      if (typeof openQBR === 'function') openQBR();
    }, 500);
  }
}
