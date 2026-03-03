// ─── CALENDAR PAGE ──────────────────────────────────────────
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();

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
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
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
  const renewalCount = events.filter(e => e.type === 'renewal' && e.date.startsWith(monthPrefix)).length;
  const touchCount   = events.filter(e => e.type === 'touch'   && e.date.startsWith(monthPrefix)).length;
  const overdueCount = events.filter(e => e.type === 'overdue').length;

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
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--touch"></span>Scheduled Touch</span>' +
      '<span class="cal-legend-item"><span class="cal-dot cal-dot--overdue"></span>Overdue Contact</span>' +
    '</div>' +
  '</div>';

  // ── Stat cards ──
  html += '<div class="cal-stats">' +
    '<div class="cal-stat-card" style="--accent-color:var(--purple)">' +
      '<div class="cal-stat-num">' + renewalCount + '</div>' +
      '<div class="cal-stat-label">Renewals</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--blue)">' +
      '<div class="cal-stat-num">' + touchCount + '</div>' +
      '<div class="cal-stat-label">Scheduled Touches</div>' +
    '</div>' +
    '<div class="cal-stat-card" style="--accent-color:var(--red)">' +
      '<div class="cal-stat-num">' + overdueCount + '</div>' +
      '<div class="cal-stat-label">Overdue Contacts</div>' +
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
            // Few events — show customer names
            dayEvents.forEach(function(ev) {
              html += '<span class="cal-pill cal-pill--' + ev.type + '">' + escHtml(ev.customer.name) + '</span>';
            });
          } else {
            // Many events — group by type with counts
            var byType = { renewal: [], touch: [], overdue: [] };
            dayEvents.forEach(function(ev) { byType[ev.type].push(ev); });
            var pillCount = 0;
            ['renewal', 'touch', 'overdue'].forEach(function(type) {
              if (byType[type].length && pillCount < maxPills) {
                var label = type === 'renewal' ? 'Renewal' : type === 'touch' ? 'Touch' : 'Overdue';
                var count = byType[type].length;
                html += '<span class="cal-pill cal-pill--' + type + '">' +
                  count + ' ' + label + (count > 1 ? 's' : '') + '</span>';
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

// ── Day popover ──
function calShowPopover(cellEl, dateStr) {
  var pop = el('cal-popover');
  if (!pop) return;

  // Toggle off if same date
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
  });

  if (!evts.length) { calClosePopover(); return; }

  var dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  var typeLabel = { renewal: 'Renewal', touch: 'Scheduled Touch', overdue: 'Overdue Contact' };
  var typeColor = { renewal: 'var(--purple)', touch: 'var(--blue)', overdue: 'var(--red)' };
  var statusDot = { critical:'var(--red)', risk:'var(--amber)', watch:'var(--amber)', healthy:'var(--green)', expand:'var(--blue)' };

  var h = '<div class="cal-popover-hd">' + dateLabel +
    '<button class="cal-popover-close" onclick="calClosePopover()">&#10005;</button></div>';
  h += '<div class="cal-popover-body">';

  evts.forEach(function(ev) {
    var c = ev.customer;
    h += '<div class="cal-popover-item" onclick="calClosePopover();openDetail(\'' + escHtml(c.id) + '\')">' +
      '<span class="cal-popover-type-dot" style="background:' + typeColor[ev.type] + '"></span>' +
      '<div class="cal-popover-info">' +
        '<div class="cal-popover-name">' + escHtml(c.name) + '</div>' +
        '<div class="cal-popover-meta">' +
          '<span class="cal-popover-tag" style="color:' + typeColor[ev.type] + '">' + typeLabel[ev.type] + '</span>' +
          (ev.daysSince ? '<span>' + ev.daysSince + 'd since contact</span>' : '') +
          (c.manager ? '<span>' + escHtml(c.manager) + '</span>' : '') +
          '<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:' + (statusDot[c.status] || 'var(--muted)') + '"></span>' + c.score + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
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

document.addEventListener('click', function(e) {
  if (!e.target.closest('.cal-cell') && !e.target.closest('.cal-popover')) {
    calClosePopover();
  }
});
