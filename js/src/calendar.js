// ─── CALENDAR PAGE ──────────────────────────────────────────
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calCustFilter = ''; // customer ID filter

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
      events.push({ date: c.next_touch.slice(0,10), type: 'touch', customer: c });
    }
    if (c.last_contact_date) {
      const lcd = new Date(c.last_contact_date);
      const daysSince = Math.floor((now - lcd) / 86400000);
      if (daysSince > 30) {
        events.push({ date: todayStr, type: 'overdue', customer: c, daysSince: daysSince });
      }
    }
    // Past touches from touch_history
    if (c.touch_history && c.touch_history.length) {
      c.touch_history.forEach(function(th, idx) {
        if (th.date) {
          events.push({
            date: th.date.slice(0,10),
            type: th.status === 'missed' ? 'past-missed' : 'past-completed',
            customer: c,
            histIdx: idx
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

  // ── Customer filter ──
  var custOpts = allActive.slice().sort(function(a,b) { return a.name.localeCompare(b.name); });
  html += '<div class="cal-filter-row">';
  html += '<div class="cal-filter-select-wrap">';
  html += '<select id="cal-cust-filter" class="cal-filter-select" onchange="calSetCustFilter(this.value)">';
  html += '<option value="">All Customers</option>';
  custOpts.forEach(function(c) {
    html += '<option value="' + escHtml(c.id) + '"' + (c.id === _calCustFilter ? ' selected' : '') + '>' + escHtml(c.name) + '</option>';
  });
  html += '</select></div>';

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
      html += '<span class="cal-ctx-item"><span class="cal-ctx-label">Next Scheduled</span><span class="cal-ctx-val">' + _fmtD(fc.next_touch) + '</span></span>';
      html += '<span class="cal-ctx-sep"></span>';
      html += '<span class="cal-ctx-item"><span class="cal-ctx-label">Renewal</span><span class="cal-ctx-val">' + _fmtD(fc.renewal_date) + '</span></span>';
      html += '</div>';
    }
  }
  html += '</div>';

  // ── Stat cards ──
  html += '<div class="cal-stats">' +
    '<div class="cal-stat-card" style="--accent-color:var(--purple)">' +
      '<div class="cal-stat-num">' + renewalCount + '</div>' +
      '<div class="cal-stat-label">Renewals</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--blue)">' +
      '<div class="cal-stat-num">' + touchCount + '</div>' +
      '<div class="cal-stat-label">Scheduled</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--green)">' +
      '<div class="cal-stat-num">' + pastTouchCount + '</div>' +
      '<div class="cal-stat-label">Past Touches</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--red)">' +
      '<div class="cal-stat-num">' + overdueCount + '</div>' +
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
              html += '<span class="cal-pill cal-pill--' + ev.type + '">' + escHtml(ev.customer.name) + '</span>';
            });
          } else {
            var byType = {};
            dayEvents.forEach(function(ev) {
              if (!byType[ev.type]) byType[ev.type] = [];
              byType[ev.type].push(ev);
            });
            var pillCount = 0;
            var typeLabels = { renewal:'Renewal', touch:'Touch', 'past-completed':'Done', 'past-missed':'Missed', overdue:'Overdue' };
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

function calSetCustFilter(val) {
  _calCustFilter = val || '';
  calClosePopover();
  renderCalendar();
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
      evts.push({ type: 'touch', customer: c });
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

  if (!evts.length) { calClosePopover(); return; }

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

  evts.forEach(function(ev) {
    var c = ev.customer;
    var isPast = (ev.type === 'past-completed' || ev.type === 'past-missed');

    h += '<div class="cal-popover-item">';
    h += '<span class="cal-popover-type-dot" style="background:' + typeColor[ev.type] + '"></span>';
    h += '<div class="cal-popover-info" style="cursor:pointer" onclick="calClosePopover();openDetail(\'' + escHtml(c.id) + '\')">';
    h += '<div class="cal-popover-name">' + escHtml(c.name) + '</div>';
    h += '<div class="cal-popover-meta">';
    h += '<span class="cal-popover-tag" style="color:' + typeColor[ev.type] + '">' + typeLabel[ev.type] + '</span>';
    if (ev.daysSince) h += '<span>' + ev.daysSince + 'd since contact</span>';
    if (c.manager) h += '<span>' + escHtml(c.manager) + '</span>';
    h += '<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:' + (statusDot[c.status] || 'var(--muted)') + '"></span>' + c.score + '</span>';
    h += '</div></div>';

    // Actions for past touches: toggle status + remove
    if (isPast) {
      var toggleTo = ev.type === 'past-completed' ? 'missed' : 'completed';
      var toggleLabel = ev.type === 'past-completed' ? 'Mark missed' : 'Mark completed';
      h += '<div class="cal-popover-actions">';
      h += '<button class="cal-pop-btn" title="' + toggleLabel + '" onclick="event.stopPropagation();calToggleTouchStatus(\'' + escHtml(c.id) + '\',' + ev.histIdx + ',\'' + toggleTo + '\')">';
      if (toggleTo === 'missed') {
        h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      } else {
        h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      h += '</button>';
      h += '<button class="cal-pop-btn cal-pop-btn--del" title="Remove" onclick="event.stopPropagation();calRemoveTouch(\'' + escHtml(c.id) + '\',' + ev.histIdx + ')">';
      h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      h += '</button>';
      h += '</div>';
    }

    h += '</div>';
  });

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

// ── Touch history actions ──
async function calToggleTouchStatus(custId, histIdx, newStatus) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.touch_history || !c.touch_history[histIdx]) return;
  c.touch_history[histIdx].status = newStatus;
  var { error } = await sb.from('customers').update({
    touch_history: JSON.stringify(c.touch_history)
  }).eq('id', c.id);
  if (error) {
    toast('Failed to update — ' + error.message, 'error');
  }
  renderCalendar();
}

async function calRemoveTouch(custId, histIdx) {
  var c = customers.find(function(x) { return x.id === custId; });
  if (!c || !c.touch_history || !c.touch_history[histIdx]) return;
  c.touch_history.splice(histIdx, 1);
  var { error } = await sb.from('customers').update({
    touch_history: JSON.stringify(c.touch_history)
  }).eq('id', c.id);
  if (error) {
    toast('Failed to remove — ' + error.message, 'error');
  }
  renderCalendar();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.cal-cell') && !e.target.closest('.cal-popover')) {
    calClosePopover();
  }
});
