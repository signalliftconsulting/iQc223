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
  // Number shortcuts for nav (1-6)
  const navMap = { '1':'dashboard','2':'alerts','3':'customers','4':'score','5':'csv','6':'settings' };
  if (!e.metaKey && !e.ctrlKey && !e.altKey && navMap[e.key]) {
    nav(navMap[e.key]);
  }
});
