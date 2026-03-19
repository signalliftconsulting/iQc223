// ═══════════════════════════════════════════════════════════════
// scheduled-reports — Supabase Edge Function
// Called by pg_cron via pg_net to send scheduled report emails
// Reads each user's report_schedules config from settings table,
// checks which reports are due, builds HTML, sends via Resend API.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ──
interface Customer {
  id: string;
  name: string;
  score: number;
  status: string;
  mrr: number;
  arr: number;
  tier: string;
  lifecycle: string;
  manager: string;
  logins: number;
  adoption: number;
  tickets: number;
  nps: string;
  days: number;
  renewal_date: string;
  growth: string;
  tags: string;
  history: string;
  since: string;
  next_touch: string;
}

interface ReportSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  day: string;
  time: string;
  recipients: string;
  subject_prefix: string;
  last_sent?: string;
}

// ── Constants ──
const STATUS_LABEL: Record<string, string> = {
  critical: 'Critical', risk: 'At Risk', watch: 'Watch', healthy: 'Healthy', expand: 'Expand'
};
const STATUS_COLOR: Record<string, string> = {
  critical: '#dc2626', risk: '#f97316', watch: '#eab308', healthy: '#16a34a', expand: '#3b82f6'
};
const STATUS_DOT: Record<string, string> = {
  critical: '\u{1F534}', risk: '\u{1F7E0}', watch: '\u{1F7E1}', healthy: '\u{1F7E2}', expand: '\u2728'
};

// ── Helpers ──
function escHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtDate(d: string): string {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function dateStr(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseJSON(s: string | null | undefined, fallback: any = []): any {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function getDelta7d(c: Customer): number {
  const hist = parseJSON(c.history, []);
  if (hist.length < 2) return 0;
  return hist[hist.length - 1].score - hist[hist.length - 2].score;
}

// ── Email HTML helpers ──
function emailWrap(title: string, subtitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6">` +
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">` +
    `<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">` +
    `<tr><td style="background:linear-gradient(90deg,#2e3fa3,#4a6fd4);padding:20px 24px">` +
    `<div style="font-size:18px;font-weight:700;color:#fff">${escHtml(title)}</div>` +
    `<div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:2px">${subtitle}</div>` +
    `</td></tr><tr><td style="padding:20px 24px">${bodyHtml}</td></tr>` +
    `<tr><td style="padding:0 24px 16px;font-size:11px;color:#9ca3af;text-align:center">` +
    `iQcadence CS Health Score &middot; ${dateStr()}</td></tr></table></td></tr></table></body></html>`;
}

function kpiCell(label: string, value: string, color: string): string {
  return `<td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;width:25%">` +
    `<div style="font-size:20px;font-weight:800;color:${color}">${value}</div>` +
    `<div style="font-size:11px;color:#64748b;margin-top:2px">${label}</div></td>`;
}

function kpiRow(kpis: Array<[string, string, string]>): string {
  return `<table width="100%" cellpadding="4" cellspacing="0" style="margin-bottom:20px"><tr>` +
    kpis.map(([l, v, c]) => kpiCell(l, v, c)).join('') + `</tr></table>`;
}

function tblHeader(cols: string[]): string {
  return `<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-bottom:16px"><tr>` +
    cols.map(c => `<th style="text-align:left;border-bottom:2px solid #e2e8f0;font-weight:600;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.5px">${c}</th>`).join('') +
    `</tr>`;
}

function tblRow(cells: string[]): string {
  return `<tr>` + cells.map(c => `<td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${c}</td>`).join('') + `</tr>`;
}

// ═══════════════════════════════════════════════════════════════
// REPORT BUILDERS (server-side, email-optimized)
// ═══════════════════════════════════════════════════════════════

function buildDigest(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  const critical = active.filter(c => c.status === 'critical').length;
  const atRisk = active.filter(c => c.status === 'risk').length;
  const avgScore = Math.round(active.reduce((s, c) => s + (c.score || 0), 0) / active.length);
  const totalMrr = active.reduce((s, c) => s + (c.mrr || 0), 0);

  const topRisk = [...active].filter(c => c.status === 'critical' || c.status === 'risk')
    .sort((a, b) => (a.score || 0) - (b.score || 0)).slice(0, 3);

  const now = new Date();
  const in7 = new Date(now); in7.setDate(now.getDate() + 7);
  const upcoming = active.filter(c => {
    if (!c.renewal_date) return false;
    const d = new Date(c.renewal_date);
    return d >= now && d <= in7;
  }).sort((a, b) => new Date(a.renewal_date).getTime() - new Date(b.renewal_date).getTime());

  const withHist = active.filter(c => parseJSON(c.history, []).length >= 2);
  const deltas = withHist.map(c => {
    const hist = parseJSON(c.history, []);
    return { c, delta: hist[hist.length - 1].score - hist[hist.length - 2].score };
  });
  const improved = [...deltas].filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const dropped = [...deltas].filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);

  const week = dateStr();
  const sdot = (s: string) => STATUS_DOT[s] || '\u26AA';

  return `<div style="max-width:580px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:linear-gradient(90deg,#2e3fa3,#4a6fd4);color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:18px;font-weight:700">IQcadence CS Health Digest</div>
      <div style="font-size:12px;opacity:.8;margin-top:2px">Week of ${week}</div>
    </div>
    <div style="padding:20px 24px;background:#f8fafc;border-radius:0 0 8px 8px">
      <table width="100%" cellpadding="5" cellspacing="0" style="margin-bottom:20px"><tr>
        ${[
          ['Total Accounts', String(active.length), '#1e293b'],
          ['Critical / At Risk', critical + ' / ' + atRisk, (critical + atRisk) > 0 ? '#dc2626' : '#16a34a'],
          ['Avg Health Score', String(avgScore), avgScore >= 80 ? '#16a34a' : avgScore >= 65 ? '#d97706' : '#dc2626'],
          ['Total MRR', '$' + fmtNum(totalMrr), '#2e3fa3'],
        ].map(([lbl, val, col]) => `<td style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;width:25%">
          <div style="font-size:20px;font-weight:800;color:${col}">${val}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${lbl}</div>
        </td>`).join('')}
      </tr></table>

      ${topRisk.length ? `<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">\u{1F6A8} Accounts Needing Attention</div>
        ${topRisk.map(c => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
          ${sdot(c.status)} <strong>${escHtml(c.name)}</strong>
          <span style="float:right;color:#64748b;font-size:12px">Score ${c.score} &middot; MRR $${fmtNum(c.mrr || 0)}</span>
        </div>`).join('')}
      </div>` : ''}

      ${upcoming.length ? `<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">\u{1F4C5} Renewals This Week</div>
        ${upcoming.map(c => {
          const days = Math.round((new Date(c.renewal_date).getTime() - now.getTime()) / 86400000);
          return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
            ${sdot(c.status)} <strong>${escHtml(c.name)}</strong>
            <span style="float:right;color:#64748b;font-size:12px">${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'in ' + days + 'd'} &middot; $${fmtNum(c.mrr || 0)}/mo</span>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${(improved.length || dropped.length) ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px"><tr>
        ${improved.length ? `<td valign="top" width="50%">
          <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:6px">\u{1F4C8} Most Improved</div>
          ${improved.map(({ c, delta }) => `<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#16a34a;font-weight:700">+${delta}</span></div>`).join('')}
        </td>` : '<td></td>'}
        ${dropped.length ? `<td valign="top" width="50%">
          <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">\u{1F4C9} Biggest Drops</div>
          ${dropped.map(({ c, delta }) => `<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#dc2626;font-weight:700">${delta}</span></div>`).join('')}
        </td>` : '<td></td>'}
      </tr></table>` : ''}

      <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">Generated by IQcadence CS Health Score &middot; ${week}</div>
    </div>
  </div>`;
}

function buildPortfolioSummary(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  const byStatus: Record<string, Customer[]> = {};
  active.forEach(c => { (byStatus[c.status] = byStatus[c.status] || []).push(c); });
  const totalMrr = active.reduce((s, c) => s + (c.mrr || 0), 0);
  const avgScore = Math.round(active.reduce((s, c) => s + (c.score || 0), 0) / active.length);
  const healthyPct = Math.round(active.filter(c => c.status === 'healthy' || c.status === 'expand').length / active.length * 100);

  let body = kpiRow([
    ['Total Accounts', String(active.length), '#1e293b'],
    ['Avg Score', String(avgScore), avgScore >= 80 ? '#16a34a' : avgScore >= 65 ? '#d97706' : '#dc2626'],
    ['Healthy %', healthyPct + '%', healthyPct >= 70 ? '#16a34a' : '#d97706'],
    ['Total MRR', '$' + fmtNum(totalMrr), '#2e3fa3'],
  ]);

  body += `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:16px 0 8px">Status Distribution</div>`;
  body += tblHeader(['Status', 'Count', 'MRR', '% of Portfolio']);
  for (const status of ['expand', 'healthy', 'watch', 'risk', 'critical']) {
    const arr = byStatus[status] || [];
    if (!arr.length) continue;
    const mrr = arr.reduce((s, c) => s + (c.mrr || 0), 0);
    body += tblRow([
      `<span style="color:${STATUS_COLOR[status]};font-weight:600">\u25CF ${STATUS_LABEL[status]}</span>`,
      String(arr.length),
      '$' + fmtNum(mrr),
      Math.round(arr.length / active.length * 100) + '%'
    ]);
  }
  body += '</table>';

  const byTier: Record<string, Customer[]> = {};
  active.forEach(c => { (byTier[c.tier || 'unknown'] = byTier[c.tier || 'unknown'] || []).push(c); });
  body += `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:16px 0 8px">By Tier</div>`;
  body += tblHeader(['Tier', 'Count', 'Avg Score', 'MRR']);
  for (const [tier, arr] of Object.entries(byTier).sort((a, b) =>
    b[1].reduce((s, c) => s + (c.mrr || 0), 0) - a[1].reduce((s, c) => s + (c.mrr || 0), 0))) {
    const avg = Math.round(arr.reduce((s, c) => s + (c.score || 0), 0) / arr.length);
    body += tblRow([escHtml(tier), String(arr.length), String(avg),
      '$' + fmtNum(arr.reduce((s, c) => s + (c.mrr || 0), 0))]);
  }
  body += '</table>';

  return emailWrap('Portfolio Health Summary', 'Generated ' + dateStr(), body);
}

function buildAtRiskReport(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk')
    .sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  if (!atRisk.length) return '';

  const totalRiskMRR = atRisk.reduce((s, c) => s + (c.mrr || 0), 0);
  const critCount = atRisk.filter(c => c.status === 'critical').length;
  const riskCount = atRisk.length - critCount;
  const critMRR = atRisk.filter(c => c.status === 'critical').reduce((s, c) => s + (c.mrr || 0), 0);

  let body = kpiRow([
    ['Critical', String(critCount), '#dc2626'],
    ['At Risk', String(riskCount), '#f97316'],
    ['Critical MRR', '$' + fmtNum(critMRR), '#dc2626'],
    ['At Risk MRR', '$' + fmtNum(totalRiskMRR - critMRR), '#f97316'],
  ]);

  body += tblHeader(['Customer', 'Manager', 'Score', 'Status', '7d Trend', 'MRR', 'Days']);
  atRisk.forEach(c => {
    const delta = getDelta7d(c);
    const trendStr = delta > 0 ? '+' + delta : String(delta);
    const trendColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';
    body += tblRow([
      '<strong>' + escHtml(c.name) + '</strong>',
      escHtml(c.manager || '\u2014'),
      `<span style="font-weight:700;color:${STATUS_COLOR[c.status]}">${c.score}</span>`,
      `<span style="color:${STATUS_COLOR[c.status]}">\u25CF ${STATUS_LABEL[c.status]}</span>`,
      `<span style="color:${trendColor};font-weight:600">${trendStr}</span>`,
      '$' + fmtNum(c.mrr || 0),
      `<span${(c.days || 0) >= 14 ? ' style="color:#dc2626;font-weight:600"' : ''}>${c.days ?? '\u2014'}d</span>`
    ]);
  });
  body += '</table>';

  return emailWrap('At-Risk Report', atRisk.length + ' accounts &middot; $' + fmtNum(totalRiskMRR) + ' MRR at risk', body);
}

function buildRenewalForecast(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned' && c.renewal_date);
  if (!active.length) return '';

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() + 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() + 90);

  const buckets = [
    { label: 'This Month', from: now, to: endOfMonth },
    { label: 'Next 30 Days', from: now, to: d30 },
    { label: '31\u201360 Days', from: d30, to: d60 },
    { label: '61\u201390 Days', from: d60, to: d90 },
  ];

  const assigned = new Set<string>();
  const bucketData = buckets.map(b => {
    const items = active.filter(c => {
      if (assigned.has(c.id)) return false;
      const rd = new Date(c.renewal_date);
      return rd >= b.from && rd <= b.to;
    }).sort((a, b) => new Date(a.renewal_date).getTime() - new Date(b.renewal_date).getTime());
    items.forEach(c => assigned.add(c.id));
    const mrr = items.reduce((s, c) => s + (c.mrr || 0), 0);
    return { ...b, items, mrr };
  });

  const totalRenewals = bucketData.reduce((s, b) => s + b.items.length, 0);
  const totalMRR = bucketData.reduce((s, b) => s + b.mrr, 0);

  let body = kpiRow([
    ['Total Renewals', String(totalRenewals), '#1e293b'],
    ['Total MRR', '$' + fmtNum(totalMRR), '#2e3fa3'],
    ['This Month', String(bucketData[0].items.length), '#4f46e5'],
    ['Next 30d', String(bucketData[1].items.length), '#4f46e5'],
  ]);

  bucketData.forEach(b => {
    body += `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:16px 0 8px">${b.label} ` +
      `<span style="font-weight:400;color:#64748b;font-size:12px">${b.items.length} accounts &middot; $${fmtNum(b.mrr)} MRR</span></div>`;
    if (b.items.length) {
      body += tblHeader(['Customer', 'Manager', 'Score', 'Status', 'MRR', 'Renewal Date']);
      b.items.forEach(c => {
        body += tblRow([
          '<strong>' + escHtml(c.name) + '</strong>',
          escHtml(c.manager || '\u2014'),
          `<span style="font-weight:700;color:${STATUS_COLOR[c.status]}">${c.score}</span>`,
          `<span style="color:${STATUS_COLOR[c.status]}">\u25CF ${STATUS_LABEL[c.status]}</span>`,
          '$' + fmtNum(c.mrr || 0),
          fmtDate(c.renewal_date)
        ]);
      });
      body += '</table>';
    } else {
      body += `<p style="color:#94a3b8;font-size:13px;margin:4px 0 12px">No renewals in this window.</p>`;
    }
  });

  return emailWrap('Renewal Forecast Report', totalRenewals + ' renewals &middot; $' + fmtNum(totalMRR) + ' MRR', body);
}

function buildCSMReport(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  const byManager: Record<string, Customer[]> = {};
  active.forEach(c => { const m = c.manager || 'Unassigned'; (byManager[m] = byManager[m] || []).push(c); });

  let body = `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 12px">CSM Performance Overview</div>`;
  body += tblHeader(['Manager', 'Accounts', 'Avg Score', 'At Risk', 'MRR', 'Avg Days']);
  for (const [mgr, arr] of Object.entries(byManager).sort((a, b) => b[1].length - a[1].length)) {
    const avg = Math.round(arr.reduce((s, c) => s + (c.score || 0), 0) / arr.length);
    const risk = arr.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const mrr = arr.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgDays = Math.round(arr.reduce((s, c) => s + (c.days || 0), 0) / arr.length);
    body += tblRow([
      '<strong>' + escHtml(mgr) + '</strong>',
      String(arr.length),
      `<span style="font-weight:700;color:${avg >= 80 ? '#16a34a' : avg >= 65 ? '#d97706' : '#dc2626'}">${avg}</span>`,
      risk > 0 ? `<span style="color:#dc2626;font-weight:600">${risk}</span>` : '0',
      '$' + fmtNum(mrr),
      `<span${avgDays >= 14 ? ' style="color:#dc2626;font-weight:600"' : ''}>${avgDays}d</span>`
    ]);
  }
  body += '</table>';

  return emailWrap('CSM Performance Report',
    active.length + ' accounts &middot; ' + Object.keys(byManager).length + ' managers', body);
}

function buildSegmentAnalysis(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  const byTier: Record<string, Customer[]> = {};
  active.forEach(c => { (byTier[c.tier || 'unknown'] = byTier[c.tier || 'unknown'] || []).push(c); });

  let body = `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 8px">By Tier</div>`;
  body += tblHeader(['Tier', 'Count', 'Avg Score', 'At Risk %', 'MRR']);
  for (const [tier, arr] of Object.entries(byTier).sort((a, b) =>
    b[1].reduce((s, c) => s + (c.mrr || 0), 0) - a[1].reduce((s, c) => s + (c.mrr || 0), 0))) {
    const avg = Math.round(arr.reduce((s, c) => s + (c.score || 0), 0) / arr.length);
    const riskPct = Math.round(arr.filter(c => c.status === 'critical' || c.status === 'risk').length / arr.length * 100);
    body += tblRow([
      escHtml(tier), String(arr.length), String(avg), riskPct + '%',
      '$' + fmtNum(arr.reduce((s, c) => s + (c.mrr || 0), 0))
    ]);
  }
  body += '</table>';

  const byLC: Record<string, Customer[]> = {};
  active.forEach(c => { (byLC[c.lifecycle || 'unknown'] = byLC[c.lifecycle || 'unknown'] || []).push(c); });
  body += `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:16px 0 8px">By Lifecycle</div>`;
  body += tblHeader(['Lifecycle', 'Count', 'Avg Score', 'MRR']);
  for (const [lc, arr] of Object.entries(byLC).sort((a, b) => b[1].length - a[1].length)) {
    const avg = Math.round(arr.reduce((s, c) => s + (c.score || 0), 0) / arr.length);
    body += tblRow([
      escHtml(lc), String(arr.length), String(avg),
      '$' + fmtNum(arr.reduce((s, c) => s + (c.mrr || 0), 0))
    ]);
  }
  body += '</table>';

  return emailWrap('Segment Analysis Report', active.length + ' accounts', body);
}

function buildTrendReport(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const withHist = active.filter(c => parseJSON(c.history, []).length >= 2);
  if (!withHist.length) return '';

  const deltas = withHist.map(c => {
    const hist = parseJSON(c.history, []);
    return { c, delta: hist[hist.length - 1].score - hist[hist.length - 2].score };
  });
  const improved = [...deltas].filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
  const declined = [...deltas].filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);
  const avgDelta = Math.round(deltas.reduce((s, x) => s + x.delta, 0) / deltas.length * 10) / 10;

  let body = kpiRow([
    ['Tracked Accounts', String(withHist.length), '#1e293b'],
    ['Avg Score Change', (avgDelta >= 0 ? '+' : '') + avgDelta, avgDelta >= 0 ? '#16a34a' : '#dc2626'],
    ['Improving', String(deltas.filter(x => x.delta > 0).length), '#16a34a'],
    ['Declining', String(deltas.filter(x => x.delta < 0).length), '#dc2626'],
  ]);

  if (improved.length) {
    body += `<div style="font-size:14px;font-weight:700;color:#16a34a;margin:16px 0 8px">\u{1F4C8} Most Improved</div>`;
    body += tblHeader(['Customer', 'Current Score', 'Change', 'MRR']);
    improved.forEach(({ c, delta }) => {
      body += tblRow([
        '<strong>' + escHtml(c.name) + '</strong>', String(c.score),
        `<span style="color:#16a34a;font-weight:700">+${delta}</span>`,
        '$' + fmtNum(c.mrr || 0)
      ]);
    });
    body += '</table>';
  }
  if (declined.length) {
    body += `<div style="font-size:14px;font-weight:700;color:#dc2626;margin:16px 0 8px">\u{1F4C9} Biggest Declines</div>`;
    body += tblHeader(['Customer', 'Current Score', 'Change', 'MRR']);
    declined.forEach(({ c, delta }) => {
      body += tblRow([
        '<strong>' + escHtml(c.name) + '</strong>', String(c.score),
        `<span style="color:#dc2626;font-weight:700">${delta}</span>`,
        '$' + fmtNum(c.mrr || 0)
      ]);
    });
    body += '</table>';
  }

  return emailWrap('Trend Report (90d)', withHist.length + ' accounts with history', body);
}

function buildChurnRiskReport(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  // Composite risk score (mirrors client-side logic)
  const scored = active.map(c => {
    let risk = 0;
    if ((c.score || 100) < 50) risk += 30;
    else if ((c.score || 100) < 65) risk += 15;
    const delta = getDelta7d(c);
    if (delta < -10) risk += 20;
    else if (delta < -5) risk += 10;
    if (c.nps && c.nps !== 'unknown') {
      const npsVal = Number(c.nps);
      if (!isNaN(npsVal) && npsVal <= 6) risk += 15;
    }
    if ((c.logins || 0) <= 2) risk += 10;
    if ((c.adoption || 100) < 30) risk += 10;
    if ((c.tickets || 0) >= 5) risk += 10;
    if ((c.days || 0) >= 30) risk += 5;
    return { c, risk: Math.min(risk, 100) };
  }).sort((a, b) => b.risk - a.risk);

  const highRisk = scored.filter(x => x.risk >= 40);

  let body = kpiRow([
    ['Total Accounts', String(active.length), '#1e293b'],
    ['High Risk (40+)', String(highRisk.length), '#dc2626'],
    ['Avg Risk Score', String(Math.round(scored.reduce((s, x) => s + x.risk, 0) / scored.length)), '#d97706'],
    ['High Risk MRR', '$' + fmtNum(highRisk.reduce((s, x) => s + (x.c.mrr || 0), 0)), '#dc2626'],
  ]);

  body += `<div style="font-size:14px;font-weight:700;color:#1e293b;margin:16px 0 8px">Top 15 Churn Risk Accounts</div>`;
  body += tblHeader(['Customer', 'Risk', 'Health', 'Status', 'MRR', 'Manager']);
  scored.slice(0, 15).forEach(({ c, risk }) => {
    const rColor = risk >= 60 ? '#dc2626' : risk >= 40 ? '#f97316' : '#d97706';
    body += tblRow([
      '<strong>' + escHtml(c.name) + '</strong>',
      `<span style="color:${rColor};font-weight:700">${risk}</span>`,
      `<span style="font-weight:700;color:${STATUS_COLOR[c.status]}">${c.score}</span>`,
      `<span style="color:${STATUS_COLOR[c.status]}">\u25CF ${STATUS_LABEL[c.status]}</span>`,
      '$' + fmtNum(c.mrr || 0),
      escHtml(c.manager || '\u2014')
    ]);
  });
  body += '</table>';

  return emailWrap('Churn Risk Report', active.length + ' accounts analyzed', body);
}

function buildCustomerHealth(customers: Customer[]): string {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  if (!active.length) return '';

  let body = tblHeader(['Customer', 'Score', 'Status', 'Tier', 'MRR', 'Manager', 'Logins', 'Adoption', 'Tickets', 'NPS']);
  active.sort((a, b) => (a.score || 0) - (b.score || 0)).forEach(c => {
    body += tblRow([
      '<strong>' + escHtml(c.name) + '</strong>',
      `<span style="font-weight:700;color:${STATUS_COLOR[c.status]}">${c.score}</span>`,
      `<span style="color:${STATUS_COLOR[c.status]}">\u25CF ${STATUS_LABEL[c.status]}</span>`,
      escHtml(c.tier || '\u2014'),
      '$' + fmtNum(c.mrr || 0),
      escHtml(c.manager || '\u2014'),
      String(c.logins ?? '\u2014'),
      (c.adoption ?? '\u2014') + '%',
      String(c.tickets ?? '\u2014'),
      c.nps && c.nps !== 'unknown' ? String(c.nps) : '\u2014'
    ]);
  });
  body += '</table>';

  return emailWrap('Customer Health Report', active.length + ' active accounts', body);
}

// ── Report registry ──
const REPORT_BUILDERS: Record<string, (customers: Customer[]) => string> = {
  weekly_digest:     buildDigest,
  customer_health:   buildCustomerHealth,
  portfolio_summary: buildPortfolioSummary,
  at_risk:           buildAtRiskReport,
  renewal_forecast:  buildRenewalForecast,
  trend_report:      buildTrendReport,
  churn_risk:        buildChurnRiskReport,
  segment_analysis:  buildSegmentAnalysis,
  csm_performance:   buildCSMReport,
};

const REPORT_LABELS: Record<string, string> = {
  weekly_digest:     'Weekly Health Digest',
  customer_health:   'Customer Health Report',
  portfolio_summary: 'Portfolio Health Summary',
  at_risk:           'At-Risk Report',
  renewal_forecast:  'Renewal Forecast Report',
  trend_report:      'Trend Report (90d)',
  churn_risk:        'Churn Risk Report',
  segment_analysis:  'Segment Analysis Report',
  csm_performance:   'CSM Performance Report',
};

// ═══════════════════════════════════════════════════════════════
// SCHEDULING LOGIC  (mirrors client-side checkScheduledReports)
// ═══════════════════════════════════════════════════════════════

function isReportDue(cfg: ReportSchedule, now: Date): boolean {
  if (!cfg.enabled || !cfg.recipients) return false;

  const lastSent = cfg.last_sent ? new Date(cfg.last_sent) : null;
  if (!lastSent) return true; // Never sent — due now

  const [h, m] = (cfg.time || '09:00').split(':').map(Number);

  if (cfg.frequency === 'daily') {
    const todayCutoff = new Date(now);
    todayCutoff.setHours(h, m, 0, 0);
    return lastSent < todayCutoff && now >= todayCutoff;
  }

  // Weekly
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = dayNames.indexOf(cfg.day || 'monday');
  if (now.getDay() !== targetDay) return false;

  const cutoff = new Date(now);
  cutoff.setHours(h, m, 0, 0);
  return now >= cutoff && (now.getTime() - lastSent.getTime()) > 6 * 24 * 60 * 60 * 1000;
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  try {
    // ── Auth: verify cron secret ──
    const authHeader = req.headers.get('Authorization') || '';
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret) throw new Error('CRON_SECRET not configured');

    const token = authHeader.replace('Bearer ', '');
    if (token !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY not configured');

    const fromDomain = Deno.env.get('RESEND_FROM_DOMAIN') || 'onboarding@resend.dev';
    const fromName  = Deno.env.get('RESEND_FROM_NAME')   || 'iQcadence Reports';
    const from = fromDomain.includes('@')
      ? `${fromName} <${fromDomain}>`
      : `${fromName} <reports@${fromDomain}>`;

    // ── Query all users with settings ──
    const { data: allSettings, error: settingsErr } = await serviceClient
      .from('settings')
      .select('user_id, automations');

    if (settingsErr) throw settingsErr;
    if (!allSettings?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No settings found', sent: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    let totalSent = 0;
    let totalErrors = 0;
    const results: Array<{ user_id: string; report: string; status: string; error?: string }> = [];

    for (const row of allSettings) {
      if (!row.automations) continue;

      let cfg: any;
      try { cfg = JSON.parse(row.automations); } catch { continue; }
      if (!cfg.report_schedules) continue;

      // Check each report schedule for this user
      const dueReports: Array<{ key: string; schedule: ReportSchedule }> = [];
      for (const [key, sched] of Object.entries(cfg.report_schedules)) {
        if (isReportDue(sched as ReportSchedule, now)) {
          dueReports.push({ key, schedule: sched as ReportSchedule });
        }
      }

      if (!dueReports.length) continue;

      // Resolve user's client_id
      const { data: userProfile } = await serviceClient
        .from('user_profiles')
        .select('client_id')
        .eq('user_id', row.user_id)
        .single();
      const clientId = userProfile?.client_id;
      if (!clientId) {
        dueReports.forEach(r => {
          results.push({ user_id: row.user_id, report: r.key, status: 'skipped', error: 'No client assigned' });
        });
        continue;
      }

      // Fetch this client's customers (all users in the client see the same data)
      const { data: customers, error: custErr } = await serviceClient
        .from('customers')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null);

      if (custErr || !customers?.length) {
        dueReports.forEach(r => {
          results.push({ user_id: row.user_id, report: r.key, status: 'skipped', error: 'No customers' });
        });
        continue;
      }

      // Send each due report
      for (const { key, schedule } of dueReports) {
        const builder = REPORT_BUILDERS[key];
        if (!builder) {
          results.push({ user_id: row.user_id, report: key, status: 'skipped', error: 'Unknown report type' });
          continue;
        }

        try {
          const html = builder(customers as Customer[]);
          if (!html) {
            results.push({ user_id: row.user_id, report: key, status: 'skipped', error: 'Empty report' });
            continue;
          }

          // Digest has its own wrapper; others are already wrapped by emailWrap()
          const finalHtml = key === 'weekly_digest'
            ? `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:20px;background:#f1f5f9">${html}</body></html>`
            : html;

          const subject = (schedule.subject_prefix || '[iQcadence Report]') + ' ' +
            (REPORT_LABELS[key] || key) + ' \u2014 ' + dateStr();

          const toList = schedule.recipients.split(',').map((e: string) => e.trim()).filter(Boolean);
          if (!toList.length) {
            results.push({ user_id: row.user_id, report: key, status: 'skipped', error: 'No recipients' });
            continue;
          }

          // Send via Resend
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: toList, subject, html: finalHtml }),
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(`Resend HTTP ${resp.status}: ${errBody}`);
          }

          // Log the event
          await serviceClient.from('webhook_events').insert({
            user_id:       row.user_id,
            direction:     'outbound',
            event_type:    'report_scheduled_' + key,
            payload:       JSON.stringify({ recipients: schedule.recipients, subject }),
            status:        'success',
            status_code:   resp.status,
            customer_name: ''
          });

          // Update last_sent
          schedule.last_sent = now.toISOString();
          cfg.report_schedules[key] = schedule;

          totalSent++;
          results.push({ user_id: row.user_id, report: key, status: 'sent' });

        } catch (sendErr: any) {
          totalErrors++;
          results.push({ user_id: row.user_id, report: key, status: 'failed', error: sendErr.message });

          // Log the error
          await serviceClient.from('webhook_events').insert({
            user_id:       row.user_id,
            direction:     'outbound',
            event_type:    'report_scheduled_' + key,
            payload:       JSON.stringify({ recipients: schedule.recipients }),
            status:        'failed',
            error_msg:     sendErr.message,
            customer_name: ''
          }).catch(() => { /* best-effort logging */ });
        }
      }

      // Persist updated last_sent values for this user
      await serviceClient.from('settings').update({
        automations: JSON.stringify(cfg),
        updated_at:  now.toISOString()
      }).eq('user_id', row.user_id);
    }

    return new Response(JSON.stringify({ success: true, sent: totalSent, errors: totalErrors, results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
