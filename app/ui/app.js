'use strict';

// ════════════════════════════════════════════════════════════════════════
//  ICONS  (inline SVG strings — no external dependency)
// ════════════════════════════════════════════════════════════════════════

const ICON = {
  dashboard: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/></svg>`,
  rules:     `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h9"/></svg>`,
  profiles:  `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="5" rx="1.5"/><rect x="2" y="11" width="16" height="5" rx="1.5"/><circle cx="5.5" cy="5.5" r=".8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="13.5" r=".8" fill="currentColor" stroke="none"/></svg>`,
  history:   `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 6.5V10l2.5 2.5"/></svg>`,
  logs:      `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8l2.5 2.5L6 13M12 13h4"/></svg>`,
  settings:  `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5V4M10 16v1.5M2.5 10H4M16 10h1.5M4.55 4.55l1.06 1.06M14.39 14.39l1.06 1.06M4.55 15.45l1.06-1.06M14.39 5.61l1.06-1.06"/></svg>`,
  import:    `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M5 8l5 5 5-5"/><path d="M3 16h14"/></svg>`,
  plus:      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`,
  refresh:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 6A6 6 0 102.5 10"/><path d="M13.5 2v4h-4"/></svg>`,
  close:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`,
  edit:      `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2.5a2.12 2.12 0 013 3L6 17H2v-4L14.5 2.5z"/></svg>`,
  trash:     `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h14M8 6V4h4v2M17 6l-1 11a2 2 0 01-2 2H6a2 2 0 01-2-2L3 6"/></svg>`,
  play:      `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5L17 10 5 16.5V3.5z"/></svg>`,
  folder:    `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a2 2 0 012-2h3.5l2 2H16a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`,
  chevron:   `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5l3 3 3-3"/></svg>`,
  chevronL:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 3L5 7l4 4"/></svg>`,
  file:      `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h8l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v5h4"/></svg>`,
  arrowUp:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V3M3 7l4-4 4 4"/></svg>`,
  star:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  starFilled: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  copy:       `<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M4.5 13H4a1.5 1.5 0 01-1.5-1.5V4A1.5 1.5 0 014 2.5h7.5A1.5 1.5 0 0113 4v.5"/></svg>`,
  check:      `<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4 4 8-8"/></svg>`,
};

// ════════════════════════════════════════════════════════════════════════
//  NAV CONFIGURATION
// ════════════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'rules',     label: 'Rules' },
  { id: 'profiles',  label: 'Profiles' },
  { id: 'history',   label: 'History' },
  { id: 'logs',      label: 'Logs' },
  { id: 'settings',  label: 'Settings' },
];

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  rules:     'Rules',
  profiles:  'Profiles',
  history:   'History',
  logs:      'Logs',
  settings:       'Settings',
  'rule-builder': 'Rule Builder',
};

// ════════════════════════════════════════════════════════════════════════
//  RULE BUILDER CONSTANTS
// ════════════════════════════════════════════════════════════════════════

const CRON_PRESETS = [
  { label: 'Manual (no schedule)',  value: 'manual'          },
  { label: 'Every 5 minutes',       value: '*/5 * * * *'     },
  { label: 'Every 15 minutes',      value: '*/15 * * * *'    },
  { label: 'Every 30 minutes',      value: '*/30 * * * *'    },
  { label: 'Every hour',            value: '0 * * * *'       },
  { label: 'Every 6 hours',         value: '0 */6 * * *'     },
  { label: 'Daily at midnight',     value: '0 0 * * *'       },
  { label: 'Daily at 6:00 AM',      value: '0 6 * * *'       },
  { label: 'Daily at 8:00 AM',      value: '0 8 * * *'       },
  { label: 'Custom…',               value: '__custom__'      },
];

const FILTER_PRESETS = ['*.csv', '*.txt', '*.xml', '*.pgp', '*.*', '**/*.*'];

// ════════════════════════════════════════════════════════════════════════
//  APP STATE
// ════════════════════════════════════════════════════════════════════════

const app = {
  user:                null,
  view:                null,
  cleanup:             null,
  sessionExpiry:       null,
  heartbeatTimer:      null,
  sessionTimeoutMs:    30 * 60 * 1000,
  editingRuleId:       null,
  editingRuleGroupId:  null,
  // Where "Back" (or a successful save) in the Rule Builder should return to.
  // Set by whichever view navigated INTO the Rule Builder, e.g. Rules or
  // History, so the filter/group/search query string that view had active
  // isn't lost. See navigate()'s targetHash param and returnFromRuleBuilder().
  rbReturnView:        null,
  rbReturnHash:        null,
};

// Leave the Rule Builder and go back to whichever view sent us here
// (Rules or History), restoring that view's filter query string if we
// captured one on the way in.
function returnFromRuleBuilder() {
  const view = app.rbReturnView || 'rules';
  const hash = app.rbReturnHash;
  app.rbReturnView = null;
  app.rbReturnHash = null;
  navigate(view, (hash && hash.split('?')[0] === '#' + view) ? hash : undefined);
}

function resetExpiry() {
  app.sessionExpiry = Date.now() + app.sessionTimeoutMs;
}

function stopHeartbeat() {
  if (app.heartbeatTimer) { clearInterval(app.heartbeatTimer); app.heartbeatTimer = null; }
}

function startHeartbeat() {
  stopHeartbeat();
  app.heartbeatTimer = setInterval(async () => {
    if (app.sessionExpiry && Date.now() > app.sessionExpiry) {
      app.user = null;
      showLogin('Session expired — please log in again');
      return;
    }
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        app.user = null;
        showLogin('Session expired — please log in again');
      } else if (res.ok) {
        resetExpiry();
      }
    } catch { /* network blip — don't log out */ }
  }, 60_000);
}

// ════════════════════════════════════════════════════════════════════════
//  API HELPER
// ════════════════════════════════════════════════════════════════════════

async function apiFetch(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body    = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
    setOnline(true);
  } catch {
    setOnline(false);
    throw new Error('Network error — server unreachable');
  }
  if (res.status === 401) {
    const wasLoggedIn = !!app.user;
    app.user = null;
    showLogin(wasLoggedIn ? 'Session expired — please log in again' : null);
    return null;
  }
  resetExpiry();
  return res;
}

const API = {
  get:    (url)       => apiFetch('GET',    url),
  post:   (url, body) => apiFetch('POST',   url, body),
  put:    (url, body) => apiFetch('PUT',    url, body),
  del:    (url)       => apiFetch('DELETE', url),

  async json(method, url, body) {
    const res = await apiFetch(method, url, body);
    if (!res) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
    }
    return res.json();
  },

  getJSON:    url        => API.json('GET',    url),
  postJSON:   (url, b)   => API.json('POST',   url, b),
  putJSON:    (url, b)   => API.json('PUT',    url, b),
  deleteJSON: url        => API.json('DELETE', url),
};

// ════════════════════════════════════════════════════════════════════════
//  ONLINE INDICATOR
// ════════════════════════════════════════════════════════════════════════

function setOnline(online) {
  const pill = document.getElementById('status-pill');
  if (!pill) return;
  pill.textContent = online ? 'Online' : 'Offline';
  pill.className   = `status-pill ${online ? 'online' : 'offline'}`;
}

// ════════════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════════════

function showLogin(msg) {
  stopHeartbeat();
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  const errEl = document.getElementById('login-err');
  if (errEl) {
    if (msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    else      { errEl.classList.add('hidden'); }
  }
  requestAnimationFrame(() => {
    const f = document.getElementById('login-username');
    if (f) f.focus();
  });
}

function hideLogin() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async ev => {
  ev.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-err');
  const btn      = document.getElementById('login-btn');

  errEl.classList.add('hidden');
  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed';
      errEl.classList.remove('hidden');
      document.getElementById('login-password').select();
      return;
    }

    app.user = data;
    hideLogin();
    bootApp();
  } catch {
    errEl.textContent = 'Network error — server unreachable';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign in';
  }
});

// ════════════════════════════════════════════════════════════════════════
//  APP BOOT
// ════════════════════════════════════════════════════════════════════════

function bootApp() {
  buildNav();
  updateUserDisplay();
  routeFromHash();
  // Fetch session timeout, then arm the heartbeat
  fetch('/api/settings')
    .then(r => r.ok ? r.json() : null)
    .then(cfg => {
      if (cfg?.sessionTimeoutMinutes) app.sessionTimeoutMs = cfg.sessionTimeoutMinutes * 60_000;
    })
    .catch(() => {})
    .finally(() => { resetExpiry(); startHeartbeat(); });
}

function buildNav() {
  document.getElementById('sidebar-nav').innerHTML = NAV_ITEMS.map(n => {
    const href = n.href ? n.href : `#${n.id}`;
    const extra = n.href ? 'target="_blank" rel="noopener"' : `data-view="${n.id}"`;
    return `
      <a href="${href}" class="nav-item" ${extra}>
        <span class="nav-icon">${ICON[n.id]}</span>
        <span class="nav-label">${n.label}</span>
      </a>`;
  }).join('');
}

function updateUserDisplay() {
  const u = app.user;
  if (!u) return;
  document.getElementById('user-name').textContent   = u.username;
  document.getElementById('user-avatar').textContent = u.username[0].toUpperCase();
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  stopHeartbeat();
  await API.post('/api/auth/logout').catch(() => {});
  app.user = null;
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  showLogin();
});

// ════════════════════════════════════════════════════════════════════════
//  ROUTER
// ════════════════════════════════════════════════════════════════════════

function routeFromHash() {
  const raw  = location.hash.slice(1) || 'dashboard';
  const view = raw.split('?')[0];
  navigate(VIEW_TITLES[view] ? view : 'dashboard');
}

function navigate(view, targetHash) {
  // Teardown previous view
  if (app.cleanup) {
    try { app.cleanup(); } catch {}
    app.cleanup = null;
  }
  app.view = view;

  // Update URL (preserve params if already on this view). When switching
  // views, targetHash lets the caller restore a specific query string
  // (e.g. a filtered Rules or History view) instead of resetting to bare
  // '#view' — this must happen before the view's render fn runs, since
  // some views (History) read location.hash synchronously on init.
  const current = location.hash.slice(1).split('?')[0];
  if (current !== view) history.replaceState(null, '', targetHash || `#${view}`);

  // Nav active state
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === view));

  // Topbar title
  document.getElementById('view-title').textContent = VIEW_TITLES[view] || view;

  // Render view
  const el = document.getElementById('view');
  el.innerHTML = '';
  const render = VIEWS[view];
  if (render) app.cleanup = render(el) ?? null;
}

window.addEventListener('hashchange', () => {
  if (app.user) routeFromHash();
});

// ════════════════════════════════════════════════════════════════════════
//  VIEW REGISTRY
// ════════════════════════════════════════════════════════════════════════

const VIEWS = {};

// ── Dashboard ─────────────────────────────────────────────────────────
VIEWS.dashboard = function(el) {
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  let jobs        = [];
  let activeJobs  = 0;
  let nextFire    = null;
  let painted     = false;
  let dashHideIdle = localStorage.getItem('dashboardHideIdle') !== '0';

  async function refresh() {
    try {
      const [r1, r2, r3] = await Promise.all([
        API.get('/api/jobs?limit=200'),
        API.get('/api/jobs/running'),
        API.get('/api/rules/next-fire'),
      ]);
      if (!r1 || !r2 || !r3) return;
      const jd = await r1.json();
      jobs  = jd.jobs  || [];
      const rd = await r2.json();
      activeJobs = rd.count || 0;
      nextFire = await r3.json();
      paint();
      painted = true;
    } catch (err) {
      if (!painted) el.innerHTML = `<div class="alert alert-error" style="max-width:480px">Failed to load: ${esc(err.message)}</div>`;
    }
  }

  function paint() {
    const now     = Date.now();
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const h24ago  = new Date(now - 86_400_000);

    const todayJobs    = jobs.filter(j => j.startTime && new Date(j.startTime) >= today);
    const filesToday   = todayJobs.reduce((s, j) => s + (j.filesTransferred || 0), 0);
    const jobs24       = jobs.filter(j => j.startTime && new Date(j.startTime) >= h24ago);
    const successCount = jobs24.filter(j => j.status === 'success').length;
    const successRate  = jobs24.length ? Math.round(successCount / jobs24.length * 100) : 100;

    const rateClass = successRate < 80 ? 'text-danger' : successRate < 95 ? 'text-warn' : 'text-success';

    el.innerHTML = `
      <div class="dash-stats">
        <div class="card stat-card">
          <div class="stat-label">Active Jobs</div>
          <div class="stat-value${activeJobs > 0 ? ' text-accent' : ''}">${activeJobs}</div>
          <div class="stat-sub text-muted">running now</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Files Today</div>
          <div class="stat-value">${filesToday.toLocaleString()}</div>
          <div class="stat-sub text-muted">${todayJobs.length} job${todayJobs.length !== 1 ? 's' : ''} run</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">24h Success Rate</div>
          <div class="stat-value ${rateClass}">${successRate}%</div>
          <div class="stat-sub text-muted">${jobs24.length} job${jobs24.length !== 1 ? 's' : ''} in window</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">Next Schedule</div>
          <div class="stat-value stat-value-sm">${nextFire ? esc(nextFire.name) : '—'}</div>
          <div class="stat-sub text-muted">${nextFire ? esc(fmtNextFire(nextFire.nextFireTime, nextFire.cron)) : 'no scheduled rules'}</div>
        </div>
      </div>

      <div class="dash-panels">
        <div class="card" style="min-width:0">
          <div class="card-header">
            <span class="card-title">Recent Jobs</span>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text);cursor:pointer;user-select:none;white-space:nowrap">
              <input id="dash-hide-idle" type="checkbox" ${dashHideIdle ? 'checked' : ''}>
              Hide Idle
            </label>
            <a href="#history" class="btn btn-ghost btn-sm">View all</a>
          </div>
          ${recentJobsHTML((dashHideIdle ? jobs.filter(j => j.subStatus !== 'idle') : jobs).slice(0, 10))}
        </div>
      </div>`;

    document.getElementById('dash-hide-idle')?.addEventListener('change', function() {
      dashHideIdle = this.checked;
      localStorage.setItem('dashboardHideIdle', this.checked ? '1' : '0');
      paint();
    });
  }

  function recentJobsHTML(list) {
    if (!list.length) return '<div class="empty-state"><p>No jobs in history yet.</p></div>';
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Status</th><th>Rule</th><th>Files</th>
            <th>Size</th><th>Duration</th><th>Time</th>
          </tr></thead>
          <tbody>${list.map(j => {
            const dur = (j.startTime && j.endTime)
              ? new Date(j.endTime) - new Date(j.startTime) : null;
            return `<tr>
              <td>${statusBadge(j.status, j.subStatus)}</td>
              <td class="job-rule-name">${esc(j.ruleName || j.ruleId || '—')}</td>
              <td>${j.filesTransferred ?? '—'}</td>
              <td class="text-muted">${fmtBytes(j.bytesTransferred)}</td>
              <td class="text-muted">${fmtDuration(dur)}</td>
              <td class="text-muted">${fmtTime(j.startTime)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function fmtCron(expr) {
    if (!expr || expr === 'manual') return 'manual';
    let m;
    if ((m = expr.match(/^\*\/(\d+) \* \* \* \*$/)))   return `every ${m[1]} min`;
    if ((m = expr.match(/^0 \*\/(\d+) \* \* \*$/)))    return `every ${m[1]} hr`;
    if ((m = expr.match(/^0 (\d+) \* \* \*$/)))        return `daily at ${m[1].padStart(2,'0')}:00`;
    if ((m = expr.match(/^(\d+) (\d+) \* \* \*$/)))    return `daily at ${m[2].padStart(2,'0')}:${m[1].padStart(2,'0')}`;
    return expr;
  }

  /** Format a computed next-fire ISO timestamp with a relative descriptor.
   *  Falls back to the raw cron description if the timestamp is missing/invalid. */
  function fmtNextFire(iso, cronExpr) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return fmtCron(cronExpr);

    const mins = Math.round(Math.max(0, d.getTime() - Date.now()) / 60_000);
    let rel;
    if (mins < 1)          rel = 'due now';
    else if (mins < 60)    rel = `in ${mins}m`;
    else if (mins < 1_440) rel = `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    else                   rel = `in ${Math.floor(mins / 1_440)}d`;

    return `${fmtTime(iso)} (${rel})`;
  }

  refresh();
  const timer = setInterval(refresh, 10_000);
  return () => clearInterval(timer);
};

// ── Rules ─────────────────────────────────────────────────────────────
VIEWS.rules = function(el) {
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const isAdmin = app.user?.role === 'admin';

  let allRules     = [];
  let allGroups    = [];
  let allJobs      = [];
  let tagKeys      = [];
  let selected     = new Set();
  let groupSearch  = '';
  let offset       = 0;
  const LIMIT      = 50;
  let sortField    = 'name';
  let sortDir      = 'asc';

  // ── Load ──────────────────────────────────────────────────────────
  async function loadData() {
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        API.get('/api/rules'),
        API.get('/api/groups'),
        API.get('/api/tags/keys'),
        API.get('/api/jobs?limit=500'),
      ]);
      if (!r1 || !r2 || !r3) return;
      allRules  = await r1.json();
      allGroups = await r2.json();
      tagKeys   = await r3.json();
      const jd  = r4 ? await r4.json() : {};
      allJobs   = jd.jobs || [];
      render();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-error">Failed to load rules: ${esc(err.message)}</div>`;
    }
  }

  // ── URL filter state ──────────────────────────────────────────────
  // The ?group= param is stored/read as the group's NAME (human-bookmarkable,
  // matches CLAUDE.md's URL State Persistence spec), while everywhere else in
  // this view keeps working with the group's id internally — translate at
  // this one boundary so applyFilters()/renderGroups() etc. don't change.
  function getFilters() {
    const p = getHashParams();
    const tags = {};
    for (const [k, v] of p.entries()) {
      if (['group','logic','q','status'].includes(k)) continue;
      (tags[k] = tags[k] || []).push(v);
    }
    const groupParam = p.get('group') || '';
    let group = '';
    if (groupParam === 'Ungrouped') group = '__ungrouped';
    else if (groupParam) {
      const match = allGroups.find(g => g.name === groupParam);
      // Fall back to the raw param if no group matches (e.g. renamed/deleted
      // group in an old bookmark) — filtering on an unknown id just yields
      // zero rules instead of throwing.
      group = match ? match.id : groupParam;
    }
    return {
      group,
      q:      p.get('q')      || '',
      logic:  p.get('logic')  || 'AND',
      status: p.get('status') || '',
      tags,
    };
  }

  function saveFilters(f) {
    const p = new URLSearchParams();
    if (f.group) {
      const name = f.group === '__ungrouped'
        ? 'Ungrouped'
        : (allGroups.find(g => g.id === f.group)?.name || f.group);
      p.set('group', name);
    }
    if (f.q)      p.set('q',      f.q);
    if (f.logic && f.logic !== 'AND') p.set('logic', f.logic);
    if (f.status) p.set('status', f.status);
    for (const [k, vals] of Object.entries(f.tags || {}))
      (vals || []).forEach(v => p.append(k, v));
    setHashParams(p);
  }

  // ── Filter logic ──────────────────────────────────────────────────
  function applyFilters(f) {
    let out = allRules;
    if (f.group === '__ungrouped') out = out.filter(r => !r.groupId);
    else if (f.group)              out = out.filter(r => r.groupId === f.group);
    if (f.q)   { const q = f.q.toLowerCase(); out = out.filter(r => r.name.toLowerCase().includes(q)); }
    if (f.status === 'enabled')  out = out.filter(r => r.enabled !== false);
    if (f.status === 'disabled') out = out.filter(r => r.enabled === false);

    const tagEntries = Object.entries(f.tags || {});
    if (tagEntries.length) {
      out = out.filter(rule => {
        const rt      = rule.tags || [];
        const checks  = tagEntries.map(([k, vals]) => vals.some(v => rt.includes(`${k}:${v}`)));
        return f.logic === 'OR' ? checks.some(Boolean) : checks.every(Boolean);
      });
    }
    return out;
  }

  // ── Sorting ───────────────────────────────────────────────────────
  // Sort accessors — lastRun/lastResult need the matching job from allJobs
  // the same way the table cells look it up (most recent job per rule).
  const SORT_ACCESSORS = {
    name:       r => (r.name || '').toLowerCase(),
    source:     r => (r.source?.path || r.source?.remotePath || r.source?.profileId || '').toLowerCase(),
    action:     r => r.action || 'copy',
    schedule:   r => (r.cron && r.cron !== 'manual') ? r.cron : '',
    lastRun:    r => { const j = allJobs.find(j => j.ruleId === r.id); return j?.startTime ? new Date(j.startTime).getTime() : -Infinity; },
    lastResult: r => { const j = allJobs.find(j => j.ruleId === r.id); return j?.status || ''; },
  };

  function sortRules(list) {
    const get = SORT_ACCESSORS[sortField] || SORT_ACCESSORS.name;
    const sorted = [...list].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      const cmp = String(va).localeCompare(String(vb));
      return cmp;
    });
    if (sortDir === 'desc') sorted.reverse();
    return sorted;
  }

  function sortTh(field, label) {
    const active = sortField === field;
    const arrow  = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="rules-sort-th${active ? ' active' : ''}" data-sort="${esc(field)}">${esc(label)}${arrow}</th>`;
  }

  // ── Render shell ──────────────────────────────────────────────────
  function render() {
    const f        = getFilters();
    const filtered = sortRules(applyFilters(f));

    el.innerHTML = `
      <div class="rules-topbar">
        <div id="rules-filter-bar" class="rules-filter-bar"></div>
        ${isAdmin ? `<button id="new-rule-btn" class="btn btn-primary btn-sm">${ICON.plus} New Rule</button>` : ''}
      </div>
      <div class="rules-layout">
        <div id="groups-panel" class="groups-panel"></div>
        <div id="rules-main"></div>
      </div>`;

    renderGroups(f);
    renderFilterBar(f, filtered);
    renderMain(f, filtered);

    document.getElementById('new-rule-btn')?.addEventListener('click', () => {
      openGroupPickerThenCreate();
    });
  }

  // ── Groups panel ──────────────────────────────────────────────────
  function renderGroups(f) {
    const panel = document.getElementById('groups-panel');
    const ungroupedCnt = allRules.filter(r => !r.groupId).length;

    const sortedGroups = [...allGroups].sort((a, b) => a.name.localeCompare(b.name));

    const items = [
      { id: '', label: 'All Rules', count: allRules.length, tags: [], isSystem: true },
      ...sortedGroups.map(g => ({
        id: g.id, label: g.name,
        count: allRules.filter(r => r.groupId === g.id).length,
        tags: g.tags || [],
        isSystem: false,
        groupObj: g,
      })),
      ...(ungroupedCnt > 0 ? [{ id: '__ungrouped', label: 'Ungrouped', count: ungroupedCnt, tags: [], isSystem: true }] : []),
    ];

    const q = groupSearch.toLowerCase();
    const visibleItems = items.filter(item => item.id === '' || item.label.toLowerCase().includes(q));

    // Preserve focus/cursor across the innerHTML rebuild triggered by debounced search input
    const prevSearchEl = document.getElementById('group-search');
    const hadFocus  = prevSearchEl && document.activeElement === prevSearchEl;
    const caretPos  = hadFocus ? prevSearchEl.selectionStart : null;

    panel.innerHTML = `
      <div class="groups-panel-header">
        <span class="groups-panel-title">Groups</span>
        ${isAdmin ? `<button id="add-group-btn" class="groups-add-btn" title="New group">${ICON.plus}</button>` : ''}
      </div>
      <input id="group-search" type="text" placeholder="Search groups…" class="groups-search-input" value="${esc(groupSearch)}">
      ${visibleItems.map(item => `
        <div class="group-item${f.group === item.id ? ' active' : ''}" data-group="${esc(item.id)}"${!item.isSystem ? ` data-group-id="${esc(item.id)}"` : ''}>
          <div class="group-item-name">
            ${ICON.folder}
            <span class="group-name-text">${esc(item.label)}</span>
            <span class="group-count">${item.count}</span>
            ${(!item.isSystem && isAdmin) ? `<button class="group-menu-btn" data-menu-id="${esc(item.id)}" title="Group actions">···</button>` : ''}
          </div>
          ${item.tags.length ? `<div class="group-item-tags">${item.tags.map(t => tagPill(t)).join('')}</div>` : ''}
        </div>`).join('')}
      ${!visibleItems.length ? '<div class="empty-state" style="padding:24px 14px"><p class="text-muted text-sm">No groups match.</p></div>' : ''}`;

    let groupSearchTimer;
    document.getElementById('group-search')?.addEventListener('input', function() {
      const val = this.value;
      clearTimeout(groupSearchTimer);
      groupSearchTimer = setTimeout(() => { groupSearch = val; renderGroups(f); }, 150);
    });

    const searchEl = document.getElementById('group-search');
    if (hadFocus && searchEl) {
      searchEl.focus();
      searchEl.setSelectionRange(caretPos, caretPos);
    }

    // Click to filter (ignore clicks on the menu button or rename input)
    panel.querySelectorAll('.group-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.group-menu-btn') || e.target.closest('.group-rename-input')) return;
        const nf = getFilters();
        nf.group = row.dataset.group;
        saveFilters(nf);
        offset = 0;
        render();
      });
    });

    // Right-click context menu on real groups
    panel.querySelectorAll('[data-group-id]').forEach(row => {
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        const g = allGroups.find(x => x.id === row.dataset.groupId);
        if (g) showGroupCtxMenu(g, e.clientX, e.clientY);
      });
    });

    // "···" button
    panel.querySelectorAll('.group-menu-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const g = allGroups.find(x => x.id === btn.dataset.menuId);
        if (!g) return;
        const rect = btn.getBoundingClientRect();
        showGroupCtxMenu(g, rect.right, rect.bottom);
      });
    });

    // Double-click name → inline rename
    panel.querySelectorAll('[data-group-id] .group-name-text').forEach(span => {
      span.addEventListener('dblclick', e => {
        e.stopPropagation();
        const g = allGroups.find(x => x.id === span.closest('[data-group-id]').dataset.groupId);
        if (g) startInlineRename(g, span);
      });
    });

    document.getElementById('add-group-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openGroupModal(null);
    });
  }

  // ── Group context menu ────────────────────────────────────────────
  function showGroupCtxMenu(group, x, y) {
    document.querySelectorAll('.group-ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'group-ctx-menu';
    menu.innerHTML = `
      <button data-action="rename">Rename</button>
      <button data-action="edit-tags">Edit Tags</button>
      <div class="ctx-sep"></div>
      <button data-action="delete" class="ctx-danger">Delete</button>`;

    menu.style.top  = `${Math.min(y, window.innerHeight - 130)}px`;
    menu.style.left = `${Math.min(x, window.innerWidth  - 170)}px`;
    document.body.appendChild(menu);

    menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
      menu.remove();
      const row  = document.querySelector(`[data-group-id="${group.id}"]`);
      const span = row?.querySelector('.group-name-text');
      if (span) startInlineRename(group, span);
    });
    menu.querySelector('[data-action="edit-tags"]').addEventListener('click', () => {
      menu.remove();
      openGroupModal(group);
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
      menu.remove();
      deleteGroupFlow(group);
    });

    const dismiss = e => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  // ── Inline rename ─────────────────────────────────────────────────
  function startInlineRename(group, span) {
    const original = group.name;
    const input    = document.createElement('input');
    input.type      = 'text';
    input.value     = original;
    input.className = 'group-rename-input';
    span.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    async function commit() {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (!newName || newName === original) { input.replaceWith(span); return; }
      try {
        await API.putJSON(`/api/groups/${group.id}`, { ...group, name: newName });
        await loadData();
      } catch (err) {
        alert(`Rename failed: ${err.message}`);
        input.replaceWith(span);
      }
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { committed = true; input.replaceWith(span); }
    });
    input.addEventListener('blur', commit);
  }

  // ── Create / edit group modal ─────────────────────────────────────
  function openGroupModal(group) {
    const isNew     = !group;
    let   localTags = [...(group?.tags || [])];

    const bodyEl = document.createElement('div');

    function renderBody() {
      bodyEl.innerHTML = `
        <div class="field">
          <label>Group name</label>
          <input id="gm-name" type="text" placeholder="e.g. Partner Inbound" value="${esc(group?.name || '')}">
        </div>
        <div class="field" style="margin-top:14px">
          <label>Tags</label>
          <div class="tags-display" style="margin-bottom:8px">
            ${localTags.map(t => {
              const [k, ...vParts] = t.split(':');
              return `<span class="tag" style="display:inline-flex;align-items:center;gap:4px">
                <span class="tag-key">${esc(k)}:</span>${esc(vParts.join(':'))}
                <button class="gm-tag-rm" data-tag="${esc(t)}"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0;line-height:1;display:flex">${ICON.close}</button>
              </span>`;
            }).join('')}
            ${!localTags.length ? '<span class="text-muted text-sm">No tags</span>' : ''}
          </div>
          <div class="tag-add-row">
            <select id="gm-key" style="width:110px;padding:6px 8px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
              ${tagKeys.length ? tagKeys.map(k => `<option>${esc(k)}</option>`).join('') : '<option value="">— add keys in Settings —</option>'}
            </select>
            <input id="gm-val" type="text" placeholder="value"
              style="flex:1;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
            <button id="gm-add-tag" class="btn btn-ghost btn-sm">${ICON.plus} Add</button>
          </div>
        </div>
        <div id="gm-err" class="alert alert-error hidden" style="margin-top:10px"></div>`;

      bodyEl.querySelectorAll('.gm-tag-rm').forEach(btn => {
        btn.addEventListener('click', () => { localTags = localTags.filter(t => t !== btn.dataset.tag); renderBody(); });
      });
      bodyEl.querySelector('#gm-add-tag')?.addEventListener('click', () => {
        const k = bodyEl.querySelector('#gm-key')?.value.trim();
        const v = bodyEl.querySelector('#gm-val')?.value.trim();
        if (!k || !v) return;
        const tag = `${k}:${v}`;
        if (!localTags.includes(tag)) { localTags.push(tag); renderBody(); }
      });
    }

    renderBody();

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="gm-cancel" class="btn btn-ghost">Cancel</button>
      <button id="gm-save"   class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button>`;

    const { close } = openModal({ title: isNew ? 'New Group' : `Edit — ${esc(group.name)}`, body: bodyEl, footer: footEl });

    footEl.querySelector('#gm-cancel').addEventListener('click', close);
    footEl.querySelector('#gm-save').addEventListener('click', async () => {
      const name    = bodyEl.querySelector('#gm-name').value.trim();
      const errEl   = bodyEl.querySelector('#gm-err');
      const saveBtn = footEl.querySelector('#gm-save');
      errEl.classList.add('hidden');
      if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        if (isNew) await API.postJSON('/api/groups', { name, tags: localTags });
        else       await API.putJSON(`/api/groups/${group.id}`, { ...group, name, tags: localTags });
        close();
        await loadData();
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Create' : 'Save';
      }
    });
  }

  // ── Delete group (with move-rules prompt) ─────────────────────────
  function deleteGroupFlow(group) {
    const memberCount = allRules.filter(r => r.groupId === group.id).length;
    const otherGroups = allGroups.filter(g => g.id !== group.id);

    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <p>Delete group <strong>${esc(group.name)}</strong>?</p>
      ${memberCount > 0 ? `
        <p class="text-muted text-sm" style="margin-top:8px">
          ${memberCount} rule${memberCount !== 1 ? 's' : ''} will be moved to:
        </p>
        <div class="field" style="margin-top:10px">
          <select id="del-move-target">
            <option value="">Ungrouped</option>
            ${otherGroups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>` : `<p class="text-muted text-sm" style="margin-top:8px">This group has no rules.</p>`}
      <div id="del-err" class="alert alert-error hidden" style="margin-top:10px"></div>`;

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="del-cancel"  class="btn btn-ghost">Cancel</button>
      <button id="del-confirm" class="btn btn-danger">Delete</button>`;

    const { close } = openModal({ title: 'Delete Group', body: bodyEl, footer: footEl });

    footEl.querySelector('#del-cancel').addEventListener('click', close);
    footEl.querySelector('#del-confirm').addEventListener('click', async () => {
      const moveTarget = bodyEl.querySelector('#del-move-target')?.value || '';
      const errEl      = bodyEl.querySelector('#del-err');
      const delBtn     = footEl.querySelector('#del-confirm');
      errEl.classList.add('hidden');
      delBtn.disabled = true; delBtn.textContent = 'Deleting…';
      try {
        const url = `/api/groups/${group.id}${moveTarget ? '?moveRules=' + encodeURIComponent(moveTarget) : ''}`;
        await API.deleteJSON(url);
        // If the deleted group was the active filter, reset to All Rules
        const nf = getFilters();
        if (nf.group === group.id) { nf.group = ''; saveFilters(nf); }
        close();
        await loadData();
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        delBtn.disabled = false; delBtn.textContent = 'Delete';
      }
    });
  }

  // ── New Rule with group picker ─────────────────────────────────────
  function openGroupPickerThenCreate() {
    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="field">
        <label>Place in group</label>
        <select id="pick-group" style="width:100%">
          <option value="">Ungrouped</option>
          ${allGroups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}
        </select>
      </div>`;

    // Default to the currently filtered group if it's a real group
    const currentGroup = getFilters().group;
    if (currentGroup && currentGroup !== '__ungrouped') {
      setTimeout(() => { const s = bodyEl.querySelector('#pick-group'); if (s) s.value = currentGroup; }, 0);
    }

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="pick-cancel" class="btn btn-ghost">Cancel</button>
      <button id="pick-go"     class="btn btn-primary">Continue</button>`;

    const { close } = openModal({ title: 'New Rule', body: bodyEl, footer: footEl });

    footEl.querySelector('#pick-cancel').addEventListener('click', close);
    footEl.querySelector('#pick-go').addEventListener('click', () => {
      const gid = bodyEl.querySelector('#pick-group').value;
      app.editingRuleId      = null;
      app.editingRuleGroupId = gid || null;
      app.rbReturnView       = 'rules';
      app.rbReturnHash       = location.hash;
      close();
      navigate('rule-builder');
    });
  }

  // ── Filter bar ────────────────────────────────────────────────────
  function renderFilterBar(f, filtered) {
    const bar = document.getElementById('rules-filter-bar');

    // Collect all tags used across ALL rules
    const byKey = new Map();
    allRules.forEach(r => (r.tags || []).forEach(t => {
      const [k, v] = t.split(':');
      if (!k) return;
      (byKey.get(k) || byKey.set(k, new Set()).get(k)).add(v || '');
    }));

    const hasTagFilters = Object.keys(f.tags).length > 0;

    bar.innerHTML = `
      <div style="position:relative;flex-shrink:0">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);display:flex">${ICON.rules}</span>
        <input id="filter-q" type="text"
          style="width:200px;padding:7px 12px 7px 32px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px"
          placeholder="Search rules…" value="${esc(f.q)}">
      </div>
      ${[...byKey.entries()].map(([k, vals]) =>
        [...vals].map(v => {
          const active = (f.tags[k] || []).includes(v);
          return `<button class="filter-chip${active ? ' active' : ''}" data-key="${esc(k)}" data-val="${esc(v)}">
            <span class="tag-key">${esc(k)}:</span>${esc(v)}
            ${active ? `<span class="chip-x">${ICON.close}</span>` : ''}
          </button>`;
        }).join('')
      ).join('')}
      ${byKey.size > 0 || hasTagFilters ? `
        <div class="logic-toggle">
          <button class="logic-btn${f.logic !== 'OR' ? ' active' : ''}" data-logic="AND">AND</button>
          <button class="logic-btn${f.logic === 'OR'  ? ' active' : ''}" data-logic="OR">OR</button>
        </div>` : ''}
      <span class="text-muted text-sm" style="white-space:nowrap;margin-left:4px">${filtered.length} rule${filtered.length !== 1 ? 's' : ''}</span>`;

    document.getElementById('filter-q').addEventListener('input', function() {
      const nf = getFilters(); nf.q = this.value.trim(); saveFilters(nf); offset = 0; render();
    });

    bar.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const nf = getFilters();
        const k = chip.dataset.key, v = chip.dataset.val;
        nf.tags[k] = nf.tags[k] || [];
        const idx = nf.tags[k].indexOf(v);
        if (idx === -1) nf.tags[k].push(v); else nf.tags[k].splice(idx, 1);
        if (!nf.tags[k].length) delete nf.tags[k];
        saveFilters(nf); offset = 0; render();
      });
    });

    bar.querySelectorAll('.logic-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nf = getFilters(); nf.logic = btn.dataset.logic; saveFilters(nf); offset = 0; render();
      });
    });
  }

  // ── Rules table ───────────────────────────────────────────────────
  function renderMain(f, filtered) {
    const main = document.getElementById('rules-main');

    if (offset > 0 && offset >= filtered.length) offset = Math.max(0, filtered.length - LIMIT);
    const pageRows = filtered.slice(offset, offset + LIMIT);

    const bulkHTML = selected.size > 0 ? `
      <div class="bulk-bar">
        <span class="bulk-bar-count"><strong>${selected.size}</strong> of ${filtered.length} selected</span>
        ${isAdmin ? `<button id="bulk-add"    class="btn btn-ghost btn-sm">Add tag</button>` : ''}
        ${isAdmin ? `<button id="bulk-remove" class="btn btn-ghost btn-sm">Remove tag</button>` : ''}
        ${isAdmin ? `<button id="bulk-move"   class="btn btn-ghost btn-sm">Move to group</button>` : ''}
        <button id="bulk-enable"  class="btn btn-ghost btn-sm">Enable all</button>
        <button id="bulk-disable" class="btn btn-ghost btn-sm">Disable all</button>
        ${filtered.length > pageRows.length ? `<button id="bulk-select-all-filtered" class="btn btn-ghost btn-sm">Select all ${filtered.length} filtered</button>` : ''}
        <button id="bulk-clear"   class="btn btn-ghost btn-sm">Clear</button>
      </div>` : '';

    if (!filtered.length) {
      main.innerHTML = `${bulkHTML}<div class="card"><div class="empty-state"><h3>No rules found</h3><p>Adjust the filters or create a new rule.</p></div></div>`;
      attachBulkEvents(f, filtered);
      return;
    }

    main.innerHTML = `
      ${bulkHTML}
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table id="rules-table">
            <thead><tr>
              <th style="width:32px"><input type="checkbox" id="sel-all" title="Select all on this page"></th>
              <th style="width:44px">On</th>
              ${sortTh('name', 'Name')}
              ${sortTh('source', 'Source')}
              ${sortTh('action', 'Action')}
              ${sortTh('schedule', 'Schedule')}
              ${sortTh('lastRun', 'Last Run')}
              ${sortTh('lastResult', 'Last Result')}
              <th>Tags</th>
              <th></th>
            </tr></thead>
            <tbody id="rules-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="history-pagination">
        <button id="rules-prev" class="btn btn-ghost btn-sm" ${offset === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="text-muted text-sm">${filtered.length === 0 ? '0' : `${offset + 1}–${Math.min(offset + LIMIT, filtered.length)}`} of ${filtered.length}</span>
        <button id="rules-next" class="btn btn-ghost btn-sm" ${offset + LIMIT >= filtered.length ? 'disabled' : ''}>Next →</button>
      </div>`;

    const tbody = document.getElementById('rules-tbody');
    pageRows.forEach(rule => {
      const tr   = document.createElement('tr');
      tr.dataset.ruleId = rule.id;
      const src     = rule.source?.path || rule.source?.remotePath || rule.source?.profileId || '—';
      const act     = rule.action || 'copy';
      const lastJob = allJobs.find(j => j.ruleId === rule.id);

      tr.innerHTML = `
        <td><input type="checkbox" class="rule-cb"${selected.has(rule.id) ? ' checked' : ''}></td>
        <td></td>
        <td><span class="rule-name-link">${esc(rule.name)}</span></td>
        <td class="text-muted" style="max-width:180px;white-space:nowrap">
          <span style="overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:calc(100% - 22px);vertical-align:middle" title="${esc(src)}">${esc(src)}</span>
          ${src !== '—' ? copyBtnHTML(src) : ''}
        </td>
        <td><span class="action-badge action-${esc(act)}">${esc(act)}</span></td>
        <td class="text-muted text-sm" style="white-space:nowrap">${rule.cron && rule.cron !== 'manual'
            ? `<code style="font-size:11px">${esc(rule.cron)}</code>`
            : `<span class="badge badge-muted">manual</span>`}</td>
        <td class="text-muted text-sm" style="white-space:nowrap">${lastJob ? fmtTime(lastJob.startTime) : '—'}</td>
        <td class="text-muted text-sm">${lastJob ? statusBadge(lastJob.status, lastJob.subStatus) : '<span class="text-muted">—</span>'}</td>
        <td>${(rule.tags || []).map(t => tagPill(t)).join(' ')}</td>
        <td><div style="display:flex;gap:4px">
          <button class="btn btn-icon rule-edit-btn"  title="Edit">${ICON.edit}</button>
          <button class="btn btn-icon rule-clone-btn" title="Clone"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M3 13V4a1 1 0 011-1h9"/></svg></button>
          <button class="btn btn-icon text-danger rule-del-btn" title="Delete">${ICON.trash}</button>
        </div></td>`;

      // Toggle cell
      const togCell = tr.cells[1];
      togCell.style.paddingLeft = '0';
      const tog = makeToggle(rule.enabled !== false, async checked => {
        try {
          await API.putJSON(`/api/rules/${rule.id}`, { ...rule, enabled: checked });
          rule.enabled = checked;
        } catch {
          tog.querySelector('input').checked = !checked;
        }
      });
      togCell.appendChild(tog);

      // Checkbox
      tr.querySelector('.rule-cb').addEventListener('change', e => {
        e.target.checked ? selected.add(rule.id) : selected.delete(rule.id);
        renderMain(f, filtered);
      });

      // Name → rule builder
      tr.querySelector('.rule-name-link').addEventListener('click', () => {
        app.editingRuleId = rule.id;
        app.rbReturnView = 'rules';
        app.rbReturnHash = location.hash;
        navigate('rule-builder');
      });

      // Edit button
      tr.querySelector('.rule-edit-btn').addEventListener('click', () => {
        app.editingRuleId = rule.id;
        app.rbReturnView = 'rules';
        app.rbReturnHash = location.hash;
        navigate('rule-builder');
      });

      // Clone button
      tr.querySelector('.rule-clone-btn').addEventListener('click', async () => {
        const clone = JSON.parse(JSON.stringify(rule));
        delete clone.id;
        clone.name    = rule.name + ' - Copy';
        clone.enabled = false;
        try {
          await API.postJSON('/api/rules', clone);
          await loadData();
        } catch (err) {
          alert(err.message);
        }
      });

      // Delete button
      tr.querySelector('.rule-del-btn').addEventListener('click', async () => {
        if (!confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
        try {
          await API.deleteJSON(`/api/rules/${rule.id}`);
          await loadData();
        } catch (err) {
          alert(err.message);
        }
      });

      tbody.appendChild(tr);
    });

    // Select-all checkbox — scoped to the current page only
    const selAll = document.getElementById('sel-all');
    const pageSelectedCount = pageRows.filter(r => selected.has(r.id)).length;
    selAll.indeterminate = pageSelectedCount > 0 && pageSelectedCount < pageRows.length;
    selAll.checked       = pageSelectedCount > 0 && pageSelectedCount === pageRows.length;
    selAll.addEventListener('change', () => {
      pageRows.forEach(r => selAll.checked ? selected.add(r.id) : selected.delete(r.id));
      renderMain(f, filtered);
    });

    document.getElementById('rules-prev')?.addEventListener('click', () => { offset -= LIMIT; renderMain(f, filtered); });
    document.getElementById('rules-next')?.addEventListener('click', () => { offset += LIMIT; renderMain(f, filtered); });

    main.querySelectorAll('.rules-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortField = field; sortDir = 'asc'; }
        render();
      });
    });

    attachBulkEvents(f, filtered);
  }

  // ── Bulk event handlers ───────────────────────────────────────────
  function attachBulkEvents(f, filtered) {
    document.getElementById('bulk-clear')?.addEventListener('click', () => { selected.clear(); renderMain(f, filtered); });

    const bulkToggle = async enabled => {
      await Promise.all([...selected].map(id => {
        const r = allRules.find(x => x.id === id);
        return r ? API.putJSON(`/api/rules/${id}`, { ...r, enabled }) : null;
      }));
      await loadData();
    };
    document.getElementById('bulk-enable') ?.addEventListener('click', () => bulkToggle(true));
    document.getElementById('bulk-disable')?.addEventListener('click', () => bulkToggle(false));
    document.getElementById('bulk-add')    ?.addEventListener('click', () => tagModal('add'));
    document.getElementById('bulk-remove') ?.addEventListener('click', () => tagModal('remove'));
    document.getElementById('bulk-move')   ?.addEventListener('click', () => moveToGroupModal());
    document.getElementById('bulk-select-all-filtered')?.addEventListener('click', () => {
      selected = new Set(filtered.map(r => r.id));
      renderMain(f, filtered);
    });
  }

  // ── Tag modal ─────────────────────────────────────────────────────
  function tagModal(action) {
    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="field">
        <label>Tag key</label>
        <select id="tmod-key">
          ${tagKeys.length
            ? tagKeys.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')
            : '<option value="">— no keys defined in Settings —</option>'}
        </select>
      </div>
      <div class="field">
        <label>Tag value</label>
        <input id="tmod-val" type="text" placeholder="e.g. Production">
      </div>
      <div id="tmod-err" class="alert alert-error hidden"></div>`;

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="tmod-cancel" class="btn btn-ghost">Cancel</button>
      <button id="tmod-apply"  class="btn btn-primary">${action === 'add' ? 'Add tag' : 'Remove tag'}</button>`;

    const { close } = openModal({
      title:  `${action === 'add' ? 'Add' : 'Remove'} Tag — ${selected.size} rule${selected.size !== 1 ? 's' : ''}`,
      body:   bodyEl,
      footer: footEl,
    });

    footEl.querySelector('#tmod-cancel').addEventListener('click', close);
    footEl.querySelector('#tmod-apply').addEventListener('click', async () => {
      const k   = bodyEl.querySelector('#tmod-key').value.trim();
      const v   = bodyEl.querySelector('#tmod-val').value.trim();
      const err = bodyEl.querySelector('#tmod-err');
      if (!k || !v) { err.textContent = 'Key and value are required.'; err.classList.remove('hidden'); return; }
      try {
        await API.postJSON('/api/rules/bulk-tag', { ids: [...selected], tags: [`${k}:${v}`], action });
        selected.clear();
        close();
        await loadData();
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    });
  }

  // ── Move to group modal ───────────────────────────────────────────
  function moveToGroupModal() {
    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="field">
        <label>Group</label>
        <select id="mgmod-group">
          <option value="">Ungrouped</option>
          ${allGroups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}
        </select>
      </div>
      <div id="mgmod-err" class="alert alert-error hidden"></div>`;

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="mgmod-cancel" class="btn btn-ghost">Cancel</button>
      <button id="mgmod-apply"  class="btn btn-primary">Move</button>`;

    const { close } = openModal({
      title:  `Move to Group — ${selected.size} rule${selected.size !== 1 ? 's' : ''}`,
      body:   bodyEl,
      footer: footEl,
    });

    footEl.querySelector('#mgmod-cancel').addEventListener('click', close);
    footEl.querySelector('#mgmod-apply').addEventListener('click', async () => {
      const newGroupId = bodyEl.querySelector('#mgmod-group').value || undefined;
      const err        = bodyEl.querySelector('#mgmod-err');
      try {
        await Promise.all([...selected].map(id => {
          const r = allRules.find(x => x.id === id);
          return r ? API.putJSON(`/api/rules/${id}`, { ...r, groupId: newGroupId }) : null;
        }));
        selected.clear();
        close();
        await loadData();
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function tagPill(t) {
    const [k, v] = t.split(':');
    return `<span class="tag"><span class="tag-key">${esc(k)}:</span>${esc(v || '')}</span>`;
  }

  loadData();
};

// ── Profiles ──────────────────────────────────────────────────────────
VIEWS.profiles = function(el) {
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const isAdmin = app.user?.role === 'admin';

  let profiles   = [];
  const testResults = new Map(); // id → { ok, msg }

  // Table view scales to hundreds of profiles far better than the old card
  // grid — search, sort, and 50/page pagination, matching the Rules/History
  // pattern elsewhere in the app.
  let q         = '';
  let sortField = 'name';
  let sortDir   = 'asc';
  let offset    = 0;
  const LIMIT   = 50;

  async function loadData() {
    try {
      const res = await API.get('/api/profiles');
      if (!res) return;
      profiles = await res.json();
      render();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-error">Failed to load profiles: ${esc(err.message)}</div>`;
    }
  }

  function addr(p) {
    return p.type === 'sftp'
      ? `${p.username||''}@${p.host||'—'}:${p.port||22}`
      : (p.path || p.remotePath || '—');
  }

  const SORT_ACCESSORS = {
    name: p => (p.name || '').toLowerCase(),
    type: p => p.type || 'local',
    addr: p => addr(p).toLowerCase(),
  };

  function getFiltered() {
    let out = profiles;
    if (q) {
      const qq = q.toLowerCase();
      out = out.filter(p => (p.name||'').toLowerCase().includes(qq) || addr(p).toLowerCase().includes(qq));
    }
    const get = SORT_ACCESSORS[sortField] || SORT_ACCESSORS.name;
    out = [...out].sort((a, b) => String(get(a)).localeCompare(String(get(b))));
    if (sortDir === 'desc') out.reverse();
    return out;
  }

  function sortTh(field, label) {
    const active = sortField === field;
    const arrow  = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="rules-sort-th${active ? ' active' : ''}" data-sort="${esc(field)}">${esc(label)}${arrow}</th>`;
  }

  function render() {
    const filtered = getFiltered();
    if (offset > 0 && offset >= filtered.length) offset = Math.max(0, filtered.length - LIMIT);
    const pageRows = filtered.slice(offset, offset + LIMIT);

    el.innerHTML = `
      <div class="profiles-header">
        <div style="position:relative;flex-shrink:0">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);display:flex">${ICON.profiles}</span>
          <input id="profiles-q" type="text"
            style="width:220px;padding:7px 12px 7px 32px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px"
            placeholder="Search profiles…" value="${esc(q)}">
        </div>
        <span class="text-muted text-sm" style="margin-right:auto">${filtered.length} of ${profiles.length} profile${profiles.length!==1?'s':''}</span>
        ${isAdmin ? `<button id="add-profile-btn" class="btn btn-primary btn-sm">${ICON.plus} Add Profile</button>` : ''}
      </div>
      ${!filtered.length ? `<div class="card"><div class="empty-state"><h3>No profiles</h3><p>${profiles.length ? 'Adjust your search.' : 'Add a profile to define a connection.'}</p></div></div>` : `
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table id="profiles-table">
            <thead><tr>
              <th style="width:36px"></th>
              ${sortTh('name', 'Name')}
              ${sortTh('type', 'Type')}
              ${sortTh('addr', 'Host / Path')}
              <th>Test</th>
              <th style="width:230px"></th>
            </tr></thead>
            <tbody id="profiles-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="history-pagination">
        <button id="profiles-prev" class="btn btn-ghost btn-sm" ${offset===0?'disabled':''}>← Prev</button>
        <span class="text-muted text-sm">${filtered.length===0?'0':`${offset+1}–${Math.min(offset+LIMIT,filtered.length)}`} of ${filtered.length}</span>
        <button id="profiles-next" class="btn btn-ghost btn-sm" ${offset+LIMIT>=filtered.length?'disabled':''}>Next →</button>
      </div>`}`;

    if (filtered.length) {
      const tbody = document.getElementById('profiles-tbody');
      pageRows.forEach(p => tbody.appendChild(rowEl(p)));
    }

    document.getElementById('profiles-q')?.addEventListener('input', function() {
      q = this.value; offset = 0; render();
    });
    document.getElementById('add-profile-btn')?.addEventListener('click', () => openModal_(null));
    document.getElementById('profiles-prev')?.addEventListener('click', () => { offset -= LIMIT; render(); });
    document.getElementById('profiles-next')?.addEventListener('click', () => { offset += LIMIT; render(); });
    el.querySelectorAll('.rules-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortField = field; sortDir = 'asc'; }
        render();
      });
    });
    el.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => openModal_(profiles.find(p => p.id === b.dataset.edit)));
    });
    el.querySelectorAll('[data-test]').forEach(b => {
      b.addEventListener('click', () => testConn(b.dataset.test));
    });
    el.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => deletePr(b.dataset.del));
    });
    el.querySelectorAll('[data-star]').forEach(b => {
      b.addEventListener('click', () => toggleFavorite(b.dataset.star));
    });
  }

  function rowEl(p) {
    const tr = document.createElement('tr');
    const a  = addr(p);
    const res = testResults.get(p.id);
    tr.innerHTML = `
      <td>
        <button class="btn-star ${p.favorite?'star-on':''}" data-star="${esc(p.id)}"
                title="${p.favorite?'Remove from quick profiles':'Add to quick profiles'}">
          ${p.favorite ? ICON.starFilled : ICON.star}
        </button>
      </td>
      <td style="font-weight:500">${esc(p.name)}</td>
      <td><span class="badge ${p.type==='sftp'?'badge-accent':'badge-muted'}">${esc((p.type||'local').toUpperCase())}</span></td>
      <td class="font-mono text-sm text-muted" style="max-width:340px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;max-width:calc(100% - 22px);vertical-align:middle" title="${esc(a)}">${esc(a)}</span>
        ${copyBtnHTML(a)}
      </td>
      <td class="text-sm">${res ? `<span class="${res.ok?'text-success':'text-danger'}">${res.ok?'✓':'✗'} ${esc(res.msg)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-test="${esc(p.id)}">Test connection</button>
          ${isAdmin ? `<button class="btn btn-icon" data-edit="${esc(p.id)}" title="Edit">${ICON.edit}</button>` : ''}
          ${isAdmin ? `<button class="btn btn-icon text-danger" data-del="${esc(p.id)}" title="Delete">${ICON.trash}</button>` : ''}
        </div>
      </td>`;
    return tr;
  }

  async function toggleFavorite(id) {
    const p = profiles.find(pr => pr.id === id);
    if (!p) return;
    try {
      await API.putJSON(`/api/profiles/${id}`, { ...p, favorite: !p.favorite });
      await loadData();
    } catch { /* silently ignore */ }
  }

  async function testConn(id) {
    const btn = el.querySelector(`[data-test="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
    try {
      const res  = await API.post(`/api/profiles/${id}/test`);
      if (!res) return;
      const data = await res.json();
      testResults.set(id, {
        ok:  data.ok,
        msg: data.ok
          ? (data.files != null ? `${data.files} files listed` : 'Connected')
          : (data.error || 'Failed'),
      });
    } catch (err) {
      testResults.set(id, { ok: false, msg: err.message });
    }
    render();
  }

  async function deletePr(id) {
    if (!confirm('Delete this profile?')) return;
    try {
      const res = await API.del(`/api/profiles/${id}`);
      if (!res) return;
      if (res.status === 409) {
        const d = await res.json();
        alert(`Cannot delete — referenced by:\n${(d.rules||[]).map(r=>r.name).join(', ')}`);
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        alert(d.error || 'Delete failed');
        return;
      }
      await loadData();
    } catch (err) { alert(err.message); }
  }

  async function openModal_(profile) {
    const isNew = !profile;
    const p     = profile || { type: 'smb' };

    // Load SSH keys for the dropdown (needed only for SFTP profiles)
    let sshKeysList = [];
    try {
      const r = await API.getJSON('/api/ssh-keys');
      if (Array.isArray(r)) sshKeysList = r;
    } catch { /* non-fatal — key auth option will show but dropdown is empty */ }

    const sshKeyOptions = sshKeysList.map(k =>
      `<option value="${esc(k.id)}" ${p.sshKeyId===k.id?'selected':''}>${esc(k.name)} (${k.algorithm === 'ed25519' ? 'Ed25519' : `RSA ${k.bits||''}`})</option>`
    ).join('');

    const useKeyAuth = p.authType === 'key';

    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="grid-2">
        <div class="field">
          <label>Name</label>
          <input id="pm-name" type="text" placeholder="e.g. Fileserver-01" value="${esc(p.name||'')}">
        </div>
        <div class="field">
          <label>Type</label>
          <select id="pm-type">
            <option value="smb"   ${p.type==='smb'  ?'selected':''}>SMB / UNC</option>
            <option value="local" ${p.type==='local' ?'selected':''}>Local path</option>
            <option value="sftp"  ${p.type==='sftp'  ?'selected':''}>SFTP</option>
          </select>
        </div>
      </div>
      <div id="pm-smb" ${p.type==='sftp'?'class="hidden"':''}>
        <div class="field">
          <label>Path</label>
          <input id="pm-path" type="text" placeholder="\\\\server\\share\\folder or C:\\data" value="${esc(p.path||'')}">
        </div>
      </div>
      <div id="pm-sftp" ${p.type!=='sftp'?'class="hidden"':''}>
        <div class="grid-2">
          <div class="field"><label>Host</label>
            <input id="pm-host" type="text" placeholder="sftp.example.com" value="${esc(p.host||'')}"></div>
          <div class="field"><label>Port</label>
            <input id="pm-port" type="number" placeholder="22" value="${esc(p.port||22)}"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Username</label>
            <input id="pm-user" type="text" autocomplete="off" value="${esc(p.username||'')}"></div>
        </div>
        <div class="field" style="margin-top:8px">
          <label>Authentication method</label>
          <select id="pm-auth-type">
            <option value="password" ${!useKeyAuth?'selected':''}>Password</option>
            <option value="key"      ${useKeyAuth ?'selected':''}>SSH Key</option>
          </select>
        </div>
        <div id="pm-pass-row" ${useKeyAuth?'style="display:none"':''}>
          <div class="field"><label>Password</label>
            <input id="pm-pass" type="password" autocomplete="new-password"
              placeholder="${p.credentialRef && !useKeyAuth ? '(stored — blank = keep)' : 'Enter password'}"></div>
        </div>
        <div id="pm-key-row" ${!useKeyAuth?'style="display:none"':''}>
          <div class="field">
            <label>SSH Key</label>
            <select id="pm-ssh-key">
              <option value="">— select key —</option>
              ${sshKeyOptions}
            </select>
          </div>
        </div>
        <div class="field"><label>Remote path</label>
          <input id="pm-rpath" type="text" placeholder="/outbound" value="${esc(p.remotePath||'')}"></div>
      </div>
      <div id="pm-err" class="alert alert-error hidden"></div>`;

    bodyEl.querySelector('#pm-type').addEventListener('change', e => {
      const sftp = e.target.value === 'sftp';
      bodyEl.querySelector('#pm-sftp').classList.toggle('hidden', !sftp);
      bodyEl.querySelector('#pm-smb') .classList.toggle('hidden',  sftp);
    });

    bodyEl.querySelector('#pm-auth-type')?.addEventListener('change', e => {
      const keyAuth = e.target.value === 'key';
      bodyEl.querySelector('#pm-pass-row').style.display = keyAuth ? 'none' : '';
      bodyEl.querySelector('#pm-key-row') .style.display = keyAuth ? ''     : 'none';
    });

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="pm-cancel" class="btn btn-ghost">Cancel</button>
      <button id="pm-save"   class="btn btn-primary">${isNew?'Add profile':'Save changes'}</button>`;

    const { close } = openModal({ title: isNew ? 'Add Profile' : `Edit — ${esc(p.name||'')}`, body: bodyEl, footer: footEl });

    footEl.querySelector('#pm-cancel').addEventListener('click', close);
    footEl.querySelector('#pm-save').addEventListener('click', async () => {
      const type  = bodyEl.querySelector('#pm-type').value;
      const name  = bodyEl.querySelector('#pm-name').value.trim();
      const errEl = bodyEl.querySelector('#pm-err');
      const sBtn  = footEl.querySelector('#pm-save');

      if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }

      const payload = { name, type };
      if (type === 'sftp') {
        payload.host       = bodyEl.querySelector('#pm-host') .value.trim();
        payload.port       = +bodyEl.querySelector('#pm-port').value || 22;
        payload.username   = bodyEl.querySelector('#pm-user') .value.trim();
        payload.remotePath = bodyEl.querySelector('#pm-rpath').value.trim();
        const authType     = bodyEl.querySelector('#pm-auth-type').value;
        payload.authType   = authType;
        if (authType === 'key') {
          const sshKeyId = bodyEl.querySelector('#pm-ssh-key').value;
          if (!sshKeyId) { errEl.textContent = 'Select an SSH key.'; errEl.classList.remove('hidden'); return; }
          payload.sshKeyId = sshKeyId;
        } else {
          const pw = bodyEl.querySelector('#pm-pass').value;
          if (pw) payload.password = pw;
        }
        if (!payload.host) { errEl.textContent = 'Host is required for SFTP.'; errEl.classList.remove('hidden'); return; }
      } else {
        payload.path = bodyEl.querySelector('#pm-path').value.trim();
        if (!payload.path) { errEl.textContent = 'Path is required.'; errEl.classList.remove('hidden'); return; }
      }

      errEl.classList.add('hidden');
      sBtn.disabled = true; sBtn.textContent = 'Saving…';
      try {
        if (isNew) await API.postJSON('/api/profiles', payload);
        else       await API.putJSON(`/api/profiles/${p.id}`, payload);
        close(); await loadData();
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        sBtn.disabled = false; sBtn.textContent = isNew ? 'Add profile' : 'Save changes';
      }
    });
  }

  loadData();
};

// ── History ───────────────────────────────────────────────────────────
VIEWS.history = function(el) {
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  let allJobs    = [];
  let offset     = 0;
  const LIMIT    = 50;
  const expanded = new Set();

  const _hp     = getHashParams();
  const _hideIdleDefault = _hp.has('hideIdle')
    ? _hp.get('hideIdle') !== '0'
    : localStorage.getItem('historyHideIdle') !== '0';
  const filters = { ruleId: _hp.get('ruleId') || '', ruleName: _hp.get('ruleName') || '', status: _hp.get('status') || '', q: '', hideIdle: _hideIdleDefault };

  function syncUrl() {
    const p = new URLSearchParams();
    if (filters.ruleId)    p.set('ruleId',   filters.ruleId);
    if (filters.ruleName)  p.set('ruleName', filters.ruleName);
    if (filters.status)    p.set('status',   filters.status);
    if (!filters.hideIdle) p.set('hideIdle', '0');
    setHashParams(p);
  }

  async function loadAll() {
    offset = 0;
    const params = new URLSearchParams({ limit: 10000, offset: 0 });
    if (filters.ruleId)  params.set('ruleId',  filters.ruleId);
    if (filters.status)  params.set('status',  filters.status);

    try {
      const res = await API.get('/api/jobs?' + params);
      if (!res) return;
      const d = await res.json();
      allJobs = d.jobs || [];
      render();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-error">Failed to load history: ${esc(err.message)}</div>`;
    }
  }

  function render() {
    let rows = allJobs;
    if (filters.hideIdle) rows = rows.filter(j => j.subStatus !== 'idle');
    if (filters.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter(j => (j.ruleName||j.ruleId||'').toLowerCase().includes(q));
    }
    const filteredTotal = rows.length;
    if (offset > 0 && offset >= filteredTotal) offset = Math.max(0, filteredTotal - LIMIT);
    const pageRows = rows.slice(offset, offset + LIMIT);

    el.innerHTML = `
      <div class="history-filter-bar">
        ${filters.ruleId ? `<span class="hist-rule-chip">${esc(filters.ruleName||filters.ruleId)}<button id="hist-clear-rule" class="hist-chip-x" title="Clear rule filter">×</button></span>` : ''}
        <input id="hist-q" type="text" placeholder="Search rule name…"
               style="width:200px;padding:7px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px"
               value="${esc(filters.q)}">
        <select id="hist-status" style="padding:7px 28px 7px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
          <option value="">All statuses</option>
          <option value="success" ${filters.status==='success'?'selected':''}>Success</option>
          <option value="failed"  ${filters.status==='failed' ?'selected':''}>Failed</option>
          <option value="partial" ${filters.status==='partial'?'selected':''}>Partial</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text);cursor:pointer;user-select:none;white-space:nowrap">
          <input id="hist-hide-idle" type="checkbox" ${filters.hideIdle ? 'checked' : ''}>
          Hide Idle
        </label>
        <span class="text-muted text-sm" style="margin-left:4px">${filteredTotal} total job${filteredTotal!==1?'s':''}</span>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th></th>
              <th>Rule</th>
              <th>Status</th>
              <th>Start time</th>
              <th>Duration</th>
              <th>Files</th>
              <th>Size</th>
            </tr></thead>
            <tbody id="hist-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="history-pagination">
        <button id="hist-prev" class="btn btn-ghost btn-sm" ${offset===0?'disabled':''}>← Prev</button>
        <span class="text-muted text-sm">${filteredTotal===0?'0':`${offset+1}–${Math.min(offset+LIMIT,filteredTotal)}`} of ${filteredTotal}</span>
        <button id="hist-next" class="btn btn-ghost btn-sm" ${offset+LIMIT>=filteredTotal?'disabled':''}>Next →</button>
      </div>`;

    const tbody = document.getElementById('hist-tbody');
    pageRows.forEach(job => {
      const dur = job.startTime && job.endTime
        ? new Date(job.endTime) - new Date(job.startTime) : null;
      const isExp = expanded.has(job.id);

      const tr = document.createElement('tr');
      tr.className = 'hist-row';
      tr.innerHTML = `
        <td style="width:28px;cursor:pointer" class="hist-expand">${isExp ? ICON.chevron : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 4l4 3-4 3"/></svg>'}</td>
        <td class="job-rule-name">${job.ruleId
            ? `<span class="rule-name-link" title="Open this rule">${esc(job.ruleName||job.ruleId)}</span>`
            : esc(job.ruleName||'—')}</td>
        <td>${statusBadge(job.status, job.subStatus)}</td>
        <td class="text-muted">${fmtTime(job.startTime)}</td>
        <td class="text-muted">${fmtDuration(dur)}</td>
        <td>${job.filesTransferred??'—'}</td>
        <td class="text-muted">${fmtBytes(job.bytesTransferred)}</td>`;

      tr.querySelector('.hist-expand').addEventListener('click', () => {
        if (isExp) expanded.delete(job.id); else expanded.add(job.id);
        render();
      });
      tr.querySelector('.rule-name-link')?.addEventListener('click', () => {
        app.editingRuleId = job.ruleId;
        app.rbReturnView  = 'history';
        app.rbReturnHash  = location.hash;
        navigate('rule-builder');
      });
      tbody.appendChild(tr);

      if (isExp) {
        const detail = document.createElement('tr');
        detail.className = 'hist-detail-row';
        detail.innerHTML = `<td colspan="7"><div class="hist-detail">${jobDetailHTML(job)}</div></td>`;
        tbody.appendChild(detail);
      }
    });

    if (!rows.length) {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="7"><div class="empty-state"><p>No jobs match the current filters.</p></div></td>';
      tbody.appendChild(empty);
    }

    document.getElementById('hist-q')?.addEventListener('input', function() {
      filters.q = this.value; offset = 0; render();
    });
    document.getElementById('hist-status')?.addEventListener('change', function() {
      filters.status = this.value; syncUrl(); loadAll();
    });
    document.getElementById('hist-hide-idle')?.addEventListener('change', function() {
      filters.hideIdle = this.checked;
      localStorage.setItem('historyHideIdle', this.checked ? '1' : '0');
      offset = 0; syncUrl(); render();
    });
    document.getElementById('hist-clear-rule')?.addEventListener('click', () => {
      filters.ruleId = ''; filters.ruleName = ''; syncUrl(); loadAll();
    });
    document.getElementById('hist-prev')?.addEventListener('click', () => { offset -= LIMIT; render(); });
    document.getElementById('hist-next')?.addEventListener('click', () => { offset += LIMIT; render(); });
  }

  function jobDetailHTML(job) {
    const files = job.fileDetails || job.files || [];
    if (!files.length) {
      return `<div class="hist-detail-meta">
        ${job.errors?.length ? `<div class="text-danger text-sm">${job.errors.map(e=>esc(e)).join('<br>')}</div>` : '<span class="text-muted text-sm">No per-file details recorded.</span>'}
      </div>`;
    }
    const pathCellStyle = 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    return `
      <table class="hist-files-table">
        <thead><tr><th>File</th><th>Source</th><th>Status</th><th>Size</th><th>Destinations</th><th>Time</th></tr></thead>
        <tbody>${files.map(f=>{
          const sourceText = f.sourcePath || (Array.isArray(f.sourceFiles) ? f.sourceFiles.join(', ') : '') || '';
          const dests = f.destinations || [];
          const destsHTML = dests.length
            ? dests.map(d => {
                const dPath = d.path || d.profileId || '';
                return `
                <div style="margin-bottom:4px">
                  <span class="font-mono text-sm" style="${pathCellStyle};display:inline-block;max-width:160px;vertical-align:middle" title="${esc(dPath)}">${esc(dPath) || '—'}</span>
                  ${dPath ? copyBtnHTML(dPath) : ''}
                  ${statusBadge(d.status||'ok')}
                  ${d.status === 'error' && d.error ? `<div class="text-danger text-sm">${esc(d.error)}</div>` : ''}
                </div>`;
              }).join('')
            : '<span class="text-muted">—</span>';
          return `
          <tr>
            <td class="font-mono text-sm">${esc(f.name||f.src||'')}</td>
            <td class="font-mono text-sm" style="${pathCellStyle}">
              <span style="overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:calc(100% - 22px);vertical-align:middle" title="${esc(sourceText)}">${esc(sourceText) || '—'}</span>
              ${sourceText ? copyBtnHTML(sourceText) : ''}
            </td>
            <td>${statusBadge(f.status||'success')}</td>
            <td class="text-muted text-sm">${fmtBytes(f.size||f.bytes)}</td>
            <td>${destsHTML}</td>
            <td class="text-muted text-sm">${f.timestamp ? fmtTime(f.timestamp) : '—'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  }

  loadAll();
};

// ── Logs ──────────────────────────────────────────────────────────────
VIEWS.logs = function(el) {
  let filterVal = getHashParams().get('filter') || '';

  el.innerHTML = `
    <div class="logs-header">
      <div style="display:flex;align-items:center;gap:10px">
        <input id="log-filter" type="text" placeholder="Filter lines…" value="${esc(filterVal)}"
               style="width:180px;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
        <span class="text-muted text-sm">Auto-refreshes every 5 s</span>
        <span id="log-count" class="text-muted text-sm"></span>
      </div>
      <div style="display:flex;gap:8px">
        <button id="log-pause" class="btn btn-ghost btn-sm">Pause</button>
        <button id="log-bottom" class="btn btn-ghost btn-sm">↓ Bottom</button>
      </div>
    </div>
    <div class="card" style="padding:0">
      <pre id="log-pre" class="log-pre"><span class="text-muted">Loading…</span></pre>
    </div>`;

  let paused = false;
  let lines  = 200;

  async function refresh() {
    if (paused) return;
    try {
      const res = await API.get(`/api/logs?lines=${lines}`);
      if (!res) return;
      const d = await res.json();
      const pre = document.getElementById('log-pre');
      if (!pre) return;

      const logLines = d.lines || [];
      const cnt = document.getElementById('log-count');
      if (cnt) cnt.textContent = `${logLines.length} of ${d.total} lines`;

      const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
      const fv = filterVal.toLowerCase();
      pre.innerHTML = logLines.map(l => {
        const cls = logLineClass(l);
        if (fv && l.toLowerCase().includes(fv)) return `<span class="${cls} log-highlight">${esc(l)}</span>`;
        if (fv)                                  return `<span class="${cls} log-dim">${esc(l)}</span>`;
        return `<span class="${cls}">${esc(l)}</span>`;
      }).join('\n');
      if (atBottom) pre.scrollTop = pre.scrollHeight;
    } catch { /* network blip */ }
  }

  function logLineClass(line) {
    if (/\[ERROR\]|\[error\]/i.test(line))  return 'log-error';
    if (/\[WARN\]|\[warn\]/i.test(line))    return 'log-warn';
    if (/\[INFO\]|\[info\]/i.test(line))    return 'log-info';
    return 'log-default';
  }

  document.getElementById('log-filter')?.addEventListener('input', function() {
    filterVal = this.value;
    const p = new URLSearchParams();
    if (filterVal) p.set('filter', filterVal);
    setHashParams(p);
    refresh();
  });

  document.getElementById('log-pause')?.addEventListener('click', function() {
    paused = !paused;
    this.textContent = paused ? 'Resume' : 'Pause';
    this.classList.toggle('btn-primary', paused);
    this.classList.toggle('btn-ghost',   !paused);
  });

  document.getElementById('log-bottom')?.addEventListener('click', () => {
    const pre = document.getElementById('log-pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
  });

  refresh();
  const timer = setInterval(refresh, 5_000);
  return () => clearInterval(timer);
};

// ── Settings ──────────────────────────────────────────────────────────
VIEWS.settings = function(el) {
  const isAdmin = app.user?.role === 'admin';

  // Tabs — one per settings-section, admin-gated the same way the sections
  // themselves were. Replaces the old single long-scroll layout.
  const TABS = [
    ...(isAdmin ? [{ id: 'users',   label: 'Users' }] : []),
    { id: 'tags', label: 'Tag Keys' },
    ...(isAdmin ? [{ id: 'session', label: 'Session & Retention' }] : []),
    ...(isAdmin ? [{ id: 'pgp',     label: 'PGP Keys' }] : []),
    ...(isAdmin ? [{ id: 'ssh',     label: 'SSH Keys' }] : []),
    { id: 'password', label: 'Password' },
  ];
  const requestedTab = getHashParams().get('tab');
  let activeTab = TABS.some(t => t.id === requestedTab) ? requestedTab : TABS[0].id;

  function setActiveTab(id) {
    activeTab = id;
    const p = new URLSearchParams();
    p.set('tab', id);
    setHashParams(p);
    el.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    // Sections start with an inline style="display:none" (see initial render
    // above) for the ones that weren't the active tab — a class toggle alone
    // can't override an inline style, so set .style.display directly here.
    el.querySelectorAll('.settings-section[data-tab]').forEach(s => { s.style.display = s.dataset.tab === id ? '' : 'none'; });
  }

  el.innerHTML = `
    <div class="settings-layout">
      <div class="settings-tabs">
        ${TABS.map(t => `<button class="settings-tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>

      ${isAdmin ? `
      <!-- ── Users ─────────────────────────────── -->
      <section class="card settings-section" data-tab="users"${activeTab !== 'users' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">Users</h2>
          <button id="add-user-btn" class="btn btn-primary btn-sm">${ICON.plus} Add user</button>
        </div>
        <div id="users-list"><div class="loading-center"><div class="spinner"></div></div></div>
      </section>
      ` : ''}

      <!-- ── Tag Keys ──────────────────────────── -->
      <section class="card settings-section" data-tab="tags"${activeTab !== 'tags' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">Tag Keys</h2>
          ${isAdmin ? `<button id="add-key-btn" class="btn btn-primary btn-sm">${ICON.plus} Add key</button>` : ''}
        </div>
        <p class="text-muted text-sm" style="margin-bottom:12px">Predefined key prefixes for the <code>Key:Value</code> tag format. Values are always freeform.</p>
        <div id="tag-keys-list"><div class="loading-center"><div class="spinner"></div></div></div>
      </section>

      <!-- ── Session & Retention ───────────────── -->
      ${isAdmin ? `
      <section class="card settings-section" data-tab="session"${activeTab !== 'session' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">Session &amp; Retention</h2>
        </div>
        <div id="settings-form-wrap"><div class="loading-center"><div class="spinner"></div></div></div>
      </section>
      ` : ''}

      <!-- ── PGP Key Manager ──────────────────── -->
      ${isAdmin ? `
      <section class="card settings-section" data-tab="pgp"${activeTab !== 'pgp' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">PGP Keys</h2>
          <div style="display:flex;gap:8px">
            <button id="pgp-import-btn" class="btn btn-ghost btn-sm">${ICON.plus} Import key</button>
            <button id="pgp-gen-btn"    class="btn btn-primary btn-sm">${ICON.plus} Generate keypair</button>
          </div>
        </div>
        <div id="pgp-keys-list"><div class="loading-center"><div class="spinner"></div></div></div>
      </section>
      ` : ''}

      <!-- ── SSH Key Manager ────────────────────── -->
      ${isAdmin ? `
      <section class="card settings-section" data-tab="ssh"${activeTab !== 'ssh' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">SSH Keys</h2>
          <div style="display:flex;gap:8px">
            <button id="ssh-import-btn" class="btn btn-ghost btn-sm">${ICON.plus} Import key</button>
            <button id="ssh-gen-btn"    class="btn btn-primary btn-sm">${ICON.plus} Generate keypair</button>
          </div>
        </div>
        <div id="ssh-keys-list"><div class="loading-center"><div class="spinner"></div></div></div>
      </section>
      ` : ''}

      <!-- ── Change own password ───────────────── -->
      <section class="card settings-section" data-tab="password"${activeTab !== 'password' ? ' style="display:none"' : ''}>
        <div class="settings-section-hd">
          <h2 class="settings-section-title">Change Password</h2>
        </div>
        <div id="pw-change-wrap">
          <div class="settings-form-row">
            <div class="field" style="max-width:320px">
              <label>Current password</label>
              <input id="pw-current" type="password" autocomplete="current-password">
            </div>
          </div>
          <div class="settings-form-row">
            <div class="field" style="max-width:320px">
              <label>New password</label>
              <input id="pw-new" type="password" autocomplete="new-password" placeholder="Min 8 characters">
            </div>
            <div class="field" style="max-width:320px">
              <label>Confirm new password</label>
              <input id="pw-confirm" type="password" autocomplete="new-password">
            </div>
          </div>
          <div id="pw-err" class="alert alert-error hidden" style="max-width:640px;margin-bottom:8px"></div>
          <div id="pw-ok"  class="alert alert-success hidden" style="max-width:640px;margin-bottom:8px"></div>
          <button id="pw-save-btn" class="btn btn-primary btn-sm">Save password</button>
        </div>
      </section>

    </div>`;

  el.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  // ── Load data ──────────────────────────────────────────────────────
  const promises = [API.get('/api/tags/keys')];
  if (isAdmin) {
    promises.push(API.get('/api/auth/users'));
    promises.push(API.get('/api/settings'));
    promises.push(API.get('/api/pgp'));
    promises.push(API.get('/api/ssh-keys'));
  }

  Promise.all(promises).then(async results => {
    if (results.some(r => !r)) return;
    const tagKeys      = await results[0].json();
    const users        = isAdmin ? await results[1].json()    : null;
    const settings     = isAdmin ? await results[2].json()    : null;
    const pgpKeysList  = isAdmin ? await results[3].json()    : null;
    const sshKeysList  = isAdmin ? await results[4].json()    : null;

    if (isAdmin) renderUsers(users);
    renderTagKeys(tagKeys);
    if (isAdmin) renderSettingsForm(settings);
    if (isAdmin) renderPgpKeys(pgpKeysList);
    if (isAdmin) renderSshKeys(sshKeysList);
  });

  // ── Users table ────────────────────────────────────────────────────
  function renderUsers(users) {
    const wrap = document.getElementById('users-list');
    if (!wrap) return;
    if (!users.length) {
      wrap.innerHTML = '<p class="text-muted text-sm">No users found.</p>';
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead>
          <tbody>${users.map(u => `
            <tr>
              <td><strong>${esc(u.username)}</strong></td>
              <td>${u.role === 'admin'
                ? '<span class="badge badge-accent">Admin</span>'
                : '<span class="badge badge-muted">User</span>'}</td>
              <td class="text-muted text-sm">${fmtTime(u.createdAt)}</td>
              <td class="table-actions">
                <button class="btn btn-ghost btn-xs" data-edit-user="${esc(u.id)}" data-uname="${esc(u.username)}" data-urole="${esc(u.role)}">${ICON.edit}</button>
                ${u.id !== app.user.id
                  ? `<button class="btn btn-ghost btn-xs text-danger" data-del-user="${esc(u.id)}">${ICON.trash}</button>`
                  : '<span style="width:28px;display:inline-block"></span>'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    wrap.querySelectorAll('[data-edit-user]').forEach(btn => {
      btn.addEventListener('click', () => openUserModal(btn.dataset.editUser, btn.dataset.uname, btn.dataset.urole));
    });
    wrap.querySelectorAll('[data-del-user]').forEach(btn => {
      btn.addEventListener('click', () => deleteUser(btn.dataset.delUser));
    });
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    try {
      const r = await fetch('/api/auth/users/' + id, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Delete failed'); return; }
      const users = await (await API.get('/api/auth/users')).json();
      renderUsers(users);
    } catch (err) { alert(err.message); }
  }

  function openUserModal(id, username, role) {
    const isNew = !id;
    const { el: overlay, close } = openModal({
      title: isNew ? 'Add user' : `Edit: ${username}`,
      body: `
        ${isNew ? `
        <div class="field">
          <label>Username</label>
          <input id="um-username" type="text" autocomplete="off" spellcheck="false">
        </div>` : ''}
        ${isNew || !isNew ? `
        <div class="field">
          <label>${isNew ? 'Password' : 'New password'}</label>
          <input id="um-password" type="password" autocomplete="new-password"
                 placeholder="${isNew ? 'Min 8 characters' : 'Leave blank to keep current'}">
        </div>` : ''}
        <div class="field">
          <label>Role</label>
          <select id="um-role">
            <option value="user"  ${role==='user' ?'selected':''}>User</option>
            <option value="admin" ${role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
        <div id="um-err" class="alert alert-error hidden" style="margin-top:8px"></div>`,
      footer: `<button id="um-save" class="btn btn-primary">Save</button>`,
    });

    overlay.querySelector('#um-save').addEventListener('click', async () => {
      const pw   = overlay.querySelector('#um-password')?.value || '';
      const rl   = overlay.querySelector('#um-role')?.value;
      const errEl = overlay.querySelector('#um-err');
      errEl.classList.add('hidden');

      try {
        if (isNew) {
          const uname = overlay.querySelector('#um-username')?.value.trim();
          if (!uname) { errEl.textContent = 'Username is required'; errEl.classList.remove('hidden'); return; }
          if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.remove('hidden'); return; }
          const r = await fetch('/api/auth/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: uname, password: pw, role: rl }),
          });
          const d = await r.json();
          if (!r.ok) { errEl.textContent = d.error || 'Failed'; errEl.classList.remove('hidden'); return; }
        } else {
          const body = { role: rl };
          if (pw) {
            if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.remove('hidden'); return; }
            body.password = pw;
          }
          const r = await fetch('/api/auth/users/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const d = await r.json();
          if (!r.ok) { errEl.textContent = d.error || 'Failed'; errEl.classList.remove('hidden'); return; }
        }
        close();
        const users = await (await API.get('/api/auth/users')).json();
        renderUsers(users);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  document.getElementById('add-user-btn')?.addEventListener('click', () => openUserModal(null, '', 'user'));

  // ── Tag Keys ───────────────────────────────────────────────────────
  function renderTagKeys(keys) {
    const wrap = document.getElementById('tag-keys-list');
    if (!wrap) return;
    if (!keys.length) {
      wrap.innerHTML = `<p class="text-muted text-sm">${isAdmin ? 'No tag keys defined yet.' : 'No tag keys defined.'}</p>`;
      return;
    }
    wrap.innerHTML = `<div class="tag-keys-grid">${keys.map(k => `
      <div class="tag-key-pill">
        <span class="tag-key-label">${esc(k)}</span>
        ${isAdmin ? `<button class="tag-key-del" data-key="${esc(k)}" title="Remove key">${ICON.close}</button>` : ''}
      </div>`).join('')}</div>`;

    if (isAdmin) {
      wrap.querySelectorAll('.tag-key-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          if (!confirm(`Remove tag key "${key}"? Existing tags using this key are not deleted.`)) return;
          try {
            const r = await fetch('/api/tags/keys/' + encodeURIComponent(key), { method: 'DELETE' });
            const d = await r.json();
            if (!r.ok) { alert(d.error || 'Delete failed'); return; }
            renderTagKeys(d);
          } catch (err) { alert(err.message); }
        });
      });
    }
  }

  document.getElementById('add-key-btn')?.addEventListener('click', async () => {
    const key = prompt('New tag key name (e.g. "Owner", "Env", "Vendor"):');
    if (!key?.trim()) return;
    try {
      const r = await fetch('/api/tags/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Failed'); return; }
      renderTagKeys(d);
    } catch (err) { alert(err.message); }
  });

  // ── Session & Retention form ───────────────────────────────────────
  function renderSettingsForm(cfg) {
    const wrap = document.getElementById('settings-form-wrap');
    if (!wrap) return;

    // Populate from the runtime's IANA zone database (Node 18+ / all modern
    // browsers) rather than hardcoding a list — always current, no maintenance.
    let allTz = [];
    try { allTz = Intl.supportedValuesOf('timeZone'); } catch { /* very old runtime — falls back to text input below */ }
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentTz = cfg.scheduleTimezone || '';

    wrap.innerHTML = `
      <div class="settings-form-row">
        <div class="field" style="max-width:220px">
          <label>Session timeout (minutes)</label>
          <input id="cfg-timeout" type="number" min="1" max="1440" value="${cfg.sessionTimeoutMinutes ?? 30}">
          <span class="field-hint">1–1440 min. Takes effect on next server restart.</span>
        </div>
        <div class="field" style="max-width:220px">
          <label>Log retention (days)</label>
          <input id="cfg-retention" type="number" min="1" max="365" value="${cfg.logRetentionDays ?? 30}">
          <span class="field-hint">1–365 days. Applied to next log rotation.</span>
        </div>
      </div>
      <div class="settings-form-row">
        <div class="field" style="max-width:340px">
          <label>Schedule timezone</label>
          ${allTz.length ? `
          <select id="cfg-tz">
            <option value="">System default (whatever timezone the server OS is set to)</option>
            ${allTz.map(z => `<option value="${esc(z)}"${z===currentTz?' selected':''}>${esc(z)}</option>`).join('')}
          </select>` : `
          <input id="cfg-tz" type="text" placeholder="e.g. America/New_York" value="${esc(currentTz)}">`}
          <span class="field-hint">
            All rule schedules (cron times) are interpreted in this timezone. If left as system default, "8am" in a rule
            means 8am wherever the server's OS clock is set — not necessarily 8am for you.
            <button type="button" id="cfg-tz-detect" class="btn-link-sm">Use my browser's timezone (${esc(browserTz)})</button>
          </span>
        </div>
      </div>
      <div id="cfg-err" class="alert alert-error hidden" style="max-width:480px;margin-bottom:8px"></div>
      <div id="cfg-ok"  class="alert alert-success hidden" style="max-width:480px;margin-bottom:8px"></div>
      <button id="cfg-save" class="btn btn-primary btn-sm">Save settings</button>`;

    wrap.querySelector('#cfg-tz-detect')?.addEventListener('click', () => {
      const sel = wrap.querySelector('#cfg-tz');
      if (sel) sel.value = browserTz;
    });

    wrap.querySelector('#cfg-save').addEventListener('click', async () => {
      const errEl = wrap.querySelector('#cfg-err');
      const okEl  = wrap.querySelector('#cfg-ok');
      errEl.classList.add('hidden'); okEl.classList.add('hidden');
      const body = {
        sessionTimeoutMinutes: parseInt(wrap.querySelector('#cfg-timeout')?.value, 10),
        logRetentionDays:      parseInt(wrap.querySelector('#cfg-retention')?.value, 10),
        scheduleTimezone:      wrap.querySelector('#cfg-tz')?.value.trim() || null,
      };
      try {
        const r = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) { errEl.textContent = d.error || 'Save failed'; errEl.classList.remove('hidden'); return; }
        okEl.textContent = 'Settings saved.';
        okEl.classList.remove('hidden');
        setTimeout(() => okEl.classList.add('hidden'), 3000);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  // ── PGP Key Manager ────────────────────────────────────────────────
  function renderPgpKeys(keys) {
    const wrap = document.getElementById('pgp-keys-list');
    if (!wrap) return;

    const now     = Date.now();
    const WARN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (!keys.length) {
      wrap.innerHTML = '<p class="text-muted text-sm">No PGP keys stored. Import or generate a keypair to get started.</p>';
    } else {
      wrap.innerHTML = `
        <div class="table-wrap">
          <table class="pgp-keys-table">
            <thead><tr>
              <th>Name</th><th>Type</th><th>Owner</th>
              <th>Fingerprint</th><th>Expires</th><th></th>
            </tr></thead>
            <tbody>${keys.map(k => {
              const expMs   = k.expiresAt ? new Date(k.expiresAt).getTime() : null;
              const expired = expMs && expMs < now;
              const expiring = expMs && !expired && (expMs - now) < WARN_MS;
              const expLabel = k.expiresAt
                ? `<span class="${expired ? 'text-danger' : expiring ? 'text-warn' : 'text-muted'} text-sm">${expired ? '⚠ Expired' : expiring ? '⚠ ' : ''}${fmtTime(k.expiresAt)}</span>`
                : '<span class="text-muted text-sm">—</span>';
              return `<tr class="${expiring ? 'pgp-row-warn' : expired ? 'pgp-row-expired' : ''}">
                <td>
                  <strong>${esc(k.name)}</strong>
                  ${k.legacyConverted ? '<div class="text-muted text-sm" style="margin-top:3px">Key was converted from legacy format on import</div>' : ''}
                </td>
                <td><span class="badge ${k.type==='private'?'badge-accent':'badge-muted'}">${k.type}</span></td>
                <td class="text-muted text-sm">${esc(k.owner||'—')}</td>
                <td><code class="fp-truncate" title="${esc(k.fingerprint)}">${esc(k.fingerprint.slice(0,16))}…</code></td>
                <td>${expLabel}</td>
                <td class="table-actions">
                  <button class="btn btn-ghost btn-xs" data-pgp-export="${esc(k.id)}" title="Export public key">Export</button>
                  <button class="btn btn-ghost btn-xs" data-pgp-test="${esc(k.id)}" title="Test key" style="${k.type!=='private'?'display:none':''}">Test</button>
                  <button class="btn btn-ghost btn-xs text-danger" data-pgp-del="${esc(k.id)}" title="Delete">${ICON.trash}</button>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    wrap.querySelectorAll('[data-pgp-export]').forEach(btn =>
      btn.addEventListener('click', () => exportPgpKey(btn.dataset.pgpExport)));
    wrap.querySelectorAll('[data-pgp-test]').forEach(btn =>
      btn.addEventListener('click', () => testPgpKey(btn.dataset.pgpTest)));
    wrap.querySelectorAll('[data-pgp-del]').forEach(btn =>
      btn.addEventListener('click', () => deletePgpKey(btn.dataset.pgpDel, keys)));
  }

  async function exportPgpKey(id) {
    try {
      const r = await API.getJSON(`/api/pgp/${id}/export`);
      if (!r) return;
      const { el: overlay } = openModal({
        title:  'Export Public Key',
        body:   `<textarea id="pgp-export-text" style="width:100%;height:280px;font-family:monospace;font-size:12px;resize:vertical" readonly>${esc(r.armoredKey)}</textarea>
                 <p class="text-muted text-sm" style="margin-top:8px">This is the public key only — safe to share.</p>`,
        footer: `<button id="pgp-copy-btn" class="btn btn-primary">Copy to clipboard</button>`,
      });
      overlay.querySelector('#pgp-copy-btn')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(r.armoredKey).catch(() => {});
        overlay.querySelector('#pgp-copy-btn').textContent = 'Copied!';
      });
    } catch (err) { alert(`Export failed: ${err.message}`); }
  }

  async function testPgpKey(id) {
    const btn = document.querySelector(`[data-pgp-test="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
    try {
      const r = await API.postJSON('/api/pgp/test', { privateKeyId: id });
      alert(r?.ok ? '✓ Test passed: roundtrip encrypt/decrypt succeeded.' : `✗ Test failed: ${r?.error || r?.message || 'Unknown error'}`);
    } catch (err) { alert(`Test error: ${err.message}`); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Test'; } }
  }

  async function deletePgpKey(id, keys) {
    const k = keys.find(x => x.id === id);
    if (!confirm(`Delete key "${k?.name || id}"?\n\nThis cannot be undone.`)) return;
    try {
      await API.deleteJSON(`/api/pgp/${id}`);
      const fresh = await API.getJSON('/api/pgp');
      if (fresh) renderPgpKeys(fresh);
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }

  document.getElementById('pgp-import-btn')?.addEventListener('click', () => {
    const bd = document.createElement('div');
    bd.innerHTML = `
      <div class="field">
        <label>Armored key (public or private)</label>
        <textarea id="pgp-imp-key" style="width:100%;height:220px;font-family:monospace;font-size:12px;resize:vertical" placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----\n…"></textarea>
      </div>
      <div class="field">
        <label>Passphrase <span class="text-muted" style="font-weight:400">(private keys only, leave blank if none)</span></label>
        <input id="pgp-imp-pass" type="password" autocomplete="new-password">
      </div>
      <div id="pgp-imp-err" class="alert alert-error hidden"></div>`;
    const ft = document.createElement('div');
    ft.innerHTML = `<button id="pgp-imp-cancel" class="btn btn-ghost">Cancel</button>
                    <button id="pgp-imp-save" class="btn btn-primary">Import</button>`;
    const { close } = openModal({ title: 'Import PGP Key', body: bd, footer: ft });
    ft.querySelector('#pgp-imp-cancel').addEventListener('click', close);
    ft.querySelector('#pgp-imp-save').addEventListener('click', async () => {
      const armoredKey = bd.querySelector('#pgp-imp-key').value.trim();
      const passphrase = bd.querySelector('#pgp-imp-pass').value;
      const errEl      = bd.querySelector('#pgp-imp-err');
      if (!armoredKey) { errEl.textContent = 'Paste an armored key first.'; errEl.classList.remove('hidden'); return; }
      try {
        ft.querySelector('#pgp-imp-save').disabled = true;
        ft.querySelector('#pgp-imp-save').textContent = 'Importing…';
        const result = await API.postJSON('/api/pgp/import', { armoredKey, passphrase: passphrase || undefined });
        if (result?.requiresPassphrase) {
          errEl.textContent = 'This is a legacy key — enter its passphrase so it can be converted to a modern format.';
          errEl.classList.remove('hidden');
          bd.querySelector('#pgp-imp-pass').focus();
          ft.querySelector('#pgp-imp-save').disabled = false;
          ft.querySelector('#pgp-imp-save').textContent = 'Import';
          return;
        }
        close();
        const fresh = await API.getJSON('/api/pgp');
        if (fresh) renderPgpKeys(fresh);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        ft.querySelector('#pgp-imp-save').disabled = false;
        ft.querySelector('#pgp-imp-save').textContent = 'Import';
      }
    });
  });

  document.getElementById('pgp-gen-btn')?.addEventListener('click', () => {
    const bd = document.createElement('div');
    bd.innerHTML = `
      <div class="grid-2">
        <div class="field">
          <label>Name</label>
          <input id="pgp-gen-name" type="text" placeholder="Alice Smith">
        </div>
        <div class="field">
          <label>Email</label>
          <input id="pgp-gen-email" type="email" placeholder="alice@example.com">
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Passphrase <span class="text-muted" style="font-weight:400">(optional)</span></label>
          <input id="pgp-gen-pass" type="password" autocomplete="new-password">
        </div>
        <div class="field">
          <label>Key size</label>
          <select id="pgp-gen-bits">
            <option value="4096">4096 bits (recommended)</option>
            <option value="2048">2048 bits</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Expiration</label>
          <select id="pgp-gen-expiry">
            <option value="0">Never</option>
            <option value="365">1 year</option>
            <option value="730">2 years</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div class="field" id="pgp-gen-expiry-custom-wrap" style="display:none">
          <label>Days until expiration</label>
          <input id="pgp-gen-expiry-custom" type="number" min="1" step="1" placeholder="e.g. 180">
        </div>
      </div>
      <div id="pgp-gen-err" class="alert alert-error hidden"></div>
      <div id="pgp-gen-ok"  class="alert alert-success hidden"></div>`;
    const ft = document.createElement('div');
    ft.innerHTML = `<button id="pgp-gen-cancel" class="btn btn-ghost">Cancel</button>
                    <button id="pgp-gen-save" class="btn btn-primary">Generate</button>`;
    const { close } = openModal({ title: 'Generate PGP Keypair', body: bd, footer: ft });
    ft.querySelector('#pgp-gen-cancel').addEventListener('click', close);
    const expirySel        = bd.querySelector('#pgp-gen-expiry');
    const expiryCustomWrap = bd.querySelector('#pgp-gen-expiry-custom-wrap');
    expirySel.addEventListener('change', () => {
      expiryCustomWrap.style.display = expirySel.value === 'custom' ? '' : 'none';
    });
    ft.querySelector('#pgp-gen-save').addEventListener('click', async () => {
      const name  = bd.querySelector('#pgp-gen-name').value.trim();
      const email = bd.querySelector('#pgp-gen-email').value.trim();
      const pass  = bd.querySelector('#pgp-gen-pass').value;
      const bits  = bd.querySelector('#pgp-gen-bits').value;
      const errEl = bd.querySelector('#pgp-gen-err');
      const okEl  = bd.querySelector('#pgp-gen-ok');
      if (!name || !email) { errEl.textContent = 'Name and email are required.'; errEl.classList.remove('hidden'); return; }
      let expiresInDays;
      if (expirySel.value === 'custom') {
        const customDays = +bd.querySelector('#pgp-gen-expiry-custom').value;
        if (!Number.isInteger(customDays) || customDays < 1) {
          errEl.textContent = 'Enter a valid number of days for the custom expiration.';
          errEl.classList.remove('hidden');
          return;
        }
        expiresInDays = customDays;
      } else {
        expiresInDays = +expirySel.value || undefined;
      }
      errEl.classList.add('hidden');
      const saveBtn = ft.querySelector('#pgp-gen-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Generating…';
      try {
        const r = await API.postJSON('/api/pgp/generate', { name, email, passphrase: pass || undefined, bits: +bits, expiresInDays });
        okEl.textContent = `Keypair generated — fingerprint: ${r.fingerprint}`;
        okEl.classList.remove('hidden');
        saveBtn.textContent = 'Done';
        const fresh = await API.getJSON('/api/pgp');
        if (fresh) renderPgpKeys(fresh);
        setTimeout(close, 2000);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        saveBtn.disabled = false; saveBtn.textContent = 'Generate';
      }
    });
  });

  // ── SSH Key Manager ────────────────────────────────────────────────
  function renderSshKeys(keys) {
    const wrap = document.getElementById('ssh-keys-list');
    if (!wrap) return;

    if (!keys.length) {
      wrap.innerHTML = '<p class="text-muted text-sm">No SSH keys stored. Import a key or generate a keypair to get started.</p>';
    } else {
      wrap.innerHTML = `
        <div class="table-wrap">
          <table class="pgp-keys-table">
            <thead><tr>
              <th>Name</th><th>Algorithm</th><th>Fingerprint</th><th>Created</th><th></th>
            </tr></thead>
            <tbody>${keys.map(k => {
              let algLabel, algBadge;
              if (k.algorithm === 'ed25519') {
                algLabel = 'Ed25519'; algBadge = 'badge-accent';
              } else {
                algLabel = k.bits ? `RSA ${k.bits}` : 'RSA'; algBadge = 'badge-muted';
              }
              return `<tr>
                <td><strong>${esc(k.name)}</strong></td>
                <td><span class="badge ${algBadge}">${algLabel}</span></td>
                <td><code class="fp-truncate" title="${esc(k.fingerprint)}">${esc(k.fingerprint)}</code></td>
                <td class="text-muted text-sm">${fmtTime(k.createdAt)}</td>
                <td class="table-actions">
                  <button class="btn btn-ghost btn-xs" data-ssh-copy="${esc(k.id)}">Copy public key</button>
                  <button class="btn btn-ghost btn-xs" data-ssh-dl="${esc(k.id)}" data-ssh-name="${esc(k.name)}">Download private</button>
                  <button class="btn btn-ghost btn-xs text-danger" data-ssh-del="${esc(k.id)}" data-ssh-name="${esc(k.name)}">${ICON.trash}</button>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    wrap.querySelectorAll('[data-ssh-copy]').forEach(btn =>
      btn.addEventListener('click', () => copySshPublicKey(btn.dataset.sshCopy, btn)));
    wrap.querySelectorAll('[data-ssh-dl]').forEach(btn =>
      btn.addEventListener('click', () => downloadSshPrivateKey(btn.dataset.sshDl, btn.dataset.sshName)));
    wrap.querySelectorAll('[data-ssh-del]').forEach(btn =>
      btn.addEventListener('click', () => deleteSshKey(btn.dataset.sshDel, btn.dataset.sshName)));
  }

  async function copySshPublicKey(id, btn) {
    try {
      const r = await API.getJSON(`/api/ssh-keys/${id}/export-public`);
      if (!r) return;
      await navigator.clipboard?.writeText(r.publicKey).catch(() => {});
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch (err) { alert(`Copy failed: ${err.message}`); }
  }

  async function downloadSshPrivateKey(id, keyName) {
    try {
      const r = await API.getJSON(`/api/ssh-keys/${id}/export-private`);
      if (!r) return;
      const blob = new Blob([r.privateKeyPem], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${keyName || id}.pem`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) { alert(`Download failed: ${err.message}`); }
  }

  async function deleteSshKey(id, name) {
    if (!confirm(`Delete SSH key "${name || id}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/ssh-keys/${id}`, { method: 'DELETE' });
      if (res.status === 409) {
        const body = await res.json();
        const names = (body.profiles || []).map(p => p.name).join(', ');
        alert(`Cannot delete — key is used by profile(s): ${names}`);
        return;
      }
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || res.statusText); }
      const fresh = await API.getJSON('/api/ssh-keys');
      if (fresh) renderSshKeys(fresh);
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }

  document.getElementById('ssh-gen-btn')?.addEventListener('click', () => {
    const bd = document.createElement('div');
    bd.innerHTML = `
      <div class="field">
        <label>Key name / label</label>
        <input id="ssh-gen-name" type="text" placeholder="e.g. Prod SFTP deploy key">
      </div>
      <div class="field">
        <label>Algorithm</label>
        <select id="ssh-gen-algo">
          <option value="ed25519">Ed25519 (recommended)</option>
          <option value="rsa">RSA 4096</option>
        </select>
      </div>
      <div id="ssh-gen-err" class="alert alert-error hidden"></div>
      <div id="ssh-gen-ok"  class="alert alert-success hidden"></div>`;
    const ft = document.createElement('div');
    ft.innerHTML = `<button id="ssh-gen-cancel" class="btn btn-ghost">Cancel</button>
                    <button id="ssh-gen-save"   class="btn btn-primary">Generate</button>`;
    const { close } = openModal({ title: 'Generate SSH Keypair', body: bd, footer: ft });
    ft.querySelector('#ssh-gen-cancel').addEventListener('click', close);
    ft.querySelector('#ssh-gen-save').addEventListener('click', async () => {
      const name    = bd.querySelector('#ssh-gen-name').value.trim();
      const algorithm = bd.querySelector('#ssh-gen-algo').value;
      const errEl   = bd.querySelector('#ssh-gen-err');
      const okEl    = bd.querySelector('#ssh-gen-ok');
      const saveBtn = ft.querySelector('#ssh-gen-save');
      if (!name)      { errEl.textContent = 'Key name is required.'; errEl.classList.remove('hidden'); return; }
      if (!algorithm) { errEl.textContent = 'Algorithm is required.'; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      saveBtn.disabled = true; saveBtn.textContent = 'Generating…';
      try {
        const r = await API.postJSON('/api/ssh-keys/generate', { name, algorithm });
        okEl.textContent = `Keypair generated — ${r.fingerprint}`;
        okEl.classList.remove('hidden');
        saveBtn.textContent = 'Done';
        const fresh = await API.getJSON('/api/ssh-keys');
        if (fresh) renderSshKeys(fresh);
        setTimeout(close, 2000);
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        saveBtn.disabled = false; saveBtn.textContent = 'Generate';
      }
    });
  });

  document.getElementById('ssh-import-btn')?.addEventListener('click', () => {
    const bd = document.createElement('div');
    bd.innerHTML = `
      <div class="field">
        <label>Key name / label</label>
        <input id="ssh-imp-name" type="text" placeholder="e.g. Prod SFTP deploy key">
      </div>
      <div class="field">
        <label>Private key (PEM format)</label>
        <textarea id="ssh-imp-pem" style="width:100%;height:180px;font-family:monospace;font-size:12px;resize:vertical" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n…"></textarea>
      </div>
      <div class="field">
        <label>Passphrase <span class="text-muted" style="font-weight:400">(if key is encrypted, leave blank if none)</span></label>
        <input id="ssh-imp-pass" type="password" autocomplete="new-password">
      </div>
      <div id="ssh-imp-err" class="alert alert-error hidden"></div>`;
    const ft = document.createElement('div');
    ft.innerHTML = `<button id="ssh-imp-cancel" class="btn btn-ghost">Cancel</button>
                    <button id="ssh-imp-save"   class="btn btn-primary">Import</button>`;
    const { close } = openModal({ title: 'Import SSH Key', body: bd, footer: ft });
    ft.querySelector('#ssh-imp-cancel').addEventListener('click', close);
    ft.querySelector('#ssh-imp-save').addEventListener('click', async () => {
      const name          = bd.querySelector('#ssh-imp-name').value.trim();
      const privateKeyPem = bd.querySelector('#ssh-imp-pem') .value.trim();
      const passphrase    = bd.querySelector('#ssh-imp-pass').value;
      const errEl         = bd.querySelector('#ssh-imp-err');
      const saveBtn       = ft.querySelector('#ssh-imp-save');
      if (!name)          { errEl.textContent = 'Key name is required.'; errEl.classList.remove('hidden'); return; }
      if (!privateKeyPem) { errEl.textContent = 'Paste a private key PEM first.'; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      saveBtn.disabled = true; saveBtn.textContent = 'Importing…';
      try {
        await API.postJSON('/api/ssh-keys/import', { name, privateKeyPem, passphrase: passphrase || undefined });
        close();
        const fresh = await API.getJSON('/api/ssh-keys');
        if (fresh) renderSshKeys(fresh);
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        saveBtn.disabled = false; saveBtn.textContent = 'Import';
      }
    });
  });

  // ── Change own password ────────────────────────────────────────────
  document.getElementById('pw-save-btn')?.addEventListener('click', async () => {
    const errEl = document.getElementById('pw-err');
    const okEl  = document.getElementById('pw-ok');
    errEl.classList.add('hidden'); okEl.classList.add('hidden');

    const cur = document.getElementById('pw-current')?.value || '';
    const nw  = document.getElementById('pw-new')?.value     || '';
    const cf  = document.getElementById('pw-confirm')?.value || '';

    if (!cur) { errEl.textContent = 'Current password is required'; errEl.classList.remove('hidden'); return; }
    if (nw.length < 8) { errEl.textContent = 'New password must be at least 8 characters'; errEl.classList.remove('hidden'); return; }
    if (nw !== cf) { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return; }

    // Verify current password via login endpoint first
    try {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: app.user.username, password: cur }),
      });
      if (!loginRes.ok) { errEl.textContent = 'Current password is incorrect'; errEl.classList.remove('hidden'); return; }
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); return; }

    try {
      const r = await fetch('/api/auth/users/' + app.user.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nw }),
      });
      const d = await r.json();
      if (!r.ok) { errEl.textContent = d.error || 'Save failed'; errEl.classList.remove('hidden'); return; }
      okEl.textContent = 'Password changed successfully.';
      okEl.classList.remove('hidden');
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value     = '';
      document.getElementById('pw-confirm').value  = '';
      setTimeout(() => okEl.classList.add('hidden'), 4000);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
};

// ── Quick profiles helper (used by rule builder sidebar) ───────────────
function buildQuickProfilesHTML(profileList) {
  if (!profileList.length) return '<p class="text-muted text-sm">No profiles yet.</p>';
  const sorted = [...profileList].sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  return sorted.map(qp => {
    const path = qp.type === 'sftp' ? (qp.remotePath || '/') : (qp.path || '');
    return `<button class="quick-profile-btn" data-id="${esc(qp.id)}" data-path="${esc(path)}">
      <span class="qp-fav ${qp.favorite ? 'qp-fav-on' : ''}">${qp.favorite ? ICON.starFilled : ICON.star}</span>
      <span class="badge ${qp.type==='sftp'?'badge-accent':'badge-muted'}" style="font-size:9px">${qp.type.toUpperCase()}</span>
      ${esc(qp.name)}
    </button>`;
  }).join('');
}

// ── Rule Builder ───────────────────────────────────────────────────────
VIEWS['rule-builder'] = function(el) {
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const isAdmin = app.user?.role === 'admin';
  const ruleId  = app.editingRuleId || null;
  let profiles   = [];
  let allRules   = [];
  let allGroups  = [];
  let tagKeys    = [];
  let lastRun    = null;
  let runResult  = null;
  let form       = null;
  let newGroupName = '';

  // ── Load ──────────────────────────────────────────────────────────
  let pgpKeys = [];

  async function loadData() {
    try {
      const reqs = [
        API.get('/api/profiles'),
        API.get('/api/rules'),
        API.get('/api/tags/keys'),
        API.get('/api/pgp'),
        API.get('/api/groups'),
      ];
      if (ruleId) reqs.push(API.get(`/api/jobs?ruleId=${ruleId}&limit=1`));
      const rs = await Promise.all(reqs);
      if (rs.some(r => !r)) return;

      profiles  = await rs[0].json();
      allRules  = await rs[1].json();
      tagKeys   = await rs[2].json();
      pgpKeys   = await rs[3].json();
      allGroups = await rs[4].json();
      if (ruleId && rs[5]) {
        const jd = await rs[5].json();
        lastRun  = jd.jobs?.[0] ?? null;
      }

      if (ruleId && !allRules.some(r => r.id === ruleId)) {
        el.innerHTML = `<div class="alert alert-error" style="margin-bottom:16px">
            This rule no longer exists — it may have been deleted since this job ran.
          </div>
          <button id="rb-missing-back" class="btn btn-ghost btn-sm">${ICON.chevronL} Back</button>`;
        document.getElementById('rb-missing-back')?.addEventListener('click', () => returnFromRuleBuilder());
        return;
      }

      const rule = ruleId ? (allRules.find(r => r.id === ruleId) || {}) : {};
      // Consume the group pre-selection set by the group picker (new rules only)
      const initialGroupId = ruleId ? rule.groupId : app.editingRuleGroupId;
      if (!ruleId) app.editingRuleGroupId = null;
      form = {
        name:           rule.name          || '',
        source:         { profileId: '', path: '', filter: '', recursive: false, ...(rule.source || {}) },
        destinations:   (rule.destinations?.length ? rule.destinations : [{ profileId: '', path: '' }]).map(d => ({ ...d })),
        action:         rule.action         || 'copy',
        onConflict:     rule.onConflict     || 'overwrite',
        onError:        rule.onError        || 'continue',
        retryCount:     rule.retryCount     ?? 3,
        verifySize:     rule.verifySize     !== false,
        cron:           rule.cron           || 'manual',
        tags:           [...(rule.tags      || [])],
        enabled:        rule.enabled        !== false,
        chainOnSuccess: [...(rule.chainOnSuccess || [])],
        chainOnFailure: [...(rule.chainOnFailure || [])],
        groupId:        initialGroupId     || undefined,
        pgp: {
          enabled:      rule.pgp?.enabled      || false,
          operation:    rule.pgp?.operation    || 'decrypt',
          decryptKeyId: rule.pgp?.decryptKeyId || '',
          encryptKeyIds:[...(rule.pgp?.encryptKeyIds || [])],
          sign:         rule.pgp?.sign         || false,
          signKeyId:    rule.pgp?.signKeyId    || '',
          onFailure:    rule.pgp?.onFailure    || 'stop',
        },
        rename: {
          enabled:        rule.rename?.enabled        || false,
          includeDate:    rule.rename?.includeDate     !== false, // default true — preserves behavior of existing rules
          position:       rule.rename?.position       || 'prefix',
          format:         rule.rename?.format         || 'YYYYMMDD',
          separator:      rule.rename?.separator       ?? '_',
          customText:     rule.rename?.customText      ?? '',
          customPosition: rule.rename?.customPosition || 'prefix',
        },
        zip: {
          enabled:    rule.zip?.enabled    || false,
          operation:  rule.zip?.operation  || 'zip',
          mode:       rule.zip?.mode       || 'bundle',
          bundleName: rule.zip?.bundleName || '{rulename}_{date}',
          dateFormat: rule.zip?.dateFormat || 'YYYYMMDD',
          separator:  rule.zip?.separator  ?? '_',
          level:      rule.zip?.level      ?? 6,
        },
        dateFilter: rule.dateFilter
          ? { enabled: true, ...rule.dateFilter }
          : { enabled: false, field: 'modified', mode: 'withinDays', withinDays: 1, sinceDate: '' },
      };
      render();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-error">Failed to load: ${esc(err.message)}</div>`;
    }
  }

  // ── Render shell ──────────────────────────────────────────────────
  function render() {
    const pOpts = profiles.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.type)})</option>`).join('');
    const pOptsBlank = `<option value="">— select profile —</option>${pOpts}`;

    el.innerHTML = `
      <div class="rb-header">
        <button id="rb-back" class="btn btn-ghost btn-sm">${ICON.chevronL} Back</button>
        <input id="rb-name" class="rb-name-input" placeholder="Rule name…" value="${esc(form.name)}">
        <div style="display:flex;gap:8px;margin-left:auto">
          ${(isAdmin && ruleId) ? `<button id="rb-run" class="btn btn-secondary btn-sm">${ICON.play} Run now</button>` : ''}
          ${isAdmin ? `<button id="rb-save" class="btn btn-primary btn-sm">Save rule</button>` : ''}
        </div>
      </div>
      ${runResult ? `<div class="alert ${runResult.ok ? 'alert-success' : 'alert-error'}" style="margin-bottom:16px">${esc(runResult.msg)}</div>` : ''}
      <div class="rb-layout">
        <div class="rb-main">

          <!-- Group -->
          <div class="card rb-section">
            <div class="rb-section-title">Group</div>
            <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
              <div class="field" style="min-width:200px;flex:1">
                <label>Assign to group</label>
                <select id="rb-group">
                  <option value="">— Ungrouped —</option>
                  ${allGroups.map(g => `<option value="${esc(g.id)}"${form.groupId===g.id?' selected':''}>${esc(g.name)}</option>`).join('')}
                  <option value="__new__">New group…</option>
                </select>
              </div>
              <div id="rb-group-new-field" class="field" style="${form.groupId==='__new__'?'':'display:none'};min-width:180px;flex:1">
                <label>New group name</label>
                <input id="rb-group-new-name" type="text" placeholder="Group name…" value="${esc(newGroupName)}">
              </div>
            </div>
          </div>

          <!-- Source -->
          <div class="card rb-section">
            <div class="rb-section-title">Source</div>
            <div class="grid-2">
              <div class="field">
                <label>Profile</label>
                <select id="src-profile">${pOptsBlank}</select>
              </div>
              <div class="field">
                <label>Path</label>
                <div class="path-row">
                  <input id="src-path" type="text" placeholder="\\\\server\\share\\path or /remote/path" value="${esc(form.source.path)}">
                  <button id="src-browse" class="btn btn-secondary btn-sm" title="Browse">${ICON.folder}</button>
                </div>
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>File filter <span style="font-weight:400;text-transform:none">(glob)</span></label>
                <input id="src-filter" type="text" placeholder="*.csv" value="${esc(form.source.filter || '')}">
              </div>
              <div class="field" style="justify-content:flex-end;padding-top:6px">
                <div class="toggle-label-row">
                  <span class="field-label-sm">Recursive</span>
                  <div id="src-rec-wrap"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Date Filter -->
          <div class="card rb-section">
            <div class="rb-section-header">
              <span class="rb-section-title">Date Filter</span>
              <div id="df-enabled-wrap"></div>
            </div>
            <div id="df-body" style="${form.dateFilter.enabled ? '' : 'display:none'}">
              <div class="grid-2">
                <div class="field">
                  <label>Date field</label>
                  <select id="df-field">
                    <option value="modified"${form.dateFilter.field==='modified'?' selected':''}>Date Modified</option>
                    <option value="created"${form.dateFilter.field==='created'?' selected':''}>Date Created</option>
                  </select>
                </div>
                <div class="field">
                  <label>Mode</label>
                  <select id="df-mode">
                    <option value="withinDays"${form.dateFilter.mode==='withinDays'?' selected':''}>Within the last N days</option>
                    <option value="olderThanDays"${form.dateFilter.mode==='olderThanDays'?' selected':''}>Older than N days</option>
                    <option value="sinceDate"${form.dateFilter.mode==='sinceDate'?' selected':''}>Since a specific date</option>
                  </select>
                </div>
              </div>
              <div id="df-within-field" class="field" style="${form.dateFilter.mode==='sinceDate'?'display:none':''}">
                <label id="df-within-label">${form.dateFilter.mode==='olderThanDays' ? 'Delete files older than N days' : 'Within the last N days'}</label>
                <input id="df-within-days" type="number" min="1" max="3650" value="${form.dateFilter.withinDays || 1}" style="width:100px">
              </div>
              <div id="df-since-field" class="field" style="${form.dateFilter.mode!=='sinceDate'?'display:none':''}">
                <label>Since date</label>
                <input id="df-since-date" type="date" value="${esc(form.dateFilter.sinceDate || '')}">
              </div>
            </div>
          </div>

          <!-- PGP Transform -->
          <div class="card rb-section" id="pgp-section" style="${form.action==='delete'?'display:none':''}">
            <div class="rb-section-header">
              <span class="rb-section-title">PGP Transform</span>
              <div id="pgp-enabled-wrap"></div>
            </div>
            <div id="pgp-body" style="${form.pgp.enabled ? '' : 'display:none'}">
              <div class="grid-2">
                <div class="field">
                  <label>Operation</label>
                  <select id="pgp-operation">
                    <option value="decrypt"${form.pgp.operation==='decrypt'?' selected':''}>Decrypt (.pgp → plaintext)</option>
                    <option value="encrypt"${form.pgp.operation==='encrypt'?' selected':''}>Encrypt (plaintext → .pgp)</option>
                    <option value="decrypt-then-encrypt"${form.pgp.operation==='decrypt-then-encrypt'?' selected':''}>Decrypt then Re-encrypt</option>
                  </select>
                </div>
                <div class="field">
                  <label>On transform failure</label>
                  <select id="pgp-on-fail">
                    <option value="stop"${form.pgp.onFailure==='stop'?' selected':''}>Stop (fail the file)</option>
                    <option value="continue"${form.pgp.onFailure==='continue'?' selected':''}>Continue (forward untransformed)</option>
                  </select>
                </div>
              </div>
              <div id="pgp-decrypt-row" class="field" style="${(form.pgp.operation==='encrypt')?'display:none':''}">
                <label>Private key (decrypt)</label>
                <select id="pgp-decrypt-key">
                  <option value="">— select private key —</option>
                  ${pgpKeys.filter(k=>k.type==='private').map(k=>`<option value="${esc(k.id)}"${form.pgp.decryptKeyId===k.id?' selected':''}>${esc(k.name)}</option>`).join('')}
                </select>
              </div>
              <div id="pgp-encrypt-row" style="${(form.pgp.operation==='decrypt')?'display:none':''}">
                <div class="field">
                  <label>Recipient public keys</label>
                  <div id="pgp-encrypt-keys" class="pgp-key-chips"></div>
                  <select id="pgp-encrypt-key-add" style="margin-top:6px">
                    <option value="">+ Add recipient…</option>
                    ${pgpKeys.filter(k=>k.type==='public').map(k=>`<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}
                  </select>
                </div>
                <div class="toggle-label-row" style="margin-top:8px">
                  <span class="field-label-sm">Sign output</span>
                  <div id="pgp-sign-wrap"></div>
                </div>
                <div id="pgp-sign-key-row" class="field" style="${form.pgp.sign?'':'display:none'}">
                  <label>Signing private key</label>
                  <select id="pgp-sign-key">
                    <option value="">— select signing key —</option>
                    ${pgpKeys.filter(k=>k.type==='private').map(k=>`<option value="${esc(k.id)}"${form.pgp.signKeyId===k.id?' selected':''}>${esc(k.name)}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Rename Transform -->
          <div class="card rb-section" id="rename-section" style="${form.action==='delete'?'display:none':''}">
            <div class="rb-section-header">
              <span class="rb-section-title">Rename Transform</span>
              <div id="rename-enabled-wrap"></div>
            </div>
            <div id="rename-body" style="${form.rename.enabled ? '' : 'display:none'}">
              <div class="toggle-label-row">
                <span class="field-label-sm">Include date</span>
                <div id="rename-include-date-wrap"></div>
              </div>
              <div id="rename-date-fields" style="${form.rename.includeDate ? '' : 'display:none'};margin-top:10px">
                <div class="grid-2">
                  <div class="field">
                    <label>Position</label>
                    <select id="rename-position">
                      <option value="prefix"${form.rename.position==='prefix'?' selected':''}>Prefix</option>
                      <option value="suffix"${form.rename.position==='suffix'?' selected':''}>Suffix</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>Date format</label>
                    <select id="rename-format">
                      <option value="YYYYMMDD"${form.rename.format==='YYYYMMDD'?' selected':''}>YYYYMMDD</option>
                      <option value="YYYY-MM-DD"${form.rename.format==='YYYY-MM-DD'?' selected':''}>YYYY-MM-DD</option>
                      <option value="YYYY-MM-DDTHH-MM-SS"${form.rename.format==='YYYY-MM-DDTHH-MM-SS'?' selected':''}>YYYY-MM-DDTHH-MM-SS</option>
                      <option value="YYYYMMDD_HHMMSS"${form.rename.format==='YYYYMMDD_HHMMSS'?' selected':''}>YYYYMMDD_HHMMSS</option>
                      <option value="MM-DD-YYYY"${form.rename.format==='MM-DD-YYYY'?' selected':''}>MM-DD-YYYY</option>
                      <option value="DD-MM-YYYY"${form.rename.format==='DD-MM-YYYY'?' selected':''}>DD-MM-YYYY</option>
                      <option value="UNIX"${form.rename.format==='UNIX'?' selected':''}>UNIX timestamp</option>
                      <option value="CYYMMDD"${form.rename.format==='CYYMMDD'?' selected':''}>CYYMMDD (AS/400)</option>
                    </select>
                  </div>
                </div>
              </div>
              <div class="field" style="max-width:160px">
                <label>Separator</label>
                <input id="rename-separator" type="text" value="${esc(form.rename.separator)}" maxlength="5" placeholder="_">
              </div>
              <div class="grid-2">
                <div class="field">
                  <label id="rename-custom-text-label">Custom text${form.rename.includeDate ? ' (optional)' : ''}</label>
                  <input id="rename-custom-text" type="text" value="${esc(form.rename.customText)}" maxlength="64" placeholder="e.g. PROCESSED">
                </div>
                <div class="field">
                  <label>Custom text position</label>
                  <select id="rename-custom-position">
                    <option value="prefix"${form.rename.customPosition==='prefix'?' selected':''}>Prefix</option>
                    <option value="suffix"${form.rename.customPosition==='suffix'?' selected':''}>Suffix</option>
                  </select>
                </div>
              </div>
              <div id="rename-no-date-hint" class="text-muted text-sm" style="margin-top:4px;${form.rename.includeDate ? 'display:none' : ''}">No date will be added — only the custom text above.</div>
              <div id="rename-preview" class="text-muted text-sm" style="margin-top:10px;font-family:monospace"></div>
            </div>
          </div>

          <!-- Zip Transform -->
          <div class="card rb-section" id="zip-section" style="${form.action==='delete'?'display:none':''}">
            <div class="rb-section-header">
              <span class="rb-section-title">Zip Transform</span>
              <div id="zip-enabled-wrap"></div>
            </div>
            <div id="zip-body" style="${form.zip.enabled ? '' : 'display:none'}">
              <div class="grid-2">
                <div class="field">
                  <label>Operation</label>
                  <select id="zip-operation">
                    <option value="zip"  ${form.zip.operation==='zip'  ?' selected':''}>Zip (compress)</option>
                    <option value="unzip"${form.zip.operation==='unzip'?' selected':''}>Unzip (extract)</option>
                  </select>
                </div>
                <div class="field" id="zip-mode-field" style="${form.zip.operation!=='zip'?'display:none':''}">
                  <label>Mode</label>
                  <select id="zip-mode">
                    <option value="bundle"  ${form.zip.mode==='bundle'  ?' selected':''}>Bundle — all files into one archive</option>
                    <option value="per-file"${form.zip.mode==='per-file'?' selected':''}>Per-file — each file gets its own .zip</option>
                  </select>
                </div>
              </div>
              <div id="zip-bundle-fields" style="${(form.zip.operation!=='zip'||form.zip.mode!=='bundle')?'display:none':''}">
                <div class="field">
                  <label>Archive name <span class="text-muted" style="font-weight:400;text-transform:none;font-size:11px">tokens: {rulename} {date} {filename}</span></label>
                  <input id="zip-bundle-name" type="text" value="${esc(form.zip.bundleName)}" placeholder="{rulename}_{date}">
                </div>
                <div class="grid-2">
                  <div class="field">
                    <label>Date format</label>
                    <select id="zip-date-format">
                      <option value="YYYYMMDD"${form.zip.dateFormat==='YYYYMMDD'?' selected':''}>YYYYMMDD</option>
                      <option value="YYYY-MM-DD"${form.zip.dateFormat==='YYYY-MM-DD'?' selected':''}>YYYY-MM-DD</option>
                      <option value="YYYY-MM-DDTHH-MM-SS"${form.zip.dateFormat==='YYYY-MM-DDTHH-MM-SS'?' selected':''}>YYYY-MM-DDTHH-MM-SS</option>
                      <option value="YYYYMMDD_HHMMSS"${form.zip.dateFormat==='YYYYMMDD_HHMMSS'?' selected':''}>YYYYMMDD_HHMMSS</option>
                      <option value="MM-DD-YYYY"${form.zip.dateFormat==='MM-DD-YYYY'?' selected':''}>MM-DD-YYYY</option>
                      <option value="DD-MM-YYYY"${form.zip.dateFormat==='DD-MM-YYYY'?' selected':''}>DD-MM-YYYY</option>
                      <option value="UNIX"${form.zip.dateFormat==='UNIX'?' selected':''}>UNIX timestamp</option>
                      <option value="CYYMMDD"${form.zip.dateFormat==='CYYMMDD'?' selected':''}>CYYMMDD (AS/400)</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>Separator</label>
                    <input id="zip-separator" type="text" value="${esc(form.zip.separator)}" maxlength="5" placeholder="_">
                  </div>
                </div>
                <div id="zip-preview" class="text-muted text-sm" style="margin-top:8px;font-family:monospace"></div>
              </div>
              <div id="zip-level-field" class="field" style="${form.zip.operation!=='zip'?'display:none':''}">
                <label>Compression level &nbsp;<span id="zip-level-val" class="text-muted">${form.zip.level}</span></label>
                <input id="zip-level" type="range" min="1" max="9" value="${form.zip.level}" style="width:200px;display:block;margin-top:6px">
              </div>
            </div>
          </div>

          <!-- Destinations -->
          <div class="card rb-section" id="dest-section" style="${form.action==='delete'?'display:none':''}">
            <div class="rb-section-header">
              <span class="rb-section-title">Destinations</span>
              <button id="add-dest" class="btn btn-ghost btn-sm">${ICON.plus} Add</button>
            </div>
            <div id="dest-list"></div>
          </div>

          <!-- Transfer Options -->
          <div class="card rb-section">
            <div class="rb-section-title">Transfer Options</div>
            <div class="grid-3">
              <div class="field">
                <label>Action</label>
                <select id="opt-action">
                  <option value="copy" ${form.action==='copy'?'selected':''}>Copy</option>
                  <option value="move" ${form.action==='move'?'selected':''}>Move (delete source)</option>
                  <option value="delete" ${form.action==='delete'?'selected':''}>Delete (cleanup only — no destination)</option>
                </select>
              </div>
              <div class="field">
                <label>On conflict</label>
                <select id="opt-conflict">
                  <option value="overwrite" ${form.onConflict==='overwrite'?'selected':''}>Overwrite</option>
                  <option value="skip"      ${form.onConflict==='skip'     ?'selected':''}>Skip</option>
                  <option value="rename"    ${form.onConflict==='rename'   ?'selected':''}>Rename</option>
                </select>
              </div>
              <div class="field">
                <label>On error</label>
                <select id="opt-error">
                  <option value="continue" ${form.onError==='continue'?'selected':''}>Continue</option>
                  <option value="stop"     ${form.onError==='stop'    ?'selected':''}>Stop</option>
                  <option value="retry"    ${form.onError==='retry'   ?'selected':''}>Retry</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:16px;align-items:center;margin-top:4px">
              <div class="field" id="retry-field" style="${form.onError!=='retry'?'display:none':''}">
                <label>Retry count</label>
                <input id="opt-retry" type="number" min="1" max="10" value="${form.retryCount}" style="width:80px">
              </div>
              <div class="toggle-label-row" style="margin-top:${form.onError==='retry'?'18':'0'}px">
                <span class="field-label-sm">Verify size post-transfer</span>
                <div id="opt-verify-wrap"></div>
              </div>
            </div>
          </div>

          <!-- Schedule -->
          <div class="card rb-section">
            <div class="rb-section-title">Schedule</div>
            <div class="grid-2">
              <div class="field">
                <label>Preset</label>
                <select id="sched-preset">
                  ${CRON_PRESETS.map(p => `<option value="${esc(p.value)}"${scheduleMatchesPreset(form.cron,p.value)?' selected':''}>${esc(p.label)}</option>`).join('')}
                </select>
              </div>
              <div class="field" id="sched-cron-field">
                <label>Cron expression</label>
                <div style="display:flex;gap:8px">
                  <input id="sched-cron" type="text" placeholder="*/15 * * * *"
                         value="${esc(form.cron&&form.cron!=='manual'?form.cron:'')}" style="flex:1">
                  <button type="button" id="sched-build-btn" class="btn btn-ghost btn-sm" style="white-space:nowrap">Build schedule…</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Tags -->
          <div class="card rb-section">
            <div class="rb-section-title">Tags</div>
            <div id="rb-tags-display" class="tags-display"></div>
            <div class="tag-add-row">
              <select id="rb-tag-key" style="width:110px;padding:6px 8px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
                ${tagKeys.length ? tagKeys.map(k=>`<option>${esc(k)}</option>`).join('') : '<option value="">— add keys in Settings —</option>'}
              </select>
              <input id="rb-tag-val" type="text" placeholder="value"
                     style="width:120px;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);outline:none;font-size:13px">
              <button id="rb-tag-add" class="btn btn-ghost btn-sm">${ICON.plus} Add</button>
            </div>
          </div>

          <!-- Chain -->
          <div class="card rb-section">
            <div class="rb-section-title">Chain</div>
            <div class="chain-row">
              <span class="chain-label chain-success">On success →</span>
              <div id="chain-ok-list"  class="chain-list"></div>
              <button id="chain-add-ok"  class="btn btn-ghost btn-sm">${ICON.plus}</button>
            </div>
            <div class="chain-row" style="margin-top:8px">
              <span class="chain-label chain-fail">On failure →</span>
              <div id="chain-err-list" class="chain-list"></div>
              <button id="chain-add-err" class="btn btn-ghost btn-sm">${ICON.plus}</button>
            </div>
          </div>

        </div><!-- /.rb-main -->

        <!-- Sidebar -->
        <div class="rb-sidebar">
          <div class="card rb-section">
            <div class="rb-section-title">Last Run</div>
            ${lastRunHTML()}
          </div>
          <div class="card rb-section">
            <div class="rb-section-title">Quick Profiles</div>
            <div class="quick-profiles" id="quick-profiles-list">
              ${buildQuickProfilesHTML(profiles)}
            </div>
          </div>
          <div class="card rb-section">
            <div class="rb-section-title">Filter Presets</div>
            <div class="preset-chips">
              ${FILTER_PRESETS.map(p => `<button class="preset-chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>`;

    // Set select values (can't set via innerHTML for selected state reliably)
    document.getElementById('src-profile').value = form.source.profileId || '';

    // Toggles
    document.getElementById('src-rec-wrap').appendChild(
      makeToggle(form.source.recursive, v => { form.source.recursive = v; }));
    document.getElementById('opt-verify-wrap').appendChild(
      makeToggle(form.verifySize, v => { form.verifySize = v; }));

    // PGP toggles
    document.getElementById('pgp-enabled-wrap').appendChild(
      makeToggle(form.pgp.enabled, v => {
        form.pgp.enabled = v;
        document.getElementById('pgp-body').style.display = v ? '' : 'none';
      }));
    document.getElementById('pgp-sign-wrap').appendChild(
      makeToggle(form.pgp.sign, v => {
        form.pgp.sign = v;
        const row = document.getElementById('pgp-sign-key-row');
        if (row) row.style.display = v ? '' : 'none';
      }));

    // Rename toggle
    document.getElementById('rename-enabled-wrap').appendChild(
      makeToggle(form.rename.enabled, v => {
        form.rename.enabled = v;
        document.getElementById('rename-body').style.display = v ? '' : 'none';
      }));

    // Include-date toggle — when off, the rename only applies the custom
    // text (no forced date prefix/suffix).
    document.getElementById('rename-include-date-wrap').appendChild(
      makeToggle(form.rename.includeDate, v => {
        form.rename.includeDate = v;
        document.getElementById('rename-date-fields').style.display = v ? '' : 'none';
        const hint = document.getElementById('rename-no-date-hint');
        if (hint) hint.style.display = v ? 'none' : '';
        const customLabel = document.getElementById('rename-custom-text-label');
        if (customLabel) customLabel.textContent = v ? 'Custom text (optional)' : 'Custom text';
        updateRenamePreview();
      }));

    updateRenamePreview();

    // Zip toggle
    document.getElementById('zip-enabled-wrap').appendChild(
      makeToggle(form.zip.enabled, v => {
        form.zip.enabled = v;
        document.getElementById('zip-body').style.display = v ? '' : 'none';
      }));
    updateZipPreview();

    // Date Filter toggle
    document.getElementById('df-enabled-wrap').appendChild(
      makeToggle(form.dateFilter.enabled, v => {
        form.dateFilter.enabled = v;
        document.getElementById('df-body').style.display = v ? '' : 'none';
      }));

    renderPgpEncryptKeys();
    syncCronField();
    renderDests();
    renderTags();
    renderChain();
    attachRBEvents();
  }

  // ── PGP encrypt key chips ─────────────────────────────────────────
  function renderPgpEncryptKeys() {
    const container = document.getElementById('pgp-encrypt-keys');
    if (!container) return;
    container.innerHTML = '';
    form.pgp.encryptKeyIds.forEach((kid, i) => {
      const k    = pgpKeys.find(x => x.id === kid);
      const chip = document.createElement('span');
      chip.className = 'pgp-key-chip';
      chip.innerHTML = `${esc(k?.name || kid)}<span class="pgp-chip-x" data-i="${i}">${ICON.close}</span>`;
      chip.querySelector('.pgp-chip-x').addEventListener('click', () => {
        form.pgp.encryptKeyIds.splice(i, 1);
        renderPgpEncryptKeys();
      });
      container.appendChild(chip);
    });
  }

  // ── Destinations list ─────────────────────────────────────────────
  function renderDests() {
    const list  = document.getElementById('dest-list');
    if (!list) return;
    list.innerHTML = '';
    const pOpts = profiles.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.type)})</option>`).join('');

    form.destinations.forEach((dest, i) => {
      const row = document.createElement('div');
      row.className = 'dest-row';
      row.innerHTML = `
        <select class="dest-profile">
          <option value="">— select profile —</option>${pOpts}
        </select>
        <div class="path-row" style="flex:1">
          <input class="dest-path" type="text" placeholder="\\\\server\\share\\path or /remote/path" value="${esc(dest.path||'')}">
          <button class="btn btn-secondary btn-sm dest-browse" title="Browse">${ICON.folder}</button>
        </div>
        <input class="dest-filter" type="text" placeholder="Filter (e.g. Roster_*)" value="${esc(dest.filter||'')}" style="width:160px">
        <button class="btn btn-icon dest-del" title="Remove">${ICON.trash}</button>`;

      row.querySelector('.dest-profile').value = dest.profileId || '';
      row.querySelector('.dest-profile').addEventListener('change', e => {
        dest.profileId = e.target.value;
        if (!dest.path) {
          const p = profiles.find(x => x.id === e.target.value);
          if (p) { dest.path = p.path || p.remotePath || ''; renderDests(); }
        }
      });
      row.querySelector('.dest-path').addEventListener('input', e => { dest.path = e.target.value; });
      row.querySelector('.dest-filter').addEventListener('input', e => { dest.filter = e.target.value; });
      row.querySelector('.dest-browse').addEventListener('click', () => {
        openFolderBrowser(dest.profileId, dest.path, path => { dest.path = path; renderDests(); });
      });
      row.querySelector('.dest-del').addEventListener('click', () => {
        form.destinations.splice(i, 1);
        if (!form.destinations.length) form.destinations.push({ profileId: '', path: '' });
        renderDests();
      });
      list.appendChild(row);
    });
  }

  // ── Tags display ──────────────────────────────────────────────────
  function renderTags() {
    const el = document.getElementById('rb-tags-display');
    if (!el) return;
    if (!form.tags.length) {
      el.innerHTML = '<span class="text-muted text-sm">No tags added.</span>';
      return;
    }
    el.innerHTML = form.tags.map((t, i) => {
      const [k, v] = t.split(':');
      return `<span class="tag" style="gap:5px">${esc(k)}:<b>${esc(v||'')}</b>
        <span class="tag-x" data-i="${i}" style="cursor:pointer;opacity:.6">${ICON.close}</span></span>`;
    }).join(' ');
    el.querySelectorAll('.tag-x').forEach(x => x.addEventListener('click', () => {
      form.tags.splice(+x.dataset.i, 1); renderTags();
    }));
  }

  // ── Chain panel ───────────────────────────────────────────────────
  function renderChain() {
    const others = allRules.filter(r => r.id !== ruleId);
    [
      { listId: 'chain-ok-list',  addId: 'chain-add-ok',  arr: form.chainOnSuccess },
      { listId: 'chain-err-list', addId: 'chain-add-err', arr: form.chainOnFailure },
    ].forEach(({ listId, addId, arr }) => {
      const c = document.getElementById(listId);
      if (!c) return;
      c.innerHTML = '';
      arr.forEach((node, i) => {
        let label;
        if (typeof node === 'string') {
          const r = others.find(x => x.id === node);
          label = r?.name || node;
        } else if (node.type === 'pgp-decrypt') {
          const k = pgpKeys.find(x => x.id === node.privateKeyId);
          label = `PGP Decrypt (${k?.name || node.privateKeyId || '?'})`;
        } else if (node.type === 'pgp-encrypt') {
          const names = (node.publicKeyIds || []).map(id => pgpKeys.find(x=>x.id===id)?.name||id).join(', ');
          label = `PGP Encrypt (${names || '?'})`;
        } else {
          const r = others.find(x => x.id === (node.ruleId || node));
          label = r?.name || node.ruleId || String(node);
        }
        const span = document.createElement('span');
        span.className = 'chain-item';
        span.innerHTML = `${esc(label)} <span class="chain-x" data-i="${i}" style="cursor:pointer;opacity:.5">${ICON.close}</span>`;
        span.querySelector('.chain-x').addEventListener('click', () => { arr.splice(i, 1); renderChain(); });
        c.appendChild(span);
      });

      document.getElementById(addId)?.addEventListener('click', () => {
        const privKeys = pgpKeys.filter(k => k.type === 'private');
        const pubKeys  = pgpKeys.filter(k => k.type === 'public');
        const bd = document.createElement('div');
        bd.innerHTML = `
          <div class="field">
            <label>Step type</label>
            <select id="cp-type">
              <option value="rule">Transfer Rule</option>
              ${privKeys.length ? '<option value="pgp-decrypt">PGP Decrypt</option>' : ''}
              ${pubKeys.length  ? '<option value="pgp-encrypt">PGP Encrypt</option>' : ''}
            </select>
          </div>
          <div id="cp-rule-row" class="field">
            <label>Rule</label>
            <select id="cp-sel">
              ${others.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
            </select>
          </div>
          <div id="cp-pgp-dec-row" style="display:none">
            <div class="field"><label>Private key</label>
              <select id="cp-priv-key"><option value="">— select —</option>
                ${privKeys.map(k=>`<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}
              </select></div>
            <div class="field"><label>Source path</label><input id="cp-src-path" type="text" placeholder="/path/to/file.pgp"></div>
            <div class="field"><label>Output path</label><input id="cp-out-path" type="text" placeholder="/path/to/output"></div>
          </div>
          <div id="cp-pgp-enc-row" style="display:none">
            <div class="field"><label>Public key(s)</label>
              <select id="cp-pub-key"><option value="">— select —</option>
                ${pubKeys.map(k=>`<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}
              </select></div>
            <div class="field"><label>Source path</label><input id="cp-enc-src-path" type="text" placeholder="/path/to/file"></div>
            <div class="field"><label>Output path</label><input id="cp-enc-out-path" type="text" placeholder="/path/to/file.pgp"></div>
          </div>`;

        bd.querySelector('#cp-type').addEventListener('change', e => {
          bd.querySelector('#cp-rule-row').style.display    = e.target.value === 'rule'        ? '' : 'none';
          bd.querySelector('#cp-pgp-dec-row').style.display = e.target.value === 'pgp-decrypt' ? '' : 'none';
          bd.querySelector('#cp-pgp-enc-row').style.display = e.target.value === 'pgp-encrypt' ? '' : 'none';
        });

        const ft = document.createElement('div');
        ft.innerHTML = `<button id="cp-c" class="btn btn-ghost">Cancel</button>
                        <button id="cp-a" class="btn btn-primary">Add</button>`;
        const { close } = openModal({ title: 'Add chain step', body: bd, footer: ft });
        ft.querySelector('#cp-c').addEventListener('click', close);
        ft.querySelector('#cp-a').addEventListener('click', () => {
          const t = bd.querySelector('#cp-type').value;
          let node;
          if (t === 'rule') {
            const rid = bd.querySelector('#cp-sel').value;
            if (!rid) return;
            node = rid;
          } else if (t === 'pgp-decrypt') {
            node = { type: 'pgp-decrypt', privateKeyId: bd.querySelector('#cp-priv-key').value,
              sourcePath: bd.querySelector('#cp-src-path').value,
              outputPath: bd.querySelector('#cp-out-path').value };
          } else if (t === 'pgp-encrypt') {
            const pubId = bd.querySelector('#cp-pub-key').value;
            node = { type: 'pgp-encrypt', publicKeyIds: pubId ? [pubId] : [],
              sourcePath: bd.querySelector('#cp-enc-src-path').value,
              outputPath: bd.querySelector('#cp-enc-out-path').value };
          }
          if (node) { arr.push(node); close(); renderChain(); }
        });
      });
    });
  }

  // ── Last run info ─────────────────────────────────────────────────
  function lastRunHTML() {
    const dur = lastRun && lastRun.startTime && lastRun.endTime
      ? new Date(lastRun.endTime) - new Date(lastRun.startTime) : null;
    const runInfo = lastRun
      ? `<div class="last-run-info">
          <div>${statusBadge(lastRun.status, lastRun.subStatus)}</div>
          <div class="text-muted text-sm">${fmtTime(lastRun.startTime)}</div>
          <div class="text-sm">${fmtDuration(dur)}</div>
          <div class="text-sm">${lastRun.filesTransferred??0} files · ${fmtBytes(lastRun.bytesTransferred)}</div>
        </div>`
      : '<p class="text-muted text-sm">No runs yet.</p>';
    const links = ruleId
      ? `<div class="last-run-links">
          <a class="rb-nav-link" href="#history?ruleId=${esc(ruleId)}&ruleName=${encodeURIComponent(form.name||'')}">View all runs →</a>
          <a class="rb-nav-link" href="#logs?filter=${encodeURIComponent(form.name||ruleId)}">View logs →</a>
        </div>`
      : '';
    return runInfo + links;
  }

  // ── Schedule helpers ──────────────────────────────────────────────
  function scheduleMatchesPreset(cronVal, pval) {
    if (pval === 'manual') return !cronVal || cronVal === 'manual';
    if (pval === '__custom__') {
      // "Custom…" should be selected whenever the rule's cron is a real
      // schedule that doesn't match one of the other fixed presets —
      // previously this always returned false, so a rule with a genuine
      // custom cron (e.g. anything built via the schedule builder) silently
      // showed "Manual" selected in the dropdown on load.
      if (!cronVal || cronVal === 'manual') return false;
      return !CRON_PRESETS.some(p => p.value !== 'manual' && p.value !== '__custom__' && p.value === cronVal);
    }
    return cronVal === pval;
  }

  function syncCronField() {
    const ps  = document.getElementById('sched-preset')?.value;
    const fld = document.getElementById('sched-cron-field');
    if (!fld) return;
    const show = ps === '__custom__' || (ps && ps !== 'manual' && ps !== '__custom__');
    fld.style.display = show ? '' : 'none';
    if (ps !== '__custom__' && ps && ps !== 'manual') {
      const inp = document.getElementById('sched-cron');
      if (inp) inp.value = ps;
    }
  }

  // ── Schedule builder modal ─────────────────────────────────────────
  // Opened from the "Build schedule…" button next to the raw cron field
  // (and automatically the first time someone picks "Custom…") so nobody
  // has to hand-write cron syntax. Covers Daily/Weekly/Monthly/Yearly with
  // a real time picker; the underlying cron expression is still shown and
  // directly editable for anything the builder can't express.
  const DOW = [
    { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' }, { v: 3, label: 'Wed' },
    { v: 4, label: 'Thu' }, { v: 5, label: 'Fri' }, { v: 6, label: 'Sat' },
    { v: 0, label: 'Sun' },
  ];
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  /** Best-effort parse of an existing cron string back into builder state. */
  function parseCronForBuilder(cronExpr) {
    const parts = (cronExpr || '').trim().split(/\s+/);
    const out = { freq: 'daily', hour: 8, minute: 0, days: [1,2,3,4,5], dom: 1, month: 1 };
    if (parts.length !== 5) return out;
    const [min, hour, dom, month, dow] = parts;

    const simpleNum = v => /^\d+$/.test(v) ? parseInt(v, 10) : null;
    const m = simpleNum(min), h = simpleNum(hour);
    if (m !== null) out.minute = m;
    if (h !== null) out.hour = h;

    if (dom === '*' && month === '*' && dow === '*') {
      out.freq = 'daily';
    } else if (dom === '*' && month === '*' && dow !== '*') {
      out.freq = 'weekly';
      out.days = dow.split(',').map(d => parseInt(d, 10)).filter(d => !Number.isNaN(d));
      if (!out.days.length) out.days = [1,2,3,4,5];
    } else if (dom !== '*' && month === '*' && dow === '*') {
      out.freq = 'monthly';
      const d = simpleNum(dom); if (d) out.dom = d;
    } else if (dom !== '*' && month !== '*' && dow === '*') {
      out.freq = 'yearly';
      const d = simpleNum(dom);   if (d) out.dom = d;
      const mo = simpleNum(month); if (mo) out.month = mo;
    }
    return out;
  }

  function buildCronFromState(s) {
    const min = s.minute, hr = s.hour;
    switch (s.freq) {
      case 'weekly':  return `${min} ${hr} * * ${[...s.days].sort().join(',')}`;
      case 'monthly': return `${min} ${hr} ${s.dom} * *`;
      case 'yearly':  return `${min} ${hr} ${s.dom} ${s.month} *`;
      case 'daily':
      default:        return `${min} ${hr} * * *`;
    }
  }

  function describeCronState(s) {
    const t = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
    switch (s.freq) {
      case 'weekly': {
        const names = DOW.filter(d => s.days.includes(d.v)).map(d => d.label);
        return `Every ${names.length ? names.join(', ') : '(no days selected)'} at ${t}`;
      }
      case 'monthly': return `Day ${s.dom} of every month at ${t}`;
      case 'yearly':  return `${MONTHS[s.month-1]} ${s.dom}, every year at ${t}`;
      case 'daily':
      default:        return `Every day at ${t}`;
    }
  }

  async function openScheduleBuilderModal(currentCron, onApply) {
    const state = parseCronForBuilder(currentCron);

    // Best-effort: show which timezone these times will actually fire in.
    let tzLabel = 'system default (server-local time)';
    try {
      const r = await API.get('/api/settings');
      if (r) { const d = await r.json(); if (d.scheduleTimezone) tzLabel = d.scheduleTimezone; }
    } catch { /* non-fatal — just skip the tz hint */ }

    const bodyEl = document.createElement('div');

    function renderBody() {
      bodyEl.innerHTML = `
        <div class="field">
          <label>Repeats</label>
          <select id="sb-freq">
            <option value="daily"${state.freq==='daily'?' selected':''}>Daily</option>
            <option value="weekly"${state.freq==='weekly'?' selected':''}>Weekly</option>
            <option value="monthly"${state.freq==='monthly'?' selected':''}>Monthly</option>
            <option value="yearly"${state.freq==='yearly'?' selected':''}>Yearly</option>
          </select>
        </div>
        <div id="sb-weekly-row" class="field" style="${state.freq==='weekly'?'':'display:none'}">
          <label>On these days</label>
          <div class="sb-dow-row">
            ${DOW.map(d => `
              <label class="sb-dow-chip">
                <input type="checkbox" data-dow="${d.v}"${state.days.includes(d.v)?' checked':''}>
                <span>${d.label}</span>
              </label>`).join('')}
          </div>
        </div>
        <div id="sb-monthly-row" class="field" style="${state.freq==='monthly'?'':'display:none'}">
          <label>Day of month</label>
          <input id="sb-dom" type="number" min="1" max="31" value="${state.dom}" style="max-width:100px">
        </div>
        <div id="sb-yearly-row" class="grid-2" style="${state.freq==='yearly'?'':'display:none'}">
          <div class="field">
            <label>Month</label>
            <select id="sb-month">
              ${MONTHS.map((m,i) => `<option value="${i+1}"${state.month===i+1?' selected':''}>${m}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Day</label>
            <input id="sb-dom-yearly" type="number" min="1" max="31" value="${state.dom}" style="max-width:100px">
          </div>
        </div>
        <div class="field" style="max-width:160px">
          <label>Time</label>
          <input id="sb-time" type="time" value="${String(state.hour).padStart(2,'0')}:${String(state.minute).padStart(2,'0')}">
        </div>
        <p class="text-muted text-sm" style="margin-top:4px">Times are interpreted in <strong>${esc(tzLabel)}</strong> — set this under Settings → Session &amp; Retention.</p>
        <div id="sb-preview" class="field-hint" style="margin-top:10px;font-size:13px"></div>
        <div id="sb-err" class="alert alert-error hidden" style="margin-top:8px"></div>`;

      function updatePreview() {
        bodyEl.querySelector('#sb-preview').innerHTML =
          `<strong>${esc(describeCronState(state))}</strong><br><code style="font-size:11px">${esc(buildCronFromState(state))}</code>`;
      }
      updatePreview();

      bodyEl.querySelector('#sb-freq').addEventListener('change', e => {
        state.freq = e.target.value;
        bodyEl.querySelector('#sb-weekly-row').style.display  = state.freq === 'weekly'  ? '' : 'none';
        bodyEl.querySelector('#sb-monthly-row').style.display = state.freq === 'monthly' ? '' : 'none';
        bodyEl.querySelector('#sb-yearly-row').style.display  = state.freq === 'yearly'  ? '' : 'none';
        updatePreview();
      });
      bodyEl.querySelectorAll('[data-dow]').forEach(cb => {
        cb.addEventListener('change', () => {
          const v = parseInt(cb.dataset.dow, 10);
          if (cb.checked) { if (!state.days.includes(v)) state.days.push(v); }
          else             { state.days = state.days.filter(d => d !== v); }
          updatePreview();
        });
      });
      bodyEl.querySelector('#sb-dom')?.addEventListener('input', e => {
        state.dom = Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1));
        updatePreview();
      });
      bodyEl.querySelector('#sb-dom-yearly')?.addEventListener('input', e => {
        state.dom = Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1));
        updatePreview();
      });
      bodyEl.querySelector('#sb-month')?.addEventListener('change', e => {
        state.month = parseInt(e.target.value, 10);
        updatePreview();
      });
      bodyEl.querySelector('#sb-time').addEventListener('change', e => {
        const [h, m] = (e.target.value || '00:00').split(':').map(n => parseInt(n, 10));
        state.hour = Number.isNaN(h) ? 0 : h;
        state.minute = Number.isNaN(m) ? 0 : m;
        updatePreview();
      });
    }

    renderBody();

    const footEl = document.createElement('div');
    footEl.innerHTML = `
      <button id="sb-cancel" class="btn btn-ghost">Cancel</button>
      <button id="sb-apply"  class="btn btn-primary">Use this schedule</button>`;

    const { close } = openModal({ title: 'Build a Schedule', body: bodyEl, footer: footEl });

    footEl.querySelector('#sb-cancel').addEventListener('click', close);
    footEl.querySelector('#sb-apply').addEventListener('click', () => {
      if (state.freq === 'weekly' && !state.days.length) {
        const err = bodyEl.querySelector('#sb-err');
        err.textContent = 'Pick at least one day.';
        err.classList.remove('hidden');
        return;
      }
      onApply(buildCronFromState(state));
      close();
    });
  }

  // ── Event wiring ──────────────────────────────────────────────────
  function updateRenamePreview() {
    const el = document.getElementById('rename-preview');
    if (!el) return;
    const { position, format, separator, customText, customPosition, includeDate } = form.rename;
    const sep = separator ?? '_';
    let base = 'yourfile';

    if (includeDate) {
      const now = new Date();
      const Y   = now.getFullYear();
      const M   = String(now.getMonth() + 1).padStart(2, '0');
      const D   = String(now.getDate()).padStart(2, '0');
      const h   = String(now.getHours()).padStart(2, '0');
      const m   = String(now.getMinutes()).padStart(2, '0');
      const s   = String(now.getSeconds()).padStart(2, '0');
      let datePart;
      switch (format) {
        case 'YYYYMMDD':            datePart = `${Y}${M}${D}`;                   break;
        case 'YYYY-MM-DD':          datePart = `${Y}-${M}-${D}`;                 break;
        case 'YYYY-MM-DDTHH-MM-SS': datePart = `${Y}-${M}-${D}T${h}-${m}-${s}`; break;
        case 'YYYYMMDD_HHMMSS':     datePart = `${Y}${M}${D}_${h}${m}${s}`;     break;
        case 'MM-DD-YYYY':          datePart = `${M}-${D}-${Y}`;                 break;
        case 'DD-MM-YYYY':          datePart = `${D}-${M}-${Y}`;                 break;
        case 'UNIX':                datePart = String(Math.floor(now.getTime() / 1000)); break;
        case 'CYYMMDD': {
          const c = Math.floor(Y / 100) - 19;
          datePart = `${c}${String(Y).slice(2)}${M}${D}`;
          break;
        }
        default: datePart = `${Y}${M}${D}`;
      }
      base = position === 'suffix'
        ? `yourfile${sep}${datePart}`
        : `${datePart}${sep}yourfile`;
    }
    const custom = (customText || '').trim();
    if (custom) {
      base = customPosition === 'suffix'
        ? `${base}${sep}${custom}`
        : `${custom}${sep}${base}`;
    }
    el.textContent = `Preview: ${base}.csv`;
  }

  function updateZipPreview() {
    const el = document.getElementById('zip-preview');
    if (!el) return;
    if (form.zip.operation !== 'zip' || form.zip.mode !== 'bundle') return;
    const template = form.zip.bundleName || '{rulename}_{date}';
    const now = new Date();
    const Y = now.getFullYear(), M = String(now.getMonth()+1).padStart(2,'0'), D = String(now.getDate()).padStart(2,'0');
    const h = String(now.getHours()).padStart(2,'0'), m = String(now.getMinutes()).padStart(2,'0'), s = String(now.getSeconds()).padStart(2,'0');
    let datePart;
    switch (form.zip.dateFormat) {
      case 'YYYYMMDD':            datePart = `${Y}${M}${D}`;                   break;
      case 'YYYY-MM-DD':          datePart = `${Y}-${M}-${D}`;                 break;
      case 'YYYY-MM-DDTHH-MM-SS': datePart = `${Y}-${M}-${D}T${h}-${m}-${s}`; break;
      case 'YYYYMMDD_HHMMSS':     datePart = `${Y}${M}${D}_${h}${m}${s}`;     break;
      case 'MM-DD-YYYY':          datePart = `${M}-${D}-${Y}`;                 break;
      case 'DD-MM-YYYY':          datePart = `${D}-${M}-${Y}`;                 break;
      case 'UNIX':                datePart = String(Math.floor(now.getTime()/1000)); break;
      case 'CYYMMDD': { const c = Math.floor(Y/100)-19; datePart = `${c}${String(Y).slice(2)}${M}${D}`; break; }
      default:                    datePart = `${Y}${M}${D}`;
    }
    const ruleName = (document.getElementById('rb-name')?.value || form.name || 'RuleName').replace(/[^a-zA-Z0-9_\-.]/g,'-');
    const preview  = template
      .replace(/\{rulename\}/gi, ruleName)
      .replace(/\{date\}/gi,     datePart)
      .replace(/\{filename\}/gi, 'ACORD_AIG');
    el.textContent = `Preview: ${preview}.zip`;
  }

  function attachRBEvents() {
    document.getElementById('rb-back')?.addEventListener('click', () => returnFromRuleBuilder());

    // Group selector
    document.getElementById('rb-group')?.addEventListener('change', e => {
      form.groupId = e.target.value || undefined;
      const newField = document.getElementById('rb-group-new-field');
      if (newField) newField.style.display = e.target.value === '__new__' ? '' : 'none';
      if (e.target.value !== '__new__') newGroupName = '';
    });
    document.getElementById('rb-group-new-name')?.addEventListener('input', e => {
      newGroupName = e.target.value;
    });

    document.getElementById('src-profile')?.addEventListener('change', e => {
      form.source.profileId = e.target.value;
      const p = profiles.find(x => x.id === e.target.value);
      if (p) {
        form.source.path = p.path || p.remotePath || '';
        document.getElementById('src-path').value = form.source.path;
      }
    });
    document.getElementById('src-path')?.addEventListener('input',   e => { form.source.path   = e.target.value; });
    document.getElementById('src-filter')?.addEventListener('input', e => { form.source.filter = e.target.value; });
    document.getElementById('src-browse')?.addEventListener('click', () =>
      openFolderBrowser(form.source.profileId, form.source.path, p => {
        form.source.path = p;
        document.getElementById('src-path').value = p;
      }));

    document.getElementById('add-dest')?.addEventListener('click', () => {
      form.destinations.push({ profileId: '', path: '' }); renderDests();
    });

    // PGP events
    document.getElementById('pgp-operation')?.addEventListener('change', e => {
      form.pgp.operation = e.target.value;
      const isDecrypt = e.target.value !== 'encrypt';
      const isEncrypt = e.target.value !== 'decrypt';
      const dr = document.getElementById('pgp-decrypt-row');
      const er = document.getElementById('pgp-encrypt-row');
      if (dr) dr.style.display = isDecrypt ? '' : 'none';
      if (er) er.style.display = isEncrypt ? '' : 'none';
    });
    document.getElementById('pgp-on-fail')?.addEventListener('change', e => { form.pgp.onFailure = e.target.value; });
    document.getElementById('pgp-decrypt-key')?.addEventListener('change', e => { form.pgp.decryptKeyId = e.target.value; });
    document.getElementById('pgp-encrypt-key-add')?.addEventListener('change', e => {
      const v = e.target.value;
      if (v && !form.pgp.encryptKeyIds.includes(v)) {
        form.pgp.encryptKeyIds.push(v);
        renderPgpEncryptKeys();
      }
      e.target.value = '';
    });
    document.getElementById('pgp-sign-key')?.addEventListener('change', e => { form.pgp.signKeyId = e.target.value; });

    // Rename events
    document.getElementById('rename-position')?.addEventListener('change', e => { form.rename.position = e.target.value; updateRenamePreview(); });
    document.getElementById('rename-format')?.addEventListener('change',   e => { form.rename.format   = e.target.value; updateRenamePreview(); });
    document.getElementById('rename-separator')?.addEventListener('input', e => { form.rename.separator = e.target.value; updateRenamePreview(); });
    document.getElementById('rename-custom-text')?.addEventListener('input', e => { form.rename.customText = e.target.value; updateRenamePreview(); });
    document.getElementById('rename-custom-position')?.addEventListener('change', e => { form.rename.customPosition = e.target.value; updateRenamePreview(); });

    // Zip events
    document.getElementById('zip-operation')?.addEventListener('change', e => {
      form.zip.operation = e.target.value;
      const isZip    = e.target.value === 'zip';
      const isBundle = isZip && form.zip.mode === 'bundle';
      document.getElementById('zip-mode-field').style.display    = isZip    ? '' : 'none';
      document.getElementById('zip-bundle-fields').style.display = isBundle ? '' : 'none';
      document.getElementById('zip-level-field').style.display   = isZip    ? '' : 'none';
      updateZipPreview();
    });
    document.getElementById('zip-mode')?.addEventListener('change', e => {
      form.zip.mode = e.target.value;
      document.getElementById('zip-bundle-fields').style.display = e.target.value === 'bundle' ? '' : 'none';
      updateZipPreview();
    });
    document.getElementById('zip-bundle-name')?.addEventListener('input',  e => { form.zip.bundleName = e.target.value; updateZipPreview(); });
    document.getElementById('zip-date-format')?.addEventListener('change', e => { form.zip.dateFormat = e.target.value; updateZipPreview(); });
    document.getElementById('zip-separator')?.addEventListener('input',    e => { form.zip.separator  = e.target.value; updateZipPreview(); });
    document.getElementById('zip-level')?.addEventListener('input', e => {
      form.zip.level = +e.target.value;
      const lv = document.getElementById('zip-level-val');
      if (lv) lv.textContent = e.target.value;
    });

    // Date Filter events
    document.getElementById('df-field')?.addEventListener('change', e => { form.dateFilter.field = e.target.value; });
    document.getElementById('df-mode')?.addEventListener('change', e => {
      form.dateFilter.mode = e.target.value;
      document.getElementById('df-within-field').style.display = e.target.value === 'sinceDate' ? 'none' : '';
      document.getElementById('df-since-field').style.display  = e.target.value === 'sinceDate' ? '' : 'none';
      const withinLabel = document.getElementById('df-within-label');
      if (withinLabel) {
        withinLabel.textContent = e.target.value === 'olderThanDays'
          ? 'Delete files older than N days'
          : 'Within the last N days';
      }
    });
    document.getElementById('df-within-days')?.addEventListener('input', e => { form.dateFilter.withinDays = +e.target.value || 1; });
    document.getElementById('df-since-date')?.addEventListener('input',  e => { form.dateFilter.sinceDate  = e.target.value; });

    document.getElementById('opt-action')  ?.addEventListener('change', e => {
      form.action = e.target.value;
      const hideForDelete = e.target.value === 'delete' ? 'none' : '';
      ['dest-section', 'pgp-section', 'rename-section', 'zip-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = hideForDelete;
      });
    });
    document.getElementById('opt-conflict') ?.addEventListener('change', e => { form.onConflict= e.target.value; });
    document.getElementById('opt-error')   ?.addEventListener('change', e => {
      form.onError = e.target.value;
      document.getElementById('retry-field').style.display = e.target.value === 'retry' ? '' : 'none';
    });
    document.getElementById('opt-retry')?.addEventListener('input', e => { form.retryCount = +e.target.value || 3; });
    document.getElementById('sched-preset')?.addEventListener('change', e => {
      syncCronField();
      // Jump straight into the builder the moment someone picks "Custom…" —
      // nobody has to already know cron syntax to get started.
      if (e.target.value === '__custom__') {
        const cronInp = document.getElementById('sched-cron');
        openScheduleBuilderModal(cronInp?.value || '', cron => { if (cronInp) cronInp.value = cron; });
      }
    });
    document.getElementById('sched-build-btn')?.addEventListener('click', () => {
      const cronInp = document.getElementById('sched-cron');
      openScheduleBuilderModal(cronInp?.value || '', cron => { if (cronInp) cronInp.value = cron; });
    });

    document.getElementById('rb-tag-add')?.addEventListener('click', () => {
      const k = document.getElementById('rb-tag-key')?.value.trim();
      const v = document.getElementById('rb-tag-val')?.value.trim();
      if (!k || !v) return;
      const tag = `${k}:${v}`;
      if (!form.tags.includes(tag)) form.tags.push(tag);
      document.getElementById('rb-tag-val').value = '';
      renderTags();
    });

    document.querySelectorAll('.preset-chip').forEach(c =>
      c.addEventListener('click', () => {
        const inp = document.getElementById('src-filter');
        if (inp) { inp.value = c.dataset.p; form.source.filter = c.dataset.p; }
      }));

    // Quick profiles
    document.querySelectorAll('.quick-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.qp-dropdown').forEach(d => d.remove());
        const dd = document.createElement('div');
        dd.className = 'qp-dropdown';
        dd.innerHTML = `<button class="qp-opt" data-a="src">Set as Source</button>
                        <button class="qp-opt" data-a="dst">Add as Destination</button>`;
        btn.parentElement.style.position = 'relative';
        btn.after(dd);

        const pid  = btn.dataset.id || '';
        const path = btn.dataset.path;

        dd.querySelector('[data-a="src"]').addEventListener('click', () => {
          form.source.profileId = pid;
          if (!form.source.path) form.source.path = path;
          dd.remove(); render();
        });
        dd.querySelector('[data-a="dst"]').addEventListener('click', () => {
          const slot = form.destinations.find(d => !d.profileId && !d.path);
          if (slot) { slot.profileId = pid; slot.path = slot.path || path; }
          else form.destinations.push({ profileId: pid, path });
          dd.remove(); renderDests();
        });
        const dismiss = e => { if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', dismiss); } };
        setTimeout(() => document.addEventListener('click', dismiss), 0);
      });
    });

    // Save
    document.getElementById('rb-save')?.addEventListener('click', async () => {
      const name = document.getElementById('rb-name')?.value.trim();
      if (!name) { alert('Rule name is required.'); return; }
      const cronVal  = document.getElementById('sched-cron')?.value.trim();
      const presetV  = document.getElementById('sched-preset')?.value;
      const cron     = presetV === 'manual' ? 'manual'
        : presetV === '__custom__' ? (cronVal || 'manual')
        : (presetV || 'manual');

      // Resolve group — create new group first if needed
      let resolvedGroupId = form.groupId && form.groupId !== '__new__' ? form.groupId : undefined;
      if (form.groupId === '__new__') {
        const gName = (document.getElementById('rb-group-new-name')?.value || newGroupName).trim();
        if (!gName) { alert('Group name is required when "New group…" is selected.'); return; }
        const btn = document.getElementById('rb-save');
        btn.disabled = true; btn.textContent = 'Creating group…';
        try {
          const newGroup = await API.postJSON('/api/groups', { name: gName, tags: [] });
          resolvedGroupId = newGroup.id;
        } catch (err) {
          alert(`Failed to create group: ${err.message}`);
          btn.disabled = false; btn.textContent = 'Save rule';
          return;
        }
      }

      const actionVal = document.getElementById('opt-action')?.value || 'copy';
      const payload = {
        ...form,
        name,
        source: {
          profileId: document.getElementById('src-profile')?.value || '',
          path:      document.getElementById('src-path')?.value    || '',
          filter:    document.getElementById('src-filter')?.value  || '',
          recursive: form.source.recursive,
        },
        action:       actionVal,
        destinations: actionVal === 'delete' ? [] : form.destinations,
        onConflict: document.getElementById('opt-conflict')?.value || 'overwrite',
        onError:    document.getElementById('opt-error')?.value    || 'continue',
        retryCount: +(document.getElementById('opt-retry')?.value  || 3),
        cron, verifySize: form.verifySize, tags: form.tags,
        chainOnSuccess: form.chainOnSuccess, chainOnFailure: form.chainOnFailure,
        groupId: resolvedGroupId,
        dateFilter: form.dateFilter.enabled ? {
          field:      form.dateFilter.field,
          mode:       form.dateFilter.mode,
          withinDays: form.dateFilter.withinDays,
          sinceDate:  form.dateFilter.sinceDate || undefined,
        } : null,
      };

      const btn = document.getElementById('rb-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (ruleId) await API.putJSON(`/api/rules/${ruleId}`, payload);
        else        await API.postJSON('/api/rules', payload);
        returnFromRuleBuilder();
      } catch (err) {
        alert(`Save failed: ${err.message}`);
        btn.disabled = false; btn.textContent = 'Save rule';
      }
    });

    // Run now
    document.getElementById('rb-run')?.addEventListener('click', async () => {
      const btn = document.getElementById('rb-run');
      btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';
      try {
        const res = await API.postJSON(`/api/rules/${ruleId}/run`);
        runResult = { ok: res?.status === 'success' || res?.status === 'partial',
          msg: `Run ${res?.status}: ${res?.filesTransferred??0} files · ${fmtBytes(res?.bytesTransferred)}` };
      } catch (err) {
        runResult = { ok: false, msg: `Run failed: ${err.message}` };
      } finally {
        btn.disabled = false; btn.innerHTML = `${ICON.play} Run now`;
        const ra = el.querySelector('.alert');
        if (ra) { ra.className = `alert ${runResult.ok?'alert-success':'alert-error'}`; ra.textContent = runResult.msg; }
        else render();
      }
    });
  }

  loadData();
};

// ════════════════════════════════════════════════════════════════════════
//  SHARED UI HELPERS
// ════════════════════════════════════════════════════════════════════════

function renderPlaceholder(el, iconKey, msg) {
  el.innerHTML = `
    <div class="placeholder-view">
      <div class="ph-icon">${ICON[iconKey] || ''}</div>
      <h2>${VIEW_TITLES[iconKey] || iconKey}</h2>
      <p>${msg}</p>
    </div>`;
}

/** Escape HTML special chars to prevent XSS. */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Small inline "copy" icon button for long/truncated text cells (paths,
 * etc.) — click copies the raw (untruncated) value to the clipboard and
 * flashes a checkmark. `text` is embedded as an HTML attribute so callers
 * don't need to wire up their own click handler; delegated once globally
 * below via document-level listener on [data-copy].
 */
function copyBtnHTML(text) {
  if (!text) return '';
  return `<button type="button" class="btn-copy" data-copy="${esc(text)}" title="Copy to clipboard">${ICON.copy}</button>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.dataset.copy;
  const done = () => {
    const prev = btn.innerHTML;
    btn.innerHTML = ICON.check;
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {});
  } else {
    // Fallback for non-secure contexts / older environments
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    document.body.removeChild(ta);
  }
});

/** Read query params from the current hash fragment (#view?key=val). */
function getHashParams() {
  const q = location.hash.indexOf('?');
  return q === -1 ? new URLSearchParams() : new URLSearchParams(location.hash.slice(q + 1));
}

/** Replace the query params in the current hash fragment without changing view. */
function setHashParams(params) {
  const view = location.hash.slice(1).split('?')[0];
  const str  = params.toString();
  history.replaceState(null, '', `#${view}${str ? '?' + str : ''}`);
}

/** Render a toggle switch: <label class="toggle">... */
function makeToggle(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'toggle';
  label.innerHTML = `
    <input type="checkbox" ${checked ? 'checked' : ''}>
    <span class="toggle-track"></span>`;
  label.querySelector('input').addEventListener('change', e => onChange(e.target.checked));
  return label;
}

/** Open a simple modal. Returns { el, close }. */
function openModal({ title, body, footer, size = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal ${size ? 'modal-' + size : ''}">
      <div class="modal-header">
        <span class="modal-title">${title || ''}</span>
        <button class="modal-close" aria-label="Close">${ICON.close}</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-footer"></div>` : ''}
    </div>`;

  if (typeof body === 'string') {
    overlay.querySelector('.modal-body').innerHTML = body;
  } else if (body instanceof Node) {
    overlay.querySelector('.modal-body').appendChild(body);
  }

  if (footer) {
    const fEl = overlay.querySelector('.modal-footer');
    if (typeof footer === 'string') fEl.innerHTML = footer;
    else if (footer instanceof Node) fEl.appendChild(footer);
  }

  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return { el: overlay, close };
}

/** Folder browser modal — lets the user pick a directory on a profile. */
async function openFolderBrowser(profileId, startPath, onSelect) {
  if (!profileId) { alert('Select a profile first.'); return; }
  const profRes = await API.get('/api/profiles');
  if (!profRes) return;
  const profiles = await profRes.json();
  const prof = profiles.find(p => p.id === profileId);
  if (!prof) return;

  let browsePath = startPath || prof.remotePath || prof.path || '/';
  const bodyEl   = document.createElement('div');

  async function loadListing() {
    bodyEl.innerHTML = '<div class="loading-center" style="min-height:140px"><div class="spinner"></div></div>';
    try {
      const res = await API.get(`/api/profiles/${profileId}/browse?path=${encodeURIComponent(browsePath)}`);
      if (!res) return;
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error(raw.error || 'Invalid response');

      const dirs  = raw.filter(e => e.type === 'directory').sort((a,b)=>a.name.localeCompare(b.name));
      const files = raw.filter(e => e.type !== 'directory') .sort((a,b)=>a.name.localeCompare(b.name));

      bodyEl.innerHTML = `
        <div class="fb-path-bar">
          <code class="fb-path-text">${esc(browsePath)}</code>
          <button id="fb-up" class="btn btn-ghost btn-sm">${ICON.arrowUp} Up</button>
        </div>
        <div class="fb-list">
          ${dirs.map(e=>`<div class="fb-entry fb-dir" data-name="${esc(e.name)}">${ICON.folder} <span>${esc(e.name)}</span></div>`).join('')}
          ${files.map(e=>`<div class="fb-entry fb-file">${ICON.file} <span>${esc(e.name)}</span><span class="fb-size">${fmtBytes(e.size)}</span></div>`).join('')}
          ${!dirs.length && !files.length ? '<div class="fb-empty text-muted text-sm">Empty folder</div>' : ''}
        </div>`;

      document.getElementById('fb-up')?.addEventListener('click', () => {
        const has  = browsePath.includes('\\');
        const sep  = has ? '\\' : '/';
        const trim = browsePath.replace(/[/\\]+$/, '');
        const up   = trim.slice(0, Math.max(trim.lastIndexOf('/'), trim.lastIndexOf('\\')));
        if (up && up !== trim) { browsePath = up; loadListing(); }
      });

      bodyEl.querySelectorAll('.fb-dir').forEach(row => {
        row.addEventListener('click', () => {
          bodyEl.querySelectorAll('.fb-entry').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
        });
        row.addEventListener('dblclick', () => {
          const sep  = browsePath.includes('\\') ? '\\' : '/';
          browsePath = browsePath.replace(/[/\\]+$/, '') + sep + row.dataset.name;
          loadListing();
        });
      });
    } catch (err) {
      bodyEl.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  const footEl = document.createElement('div');
  footEl.innerHTML = `
    <button id="fb-cancel" class="btn btn-ghost">Cancel</button>
    <button id="fb-select" class="btn btn-primary">Select this folder</button>`;

  const { close } = openModal({ title: `Browse — ${esc(prof.name)}`, body: bodyEl, footer: footEl, size: 'lg' });
  await loadListing();

  footEl.querySelector('#fb-cancel').addEventListener('click', close);
  footEl.querySelector('#fb-select').addEventListener('click', () => { onSelect(browsePath); close(); });
}

/** Format bytes to human-readable string. */
function fmtBytes(n) {
  if (!n || n < 1024) return `${n ?? 0} B`;
  if (n < 1048576)    return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Format a duration in ms to human-readable. */
function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/** Format ISO timestamp to local string. */
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Render a status badge element. Pass subStatus for idle runs. */
function statusBadge(status, subStatus) {
  if (status === 'success' && subStatus === 'idle') {
    return `<span class="badge badge-muted">Idle</span>`;
  }
  const map = {
    success:  ['badge-success', 'Success'],
    failed:   ['badge-danger',  'Failed'],
    running:  ['badge-accent',  'Running'],
    partial:  ['badge-warn',    'Partial'],
    skipped:  ['badge-muted',   'Skipped'],
    disabled: ['badge-muted',   'Disabled'],
    enabled:  ['badge-success', 'Enabled'],
  };
  const [cls, label] = map[status] || ['badge-muted', status || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════

async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      app.user = await res.json();
      hideLogin();
      bootApp();
      return;
    }
  } catch { /* network error — show login */ }
  showLogin();
}

document.addEventListener('DOMContentLoaded', init);
