// ─── CORE HELPERS ───────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

// ─── TIME FORMATTING ────────────────────────────────────────
function fmtTime12(hhmm) {
  if (!hhmm) return '';
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10);
  var m = parts[1] || '00';
  var ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return h + ':' + m + ' ' + ampm;
}

// ─── TOAST ──────────────────────────────────────────────────
function toast(msg, type, dur) {
  type = type || 'default';
  dur  = dur  || 2800;
  const tw = document.getElementById('tw');
  const t  = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tw.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, dur);
}

// ─── MODALS ─────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
  }
  // Close preset dropdown on outside click
  if (!e.target.closest('#preset-dd-wrap')) {
    el('preset-dd-menu')?.classList.remove('open');
  }
  // Close bell dropdown on outside click (v86)
  if (!e.target.closest('#bell-dd-wrap')) {
    el('bell-dd-menu')?.classList.remove('open');
  }
});

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────
document.addEventListener('keydown', e => {
  // Esc — close open column filter dropdown or modal
  if (e.key === 'Escape') {
    closeColFilter();
    closeAlertFilter();
    document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
    return;
  }
  // Ignore shortcuts when typing in inputs
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  // Cmd/Ctrl + K — jump to customer search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    nav('customers');
    setTimeout(() => el('search-input')?.focus(), 50);
    return;
  }
  // Cmd/Ctrl + Enter — submit score form if on score view
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const scoreView = document.getElementById('view-score');
    if (scoreView?.classList.contains('active')) {
      document.getElementById('score-form').requestSubmit();
    }
    return;
  }
  // Number shortcuts for nav (1-7) — matches sidebar order
  const navMap = { '1':'homebase','2':'alerts','3':'customers','4':'segments','5':'trends','6':'csmperf','7':'calendar' };
  if (!e.metaKey && !e.ctrlKey && !e.altKey && navMap[e.key]) {
    nav(navMap[e.key]);
  }
});
