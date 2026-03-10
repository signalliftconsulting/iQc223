// ─── CALENDAR PAGE ──────────────────────────────────────────
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calCustFilter = ''; // customer ID filter
let _calCustName   = ''; // display name for selected customer
let _calSearchOpen = false;

function renderCalendar() {
  try { _renderCalendar(); } catch(e) { console.error('renderCalendar error:', e); }
}

function _renderCalendar() {
  const wrap = el('calendar-wrap');
  if (!wrap) return;

  const now = new Date();
  const year = _calYear;
  const month = _calMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  // Collect events from filtered customers
  const allActive = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const active = _calCustFilter ? allActive.filter(c => c.id === _calCustFilter) : allActive;
  const events = [];

  const todayStr = now.toISOString().slice(0, 10);
  active.forEach(c => {
    if (c.renewal_date) {
      events.push({ date: c.renewal_date.slice(0,10), type: 'renewal', customer: c });
    }
    if (c.next_touch) {
      var ntDate = c.next_touch.slice(0,10);
      // Skip if there's a matching scheduled touch_history entry (avoid duplicate pills)
      var _hasDup = c.touch_history && c.touch_history.some(function(th) {
        return th.status === 'scheduled' && th.date && th.date.slice(0,10) === ntDate;
      });
      if (!_hasDup) {
        events.push({ date: ntDate, type: ntDate < todayStr ? 'past-completed' : 'touch', customer: c, isNextTouch: true });
      }
    }
    if (c.last_contact_date) {
      const lcd = new Date(c.last_contact_date);
      const daysSince = Math.floor((now - lcd) / 86400000);
      if (daysSince > 30) {
        events.push({ date: todayStr, type: 'overdue', customer: c, daysSince: daysSince });
      }
    }
    // Touches from touch_history (past + scheduled)
    if (c.touch_history && c.touch_history.length) {
      c.touch_history.forEach(function(th, idx) {
        if (th.date) {
          var thType;
          if (th.status === 'scheduled') {
            thType = th.date.slice(0,10) >= todayStr ? 'touch' : 'past-completed';
          } else if (th.status === 'missed') {
            thType = 'past-missed';
          } else {
            thType = 'past-completed';
          }
          events.push({
            date: th.date.slice(0,10),
            type: thType,
            customer: c,
            histIdx: idx,
            isScheduledHistory: th.status === 'scheduled'
          });
        }
      });
    }
  });

  // Build events-by-date map for this month
  const monthPrefix = year + '-' + String(month + 1).padStart(2, '0');
  const evByDate = {};
  events.forEach(ev => {
    if (ev.date.startsWith(monthPrefix)) {
      if (!evByDate[ev.date]) evByDate[ev.date] = [];
      evByDate[ev.date].push(ev);
    }
  });

  // Stat counts for this month
  const renewalCount    = events.filter(e => e.type === 'renewal'        && e.date.startsWith(monthPrefix)).length;
  const touchCount      = events.filter(e => e.type === 'touch'          && e.date.startsWith(monthPrefix)).length;
  const overdueCount    = events.filter(e => e.type === 'overdue').length;
  const pastTouchCount  = events.filter(e => (e.type === 'past-completed' || e.type === 'past-missed') && e.date.startsWith(monthPrefix)).length;

  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Header ──
  var html = '<div class="cal-header">' +
    '<div class="cal-nav">' +
      '<button class="btn btn-ghost btn-sm" onclick="calPrev()">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<h2 class="cal-month-label">' + monthLabel + '</h2>' +
      '<button class="btn btn-ghost btn-sm" onclick="calNext()">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>' +
      '<button class="btn btn-outline btn-sm" onclick="calToday()" style="margin-left:8px">Today</button>' +
    '</div>' +
    '<div class="cal-legend">' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--renewal"></span>Renewal</span>' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--touch"></span>Scheduled</span>' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--past-completed"></span>Completed</span>' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--past-missed"></span>Missed</span>' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--overdue"></span>Overdue</span>' +
    '</div>' +
  '</div>';

  // ── Customer search filter ──
  var custOpts = allActive.slice().sort(function(a,b) { return a.name.localeCompare(b.name); });
  html += '<div class="cal-filter-row">';
  html += '<div class="cal-search-wrap">';
  html += '<input type="text" id="cal-cust-search" class="cal-search-input" placeholder="Search customers\u2026"' +
    ' value="' + escHtml(_calCustName) + '"' +
    ' oninput="calSearchInput(this.value)" onfocus="calSearchFocus()" onblur="calSearchBlur()" autocomplete="off" />';
  if (_calCustFilter) {
    html += '<button class="cal-search-clear" onclick="calClearCustFilter()" title="Clear">&times;</button>';
  }
  html += '<div id="cal-search-results" class="cal-search-results" style="display:none"></div>';
  html += '</div>';

  // Context bar — show last/next call when a customer is selected
  if (_calCustFilter) {
    var fc = allActive.find(function(c) { return c.id === _calCustFilter; });
    if (fc) {
      var _fmtD = function(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'; };
      // Find last past touch from history (most recent)
      var lastTouch = '';
      if (fc.touch_history && fc.touch_history.length) {
        var sorted = fc.touch_history.slice().sort(function(a,b) { return b.date.localeCompare(a.date); });
        lastTouch = sorted[0].date;
      }
      if (!lastTouch && fc.last_contact_date) lastTouch = fc.last_contact_date;
      html += '<div class="cal-ctx-bar">';
      html += '<span class="cal-ctx-item"><span class="cal-ctx-label">Last Call</span><span class="cal-ctx-val">' + _fmtD(lastTouch) + '</span></span>';
      html += '<span class="cal-ctx-sep"></span>';
      var nextTimeDisp = fc.next_touch_time ? ' at ' + fmtTime12(fc.next_touch_time) : '';
      html += '<span class="cal-ctx-item"><span class="cal-ctx-label">Next Scheduled</span><span class="cal-ctx-val">' + _fmtD(fc.next_touch) + nextTimeDisp + '</span></span>';
      html += '<span class="cal-ctx-sep"></span>';
      html += '<span class="cal-ctx-item"><span class="cal-ctx-label">Renewal</span><span class="cal-ctx-val">' + _fmtD(fc.renewal_date) + '</span></span>';
      html += '</div>';
    }
  }
  html += '</div>';

  // ── Today's Schedule banner ──
  (() => {
    const todayD = new Date(); todayD.setHours(0,0,0,0);
    const dateLabel = todayD.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Today's events
    const todayEvents = events.filter(e => e.date === todayStr);
    const todayRenewals = todayEvents.filter(e => e.type === 'renewal');
    const todayTouches  = todayEvents.filter(e => e.type === 'touch');
    const todayOverdue  = todayEvents.filter(e => e.type === 'overdue');

    // Rest of this calendar week (Sun–Sat), excluding today
    const dow = todayD.getDay(); // 0=Sun
    const daysLeft = 6 - dow;   // days remaining until Saturday
    const upcoming = [];
    for (let d = 1; d <= daysLeft; d++) {
      const dt = new Date(todayD); dt.setDate(dt.getDate() + d);
      const ds = dt.toISOString().slice(0,10);
      events.forEach(e => { if (e.date === ds && (e.type === 'renewal' || e.type === 'touch')) upcoming.push(e); });
    }
    const upcomingRenewals = upcoming.filter(e => e.type === 'renewal');
    const upcomingTouches  = upcoming.filter(e => e.type === 'touch');

    // Build summary items
    const lines = [];

    // Today's calls — sort by time (earliest first)
    var _evTime = function(e) {
      if (e.histIdx != null && e.customer.touch_history && e.customer.touch_history[e.histIdx]) return e.customer.touch_history[e.histIdx].time || '';
      if (e.isNextTouch) return e.customer.next_touch_time || '';
      return '';
    };
    todayTouches.sort(function(a,b) { return (_evTime(a)||'99:99').localeCompare(_evTime(b)||'99:99'); });
    if (todayTouches.length) {
      const names = todayTouches.slice(0,3).map(e => {
        var t = _evTime(e) ? fmtTime12(_evTime(e)) + ' ' : '';
        return '<strong>' + t + escHtml(e.customer.name) + '</strong>';
      }).join(', ');
      lines.push({ icon: 'phone', accent: 'var(--blue)',
        text: todayTouches.length + ' call' + (todayTouches.length > 1 ? 's' : '') + ' scheduled today — ' + names + (todayTouches.length > 3 ? ' +' + (todayTouches.length - 3) + ' more' : '') });
    }

    // Today's renewals
    if (todayRenewals.length) {
      const names = todayRenewals.map(e => '<strong>' + escHtml(e.customer.name) + '</strong> ($' + fmtNum(e.customer.mrr||0) + '/mo)').join(', ');
      lines.push({ icon: 'alert', accent: 'var(--purple)',
        text: todayRenewals.length + ' renewal' + (todayRenewals.length > 1 ? 's' : '') + ' due today — ' + names });
    }

    // Overdue contacts
    if (todayOverdue.length) {
      const sorted = todayOverdue.slice().sort((a,b) => (b.daysSince||0) - (a.daysSince||0));
      const top3 = sorted.slice(0,3).map(e => escHtml(e.customer.name) + ' (' + (e.daysSince||30) + 'd)').join(', ');
      lines.push({ icon: 'overdue', accent: 'var(--red)',
        text: '<strong>' + todayOverdue.length + '</strong> account' + (todayOverdue.length > 1 ? 's' : '') + ' overdue for contact — ' + top3 + (todayOverdue.length > 3 ? ' +' + (todayOverdue.length - 3) + ' more' : '') });
    }

    // Rest of this week (Sun–Sat)
    if (upcomingRenewals.length) {
      const names = upcomingRenewals.slice(0,3).map(e => {
        const d = new Date(e.date + 'T12:00:00');
        return escHtml(e.customer.name) + ' (' + d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) + ')';
      }).join(', ');
      lines.push({ icon: 'cal', accent: 'var(--purple)',
        text: upcomingRenewals.length + ' renewal' + (upcomingRenewals.length > 1 ? 's' : '') + ' later this week — ' + names });
    }

    if (upcomingTouches.length) {
      const byDay = {};
      upcomingTouches.forEach(e => { byDay[e.date] = (byDay[e.date]||0) + 1; });
      const dayCount = Object.keys(byDay).length;
      lines.push({ icon: 'phone', accent: 'var(--teal)',
        text: upcomingTouches.length + ' more call' + (upcomingTouches.length > 1 ? 's' : '') + ' later this week across ' + dayCount + ' day' + (dayCount > 1 ? 's' : '') });
    }

    // Nothing happening
    if (!lines.length) {
      lines.push({ icon: 'check', accent: 'var(--green)',
        text: 'Nothing on the schedule today or this week' });
    }

    const iconSvgs = {
      phone: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
      cal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      overdue: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    };

    html += '<div class="cal-today-banner">';
    html += '<div class="cal-today-date">' + dateLabel + '</div>';
    html += '<div class="cal-today-items">';
    lines.forEach(l => {
      html += '<div class="cal-today-item">';
      html += '<span class="cal-today-icon" style="color:' + l.accent + '">' + (iconSvgs[l.icon] || iconSvgs.cal) + '</span>';
      html += '<span class="cal-today-text">' + l.text + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  })();

  // ── Stat cards (dynamic number colors, headers stay static) ──
  var _calOverdueValColor = overdueCount > 0 ? '#dc2626' : '#16a34a';
  html += '<div class="cal-stats">' +
    '<div class="cal-stat-card" style="--accent-color:var(--purple)" title="Contract renewals occurring this month.">' +
      '<div class="cal-stat-num">' + renewalCount + '</div>' +
      '<div class="cal-stat-label">Renewals</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--blue)" title="Upcoming customer touchpoints scheduled this month.">' +
      '<div class="cal-stat-num">' + touchCount + '</div>' +
      '<div class="cal-stat-label">Scheduled</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--green)" title="Completed customer calls and check-ins this month.">' +
      '<div class="cal-stat-num">' + pastTouchCount + '</div>' +
      '<div class="cal-stat-label">Past Calls</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--red)" title="Customers past their required contact interval. Red when any are overdue.">' +
      '<div class="cal-stat-num" style="color:' + _calOverdueValColor + '">' + overdueCount + '</div>' +
      '<div class="cal-stat-label">Overdue</div>' +
    '</div>' +
  '</div>';

  // ── Calendar grid ──
  html += '<div class="cal-grid-wrap"><table class="cal-grid"><thead><tr>';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) { html += '<th>' + d + '</th>'; });
  html += '</tr></thead><tbody>';

  var dayNum = 1;
  var totalCells = startDow + daysInMonth;
  var rows = Math.ceil(totalCells / 7);

  for (var r = 0; r < rows; r++) {
    html += '<tr>';
    for (var col = 0; col < 7; col++) {
      var cellIdx = r * 7 + col;
      if (cellIdx < startDow || dayNum > daysInMonth) {
        html += '<td class="cal-cell cal-cell--empty"></td>';
      } else {
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
        var isToday = (year === today.getFullYear() && month === today.getMonth() && dayNum === today.getDate());
        var dayEvents = evByDate[dateStr] || [];
        var hasEv = dayEvents.length > 0;

        html += '<td class="cal-cell' + (isToday ? ' cal-cell--today' : '') + (hasEv ? ' cal-cell--has-events' : '') +
          '" data-date="' + dateStr + '" onclick="calShowPopover(this,\'' + dateStr + '\')">';
        html += '<div class="cal-day-num">' + dayNum + '</div>';

        if (hasEv) {
          html += '<div class="cal-pills">';
          var maxPills = 3;
          if (dayEvents.length <= maxPills) {
            dayEvents.forEach(function(ev) {
              var timeStr = '';
              if (ev.isNextTouch && ev.customer.next_touch_time) {
                timeStr = fmtTime12(ev.customer.next_touch_time) + ' \u00B7 ';
              }
              if (ev.histIdx != null && ev.customer.touch_history && ev.customer.touch_history[ev.histIdx] && ev.customer.touch_history[ev.histIdx].time) {
                timeStr = fmtTime12(ev.customer.touch_history[ev.histIdx].time) + ' \u00B7 ';
              }
              html += '<span class="cal-pill cal-pill--' + ev.type + '">' + timeStr + escHtml(ev.customer.name) + '</span>';
            });
          } else {
            var byType = {};
            dayEvents.forEach(function(ev) {
              if (!byType[ev.type]) byType[ev.type] = [];
              byType[ev.type].push(ev);
            });
            var pillCount = 0;
            var typeLabels = { renewal:'Renewal', touch:'Scheduled', 'past-completed':'Completed', 'past-missed':'Missed', overdue:'Overdue' };
            ['renewal', 'touch', 'past-completed', 'past-missed', 'overdue'].forEach(function(type) {
              if (byType[type] && byType[type].length && pillCount < maxPills) {
                var count = byType[type].length;
                html += '<span class="cal-pill cal-pill--' + type + '">' +
                  count + ' ' + typeLabels[type] + '</span>';
                pillCount++;
              }
            });
          }
          html += '</div>';
        }
        html += '</td>';
        dayNum++;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  html += '<div id="cal-popover" class="cal-popover" style="display:none"></div>';
  wrap.innerHTML = html;
}

// ── Month navigation ──
function calPrev() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  calClosePopover();
  renderCalendar();
}

function calNext() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  calClosePopover();
  renderCalendar();
}

function calToday() {
  _calYear  = new Date().getFullYear();
  _calMonth = new Date().getMonth();
  calClosePopover();
  renderCalendar();
}

function calSetCustFilter(val, name) {
  _calCustFilter = val || '';
  _calCustName = name || '';
  _calSearchOpen = false;
  calClosePopover();
  renderCalendar();
}

function calClearCustFilter() {
  _calCustFilter = '';
  _calCustName = '';
  _calSearchOpen = false;
  calClosePopover();
  renderCalendar();
}

function calSearchFocus() {
  var inp = el('cal-cust-search');
  if (!inp) return;
  // If a customer is selected, select all text so typing replaces it
  if (_calCustFilter) inp.select();
  _calSearchShowResults(inp.value);
}

function calSearchInput(val) {
  _calSearchShowResults(val);
}

function _calSearchShowResults(query) {
  var box = el('cal-search-results');
  if (!box) return;
  var allActive = customers.filter(function(c) { return c.lifecycle !== 'churned' && passesManagerFilter(c); });
  var opts = allActive.slice().sort(function(a,b) { return a.name.localeCompare(b.name); });
  var q = (query || '').toLowerCase().trim();
  var matches = q ? opts.filter(function(c) { return c.name.toLowerCase().indexOf(q) !== -1; }) : opts;
  if (!matches.length) {
    box.innerHTML = '<div class="cal-search-empty">No matches</div>';
    box.style.display = 'block';
    _calSearchOpen = true;
    return;
  }
  var maxShow = 8;
  var h = '';
  matches.slice(0, maxShow).forEach(function(c) {
    h += '<button class="cal-search-item" onmousedown="calSetCustFilter(\'' + escHtml(c.id) + '\',\'' + escHtml(c.name).replace(/'/g, '\\&#39;') + '\')">' + escHtml(c.name) + '</button>';
  });
  if (matches.length > maxShow) {
    h += '<div class="cal-search-more">' + (matches.length - maxShow) + ' more\u2026</div>';
  }
  box.innerHTML = h;
  box.style.display = 'block';
  _calSearchOpen = true;
}

function calSearchBlur() {
  // Delay to allow click on result
  setTimeout(function() {
    var box = el('cal-search-results');
    if (box) box.style.display = 'none';
    _calSearchOpen = false;
    // If no customer selected, reset input
    var inp = el('cal-cust-search');
    if (inp && !_calCustFilter) inp.value = '';
    if (inp && _calCustFilter) inp.value = _calCustName;
  }, 200);
}

// ── Day popover ──
function calShowPopover(cellEl, dateStr) {
  var pop = el('cal-popover');
  if (!pop) return;

  if (pop.style.display !== 'none' && pop.dataset.date === dateStr) {
    calClosePopover();
    return;
  }

  var now = new Date();
  var todayStr = now.toISOString().slice(0, 10);
  var active = customers.filter(function(c) { return c.lifecycle !== 'churned' && passesManagerFilter(c); });
  var evts = [];

  active.forEach(function(c) {
    if (c.renewal_date && c.renewal_date.slice(0,10) === dateStr) {
      evts.push({ type: 'renewal', customer: c });
    }
    if (c.next_touch && c.next_touch.slice(0,10) === dateStr) {
      evts.push({ type: dateStr < todayStr ? 'past-completed' : 'touch', customer: c, isNextTouch: true });
    }
    if (c.last_contact_date && todayStr === dateStr) {
      var daysSince = Math.floor((now - new Date(c.last_contact_date)) / 86400000);
      if (daysSince > 30) {
        evts.push({ type: 'overdue', customer: c, daysSince: daysSince });
      }
    }
    // Past touches
    if (c.touch_history && c.touch_history.length) {
      c.touch_history.forEach(function(th, idx) {
        if (th.date && th.date.slice(0,10) === dateStr) {
          evts.push({
            type: th.status === 'missed' ? 'past-missed' : 'past-completed',
            customer: c,
            histIdx: idx
          });
        }
      });
    }
  });

  var dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  var typeLabel = {
    renewal: 'Renewal', touch: 'Scheduled Touch', overdue: 'Overdue Contact',
    'past-completed': 'Completed', 'past-missed': 'Missed / Cancelled'
  };
  var typeColor = {
    renewal: 'var(--purple)', touch: 'var(--blue)', overdue: 'var(--red)',
    'past-completed': 'var(--green)', 'past-missed': 'var(--red)'
  };
  var statusDot = { critical:'var(--red)', risk:'var(--amber)', watch:'var(--amber)', healthy:'var(--green)', expand:'var(--blue)' };

  var h = '<div class="cal-popover-hd">' + dateLabel +
    '<button class="cal-popover-close" onclick="calClosePopover()">&#10005;</button></div>';
  h += '<div class="cal-popover-body">';

  if (evts.length) {
    evts.forEach(function(ev) {
      var c = ev.customer;
      var isPast = (ev.type === 'past-completed' || ev.type === 'past-missed');

      h += '<div class="cal-popover-item">';
      h += '<span class="cal-popover-type-dot" style="background:' + typeColor[ev.type] + '"></span>';
      h += '<div class="cal-popover-info" style="cursor:pointer" onclick="calClosePopover();openDetail(\'' + escHtml(c.id) + '\')">';
      h += '<div class="cal-popover-name">' + escHtml(c.name) + '</div>';
      h += '<div class="cal-popover-meta">';
      h += '<span class="cal-popover-tag" style="color:' + typeColor[ev.type] + '">' + typeLabel[ev.type] + '</span>';
      // Show time if available
      if (ev.isNextTouch && c.next_touch_time) h += '<span>' + fmtTime12(c.next_touch_time) + '</span>';
      if (ev.histIdx != null && c.touch_history && c.touch_history[ev.histIdx] && c.touch_history[ev.histIdx].time) {
        h += '<span>' + fmtTime12(c.touch_history[ev.histIdx].time) + '</span>';
      }
      if (ev.daysSince) h += '<span>' + ev.daysSince + 'd since contact</span>';
      if (c.manager) h += '<span>' + escHtml(c.manager) + '</span>';
      h += '<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:' + (statusDot[c.status] || 'var(--muted)') + '"></span>' + c.score + '</span>';
      h += '</div></div>';

      // Action buttons row
      var hasActions = isPast || ev.type === 'touch' || ev.isNextTouch;
      if (hasActions || ev.type !== 'renewal') {
        h += '<div class="cal-popover-actions">';

        // Log sentiment button
        if (ev.type !== 'renewal' && ev.type !== 'overdue') {
          h += '<button class="cal-pop-btn" title="Log sentiment" onclick="event.stopPropagation();calToggleLogForm(\'' + escHtml(c.id) + '\')">';
          h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
          h += '</button>';
        }

        // Touch history entries (completed, missed, or scheduled): toggle status + remove
        if (ev.histIdx != null && !ev.isNextTouch) {
          var toggleTo = ev.type === 'past-completed' ? 'missed' : 'completed';
          var toggleLabel = ev.type === 'past-completed' ? 'Mark missed' : 'Mark completed';
          // Scheduled future entries get mark missed + remove
          if (ev.isScheduledHistory && ev.type === 'touch') {
            h += '<button class="cal-pop-btn cal-pop-btn--miss" title="Mark missed" onclick="event.stopPropagation();calToggleTouchStatus(\'' + escHtml(c.id) + '\',' + ev.histIdx + ',\'missed\')">';
            h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
            h += '</button>';
          } else if (toggleTo === 'missed') {
            h += '<button class="cal-pop-btn cal-pop-btn--miss" title="' + toggleLabel + '" onclick="event.stopPropagation();calToggleTouchStatus(\'' + escHtml(c.id) + '\',' + ev.histIdx + ',\'' + toggleTo + '\')">';
            h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
          } else {
            h += '<button class="cal-pop-btn cal-pop-btn--done" title="' + toggleLabel + '" onclick="event.stopPropagation();calToggleTouchStatus(\'' + escHtml(c.id) + '\',' + ev.histIdx + ',\'' + toggleTo + '\')">';
            h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
          }
          h += '</button>';
          h += '<button class="cal-pop-btn cal-pop-btn--del" title="Remove" onclick="event.stopPropagation();calRemoveTouch(\'' + escHtml(c.id) + '\',' + ev.histIdx + ')">';
          h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          h += '</button>';
        }

        // Scheduled calls from next_touch field: mark missed + remove
        if ((ev.type === 'touch' || (isPast && ev.isNextTouch)) && ev.isNextTouch) {
          h += '<button class="cal-pop-btn cal-pop-btn--miss" title="Mark missed" onclick="event.stopPropagation();calMarkScheduledMissed(\'' + escHtml(c.id) + '\')">';
          h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
          h += '</button>';
          h += '<button class="cal-pop-btn cal-pop-btn--del" title="Remove" onclick="event.stopPropagation();calRemoveScheduled(\'' + escHtml(c.id) + '\')">';
          h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          h += '</button>';
        }

        h += '</div>';
      }

      // Inline log form (hidden by default)
      if (ev.type !== 'renewal' && ev.type !== 'overdue') {
        h += '<div class="cal-log-form" id="cal-log-' + escHtml(c.id) + '" style="display:none" onclick="event.stopPropagation()">';
        h += '<div class="cal-log-sentiments">';
        h += '<button class="cal-log-sent" data-val="positive" onclick="event.stopPropagation();calPickSentiment(\'' + escHtml(c.id) + '\',\'positive\',this)">' + appIcon('sentPositive',16) + '</button>';
        h += '<button class="cal-log-sent" data-val="neutral" onclick="event.stopPropagation();calPickSentiment(\'' + escHtml(c.id) + '\',\'neutral\',this)">' + appIcon('sentNeutral',16) + '</button>';
        h += '<button class="cal-log-sent" data-val="negative" onclick="event.stopPropagation();calPickSentiment(\'' + escHtml(c.id) + '\',\'negative\',this)">' + appIcon('sentNegative',16) + '</button>';
        h += '</div>';
        h += '<input type="text" class="cal-log-note" id="cal-log-note-' + escHtml(c.id) + '" placeholder="Add a note\u2026" />';
        h += '<div style="display:flex;gap:6px">';
        h += '<button class="btn btn-primary btn-sm cal-log-save" onclick="event.stopPropagation();calSaveSentiment(\'' + escHtml(c.id) + '\')">Save</button>';
        h += '<button class="btn btn-sm" style="background:var(--bg);color:var(--muted);border:1px solid var(--border)" onclick="event.stopPropagation();calToggleLogForm(\'' + escHtml(c.id) + '\')">Cancel</button>';
        h += '</div>';
        h += '</div>';
      }

      h += '</div>';
    });
  } else {
    h += '<div style="padding:10px 14px;color:var(--muted);font-size:var(--fs-base)">No events on this day</div>';
  }

  h += '</div>';

  // Schedule a call button + inline form
  h += '<div class="cal-sched-trigger" style="padding:8px 14px;border-top:1px solid var(--border)">';
  h += '<button class="btn btn-outline btn-sm" style="width:100%;font-size:var(--fs-sm)" onclick="event.stopPropagation();calToggleScheduleForm(\'' + dateStr + '\')">';
  h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  h += 'Schedule a call</button></div>';
  h += '<div id="cal-sched-form" class="cal-sched-form" style="display:none" onclick="event.stopPropagation()">';
  h += '<div class="cal-sched-search-wrap">';
  h += '<input type="text" id="cal-sched-cust-input" class="cal-search-input" placeholder="Search customer\u2026" oninput="calSchedSearchInput(this.value)" onfocus="calSchedSearchFocus()" onblur="calSchedSearchBlur()" autocomplete="off" />';
  h += '<div id="cal-sched-results" class="cal-search-results" style="display:none"></div>';
  h += '</div>';
  h += '<input type="time" id="cal-sched-time" class="cal-sched-time" />';
  h += '<button class="btn btn-primary btn-sm cal-sched-save" onclick="event.stopPropagation();calSaveSchedule(\'' + dateStr + '\')">Schedule</button>';
  h += '</div>';

  pop.innerHTML = h;
  pop.dataset.date = dateStr;
  pop.style.display = 'block';

  // Position relative to cell
  var cellRect = cellEl.getBoundingClientRect();
  var wrapRect = el('calendar-wrap').getBoundingClientRect();
  var left = cellRect.left - wrapRect.left + cellRect.width / 2 - 150;
  var top  = cellRect.bottom - wrapRect.top + 6;
  if (left < 0) left = 4;
  if (left + 300 > wrapRect.width) left = wrapRect.width - 304;
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';
}

function calClosePopover() {
  var pop = el('cal-popover');
  if (pop) { pop.style.display = 'none'; pop.dataset.date = ''; }
}

// ── Sync next_touch to nearest future scheduled call ──
function _calSyncNextTouch(c) {
  var todayStr = new Date().toISOString().slice(0, 10);
  var nearest = '';
  var nearestTime = '';
  if (c.touch_history && c.touch_history.length) {
    c.touch_history.forEach(function(th) {
      if (th.status === 'scheduled' && th.date && th.date.slice(0,10) >= todayStr) {
        if (!nearest || th.date.slice(0,10) < nearest) {
          nearest = th.date.slice(0,10);
          nearestTime = th.time || '';
        }
      }
    });
  }
  c.next_touch = nearest;
  c.next_touch_time = nearestTime;
}

// ── Touch history actions ──
async function calToggleTouchStatus(custId, histIdx, newStatus) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.touch_history || !c.touch_history[histIdx]) return;
  c.touch_history[histIdx].status = newStatus;
  _calSyncNextTouch(c);
  var { error } = await sb.from('customers').update({
    touch_history: JSON.stringify(c.touch_history),
    next_touch: c.next_touch,
    next_touch_time: c.next_touch_time
  }).eq('id', c.id);
  if (error) {
    toast('Failed to update — ' + error.message, 'error');
  }
  renderCalendar();
}

async function calRemoveTouch(custId, histIdx) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.touch_history || !c.touch_history[histIdx]) return;
  if (!confirm('Delete this touch entry for ' + c.name + '?')) return;
  c.touch_history.splice(histIdx, 1);
  _calSyncNextTouch(c);
  var { error } = await sb.from('customers').update({
    touch_history: JSON.stringify(c.touch_history),
    next_touch: c.next_touch,
    next_touch_time: c.next_touch_time
  }).eq('id', c.id);
  if (error) {
    toast('Failed to remove — ' + error.message, 'error');
  }
  renderCalendar();
}

async function calMarkScheduledMissed(custId) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.next_touch) return;
  if (!c.touch_history) c.touch_history = [];
  var ntDate = c.next_touch.slice(0,10);
  // Find existing scheduled entry for this date and mark it missed
  var found = false;
  for (var i = 0; i < c.touch_history.length; i++) {
    if (c.touch_history[i].status === 'scheduled' && c.touch_history[i].date && c.touch_history[i].date.slice(0,10) === ntDate) {
      c.touch_history[i].status = 'missed';
      found = true;
      break;
    }
  }
  // If no existing entry (e.g. set via detail form), add one
  if (!found) {
    c.touch_history.push({ date: ntDate, status: 'missed', time: c.next_touch_time || '' });
  }
  _calSyncNextTouch(c);
  var { error } = await sb.from('customers').update({
    next_touch: c.next_touch,
    next_touch_time: c.next_touch_time,
    touch_history: JSON.stringify(c.touch_history)
  }).eq('id', c.id);
  if (error) {
    toast('Failed to update — ' + error.message, 'error');
  }
  renderCalendar();
}

async function calRemoveScheduled(custId) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.next_touch) return;
  if (!confirm('Remove scheduled touch for ' + c.name + '?')) return;
  var ntDate = c.next_touch.slice(0,10);
  // Remove matching scheduled entry from touch_history
  if (c.touch_history) {
    for (var i = 0; i < c.touch_history.length; i++) {
      if (c.touch_history[i].status === 'scheduled' && c.touch_history[i].date && c.touch_history[i].date.slice(0,10) === ntDate) {
        c.touch_history.splice(i, 1);
        break;
      }
    }
  }
  _calSyncNextTouch(c);
  var { error } = await sb.from('customers').update({
    next_touch: c.next_touch,
    next_touch_time: c.next_touch_time,
    touch_history: JSON.stringify(c.touch_history)
  }).eq('id', c.id);
  if (error) {
    toast('Failed to remove — ' + error.message, 'error');
  }
  renderCalendar();
}

// ── Inline scheduling form ──
var _calSchedCustId = '';
var _calSchedCustName = '';
var _calSchedBusy = false;

function calToggleScheduleForm(dateStr) {
  var form = el('cal-sched-form');
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  if (!isOpen) {
    form.style.display = 'flex';
    _calSchedCustId = '';
    _calSchedCustName = '';
    var inp = el('cal-sched-cust-input');
    if (inp) { inp.value = ''; setTimeout(function(){ inp.focus(); }, 50); }
    var timeInp = el('cal-sched-time');
    if (timeInp) timeInp.value = '';
  } else {
    form.style.display = 'none';
  }
}

function calSchedSearchFocus() {
  _calSchedShowResults(el('cal-sched-cust-input') ? el('cal-sched-cust-input').value : '');
}

function calSchedSearchInput(val) {
  _calSchedShowResults(val);
}

function _calSchedShowResults(query) {
  var box = el('cal-sched-results');
  if (!box) return;
  var allActive = customers.filter(function(c) { return c.lifecycle !== 'churned' && passesManagerFilter(c); });
  var opts = allActive.slice().sort(function(a,b) { return a.name.localeCompare(b.name); });
  var q = (query || '').toLowerCase().trim();
  var matches = q ? opts.filter(function(c) { return c.name.toLowerCase().indexOf(q) !== -1; }) : opts;
  if (!matches.length) {
    box.innerHTML = '<div class="cal-search-empty" style="padding:6px 10px;font-size:var(--fs-sm);color:var(--muted)">No matches</div>';
    box.style.display = 'block';
    return;
  }
  var maxShow = 6;
  var h = '';
  matches.slice(0, maxShow).forEach(function(c) {
    h += '<button class="cal-search-item" onmousedown="event.preventDefault();calSchedPickCust(\'' + c.id + '\',this)" data-name="' + escHtml(c.name) + '">' + escHtml(c.name) + '</button>';
  });
  if (matches.length > maxShow) {
    h += '<div style="padding:4px 10px;font-size:var(--fs-xs);color:var(--muted)">' + (matches.length - maxShow) + ' more\u2026</div>';
  }
  box.innerHTML = h;
  box.style.display = 'block';
}

function calSchedPickCust(id, btn) {
  _calSchedBusy = true;
  _calSchedCustId = id;
  _calSchedCustName = btn ? btn.dataset.name : '';
  var inp = el('cal-sched-cust-input');
  if (inp) inp.value = _calSchedCustName;
  setTimeout(function() {
    var box = el('cal-sched-results');
    if (box) box.style.display = 'none';
    _calSchedBusy = false;
  }, 300);
}

function calSchedSearchBlur() {
  setTimeout(function() {
    var box = el('cal-sched-results');
    if (box) box.style.display = 'none';
    var inp = el('cal-sched-cust-input');
    if (inp && !_calSchedCustId) inp.value = '';
    if (inp && _calSchedCustId) inp.value = _calSchedCustName;
  }, 200);
}

async function calSaveSchedule(dateStr) {
  if (!_calSchedCustId) { toast('Select a customer first', 'error'); return; }
  var c = customers.find(function(x) { return x.id === _calSchedCustId; });
  if (!c) { toast('Customer not found', 'error'); return; }

  var timeVal = el('cal-sched-time') ? el('cal-sched-time').value : '';
  var today = new Date(); today.setHours(0,0,0,0);
  var schedDate = new Date(dateStr + 'T12:00:00');
  var isPast = schedDate <= today;

  // Always add to touch_history — supports multiple calls per customer
  if (!c.touch_history) c.touch_history = [];
  c.touch_history.push({
    date: dateStr,
    status: isPast ? 'completed' : 'scheduled',
    time: timeVal
  });

  // If past/today, update last contact date
  if (isPast) {
    c.last_contact_date = dateStr;
    var daysSince = Math.max(0, Math.floor((Date.now() - schedDate.getTime()) / 86400000));
    c.days = daysSince;
    c._baseDays = daysSince;
  }

  // Sync next_touch to nearest future scheduled call
  _calSyncNextTouch(c);

  try {
    await save(c);
    logAudit('call_scheduled', c.id, c.name, {
      summary: 'Scheduled call for ' + dateStr + (timeVal ? ' at ' + fmtTime12(timeVal) : '')
    });
    toast('Call scheduled for ' + c.name, 'success');
  } catch(e) {
    console.error('Schedule save failed:', e);
    toast('Saved locally — sync failed', 'warn');
  }

  _calSchedCustId = '';
  _calSchedCustName = '';
  renderCalendar();
}

// ── Inline sentiment logging ──
var _calPendingSentiment = {};

function calToggleLogForm(custId) {
  var form = el('cal-log-' + custId);
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  // Close all open forms first
  document.querySelectorAll('.cal-log-form').forEach(function(f) { f.style.display = 'none'; });
  if (!isOpen) {
    form.style.display = 'flex';
    _calPendingSentiment[custId] = null;
  }
}

function calPickSentiment(custId, val, btn) {
  _calPendingSentiment[custId] = val;
  var form = el('cal-log-' + custId);
  if (form) {
    form.querySelectorAll('.cal-log-sent').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
}

async function calSaveSentiment(custId) {
  var val = _calPendingSentiment[custId];
  if (!val) { toast('Select a sentiment first', 'error'); return; }
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c) return;
  var noteEl = el('cal-log-note-' + custId);
  var note = noteEl ? noteEl.value.trim() : '';
  c.sentiment = c.sentiment || [];
  c.sentiment.unshift({ val: val, note: note, date: new Date().toISOString() });
  logAudit('sentiment_logged', c.id, c.name, { summary: 'Sentiment: ' + val + (note ? ' — "' + note.substring(0, 80) + '"' : '') });
  save(c).then(function() { toast('Sentiment logged', 'success'); })
         .catch(function(e) { console.error('Sentiment save failed:', e); toast('Saved locally — sync failed', 'warn'); });
  _calPendingSentiment[custId] = null;
  var form = el('cal-log-' + custId);
  if (form) form.style.display = 'none';
}

document.addEventListener('click', function(e) {
  if (_calSchedBusy) return;
  if (!e.target.closest('.cal-cell') && !e.target.closest('.cal-popover') && !e.target.closest('.cal-search-results')) {
    calClosePopover();
  }
});
