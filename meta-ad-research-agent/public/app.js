// AdIntel — single-page app. Vanilla JS, no build step.
const app = document.getElementById('app');

// ── tiny DOM helper ───────────────────────────────────────────────────────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}
const icon = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  verified: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 1.8 3 .2.9 2.8 2.4 1.8-.9 2.9.9 2.8-2.4 1.8-.9 2.9-3 .1L12 22l-2.4-1.8-3-.1-.9-2.9L3.3 15l.9-2.8-.9-2.9 2.4-1.8.9-2.8 3-.2z"/><path d="M10.6 14.6l-2.1-2.1-1.1 1.1 3.2 3.2 5.3-5.3-1.1-1.1z" fill="#fff"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>',
  alert: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
};
const confClass = (pct) => (pct > 95 ? 'high' : pct >= 70 ? 'medium' : pct >= 40 ? 'low' : 'none');
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) { let m = 'Request failed'; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
  return res.json();
}
function mount(node) { app.replaceChildren(node); window.scrollTo(0, 0); }

// ── ephemeral flow state (search → resolve → progress) ─────────────────────
let flow = null; // { query, search }

// ── Screen 1 & 2: Landing + Search ─────────────────────────────────────────
function viewHome() {
  const input = h('input', { type: 'text', placeholder: 'Search a company…  e.g. Nike', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Company name' });
  const btn = h('button', { class: 'btn btn-primary', onclick: () => go() }, 'Analyze', h('span', { html: icon.arrow }));
  const go = () => { const q = input.value.trim(); if (q) startSearch(q); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  const chip = (name) => h('button', { class: 'chip', onclick: () => { input.value = name; startSearch(name); } }, name);

  const v = h('div', { class: 'view center-narrow' },
    h('section', { class: 'hero' },
      h('div', { class: 'eyebrow' }, h('span', { class: 'dot' }), 'Public Meta Ad Library data · no login required'),
      h('h1', {}, 'See any competitor’s ', h('span', { class: 'grad' }, 'entire ad strategy'), '.'),
      h('p', { class: 'lede' }, 'Type a company name. Get a McKinsey-grade briefing of the ads they’re running right now — hooks, offers, winning creatives, and how to beat them.'),
      h('div', { class: 'searchbar' }, h('span', { style: 'display:grid;place-items:center;padding-left:8px;color:var(--text-3)', html: icon.search }), input, btn),
      h('div', { class: 'examples' }, h('span', { class: 'lbl' }, 'Try'), chip('Nike'), chip('Duolingo'), chip('Notion'), chip('Chewy')),
      h('div', { class: 'trust-row' },
        h('span', {}, h('span', { html: icon.check, style: 'color:var(--green);display:grid' }), 'Never analyzes the wrong company'),
        h('span', {}, h('span', { html: icon.check, style: 'color:var(--green);display:grid' }), 'Deduplicates every creative'),
        h('span', {}, h('span', { html: icon.check, style: 'color:var(--green);display:grid' }), 'No fabricated metrics'),
      ),
    ),
  );
  mount(v);
  setTimeout(() => input.focus(), 50);
}

async function startSearch(query) {
  mount(h('div', { class: 'view center-narrow' },
    h('section', { class: 'hero' },
      h('div', { class: 'searchbar', style: 'pointer-events:none;opacity:.7' }, h('span', { style: 'display:grid;place-items:center;padding-left:8px', html: '<div class=spinner></div>' }), h('input', { value: query, disabled: true })),
      h('p', { class: 'muted', style: 'text-align:center;margin-top:24px' }, 'Finding “', query, '” in the Meta Ad Library…'),
    ),
  ));
  let res, data;
  try {
    res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    data = await res.json();
  } catch {
    return viewSourceError(query, 'Could not reach the AdIntel server. Is it still running?', false);
  }
  if (!res.ok) {
    return viewSourceError(query, data.error || 'Search failed.', data.kind === 'meta-unreachable');
  }
  flow = { query, search: data };
  viewResolve();
}

// Honest failure screen — shown when the real data source can't be reached.
function viewSourceError(query, message, metaUnreachable) {
  mount(h('div', { class: 'view' },
    h('div', { class: 'page-head' }, h('div', { class: 'kicker' }, 'Advertiser resolution'), h('h2', {}, 'Results for “', query, '”')),
    h('div', { class: 'refuse' },
      h('div', { class: 'icon', html: icon.alert }),
      h('h3', {}, metaUnreachable ? 'Couldn’t reach the Meta Ad Library' : 'Something went wrong'),
      h('p', {}, message),
      h('div', { style: 'margin-top:20px;display:flex;gap:10px;justify-content:center' },
        h('button', { class: 'btn btn-primary', onclick: () => startSearch(query) }, 'Try again'),
        h('button', { class: 'btn btn-ghost', onclick: () => viewHome() }, 'New search'),
      ),
    ),
  ));
}

// ── Screen 3: Smart Advertiser Resolution ──────────────────────────────────
function advCardEl(c, onPick) {
  const cc = confClass(c.confidencePct);
  return h('button', { class: `adv-card ${cc}`, onclick: () => onPick(c) },
    h('div', { class: 'top' },
      h('div', { class: 'name' }, c.name, c.verified ? h('span', { class: 'verified', html: icon.verified, title: 'Verified' }) : null),
      h('div', { class: 'cpct' }, c.confidencePct + '%'),
    ),
    h('div', { class: 'row2' }, [c.industry, c.website].filter(Boolean).join(' · ') || 'Advertiser page'),
    c.reasons && c.reasons.length ? h('div', { class: 'why' }, '“' + c.reasons.slice(0, 2).join(', ') + '”') : null,
  );
}

function viewResolve() {
  const { query, search } = flow;
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'kicker' }, 'Advertiser resolution'), h('h2', {}, 'Results for “', query, '”')),
  );

  let body;
  if (search.outcome === 'refuse') {
    body = h('div', { class: 'refuse' },
      h('div', { class: 'icon', html: icon.alert }),
      h('h3', {}, 'No confident match'),
      h('p', {}, search.message || 'We couldn’t confidently identify this advertiser, so we didn’t analyze anything — better than profiling the wrong company.'),
      h('div', { style: 'margin-top:20px' }, h('button', { class: 'btn btn-ghost', onclick: () => viewHome() }, 'Try another search')),
    );
  } else if (search.outcome === 'auto') {
    const chosen = search.candidates.find((c) => c.pageId === search.chosenPageId);
    const alts = search.candidates.filter((c) => c.pageId !== search.chosenPageId);
    const cc = confClass(chosen.confidencePct);
    const altWrap = h('div', { class: 'cards-grid', style: 'display:none' }, ...alts.map((c) => advCardEl(c, pick)));
    body = h('div', {},
      h('div', { class: 'adv-hero' },
        h('div', { class: 'avatar' }, initial(chosen.name)),
        h('div', { class: 'meta' },
          h('div', { class: 'name' }, chosen.name, chosen.verified ? h('span', { class: 'verified', html: icon.verified }) : null),
          h('div', { class: 'sub' }, [chosen.industry, chosen.website].filter(Boolean).join(' · ') || 'Advertiser page'),
          chosen.reasons && chosen.reasons.length ? h('div', { class: 'why' }, 'Matched: ' + chosen.reasons.slice(0, 3).join(', ')) : null,
        ),
        h('div', { class: `conf ${cc}` }, h('div', { class: 'pct' }, chosen.confidencePct + '%'), h('div', { class: 'lbl' }, 'confidence')),
      ),
      h('div', { class: 'adv-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => startAnalysis(chosen) }, 'Analyze ' + chosen.name, h('span', { html: icon.arrow })),
        alts.length ? h('button', { class: 'reveal-alts', onclick: (e) => { const s = altWrap.style; s.display = s.display === 'none' ? 'grid' : 'none'; e.target.textContent = s.display === 'none' ? 'Not right? Choose another' : 'Hide alternatives'; } }, 'Not right? Choose another') : null,
      ),
      altWrap,
    );
  } else {
    body = h('div', {},
      h('p', { class: 'muted', style: 'margin-top:-4px' }, 'Multiple companies match. Pick the one you meant.'),
      h('div', { class: 'cards-grid' }, ...search.candidates.map((c) => advCardEl(c, pick))),
      h('div', { style: 'margin-top:20px' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => viewHome() }, 'None of these — search again')),
    );
  }
  function pick(c) { if (c.confidencePct < 40) { toast('That looks like an impersonator — pick a stronger match.'); return; } startAnalysis(c); }

  mount(h('div', { class: 'view' }, head, body));
}

// ── Screen 4: Analysis Progress (real SSE) ─────────────────────────────────
const STEPS = [
  ['resolving', 'Confirming advertiser'],
  ['collecting', 'Collecting active ads'],
  ['deduplicating', 'Deduplicating creatives'],
  ['analyzing', 'Running AI analysis'],
  ['reporting', 'Building executive report'],
];

function startAnalysis(chosen) {
  const stepEls = {};
  const steps = h('div', { class: 'steps' },
    ...STEPS.map(([key, title]) => {
      const ic = h('div', { class: 'ic', html: icon.check });
      const detail = h('div', { class: 'detail' });
      stepEls[key] = { row: h('div', { class: 'step' }, ic, h('div', { class: 'txt' }, h('div', { class: 'title' }, title), detail)), ic, detail };
      return stepEls[key].row;
    }),
  );
  mount(h('div', { class: 'view' },
    h('div', { class: 'progress-wrap' },
      h('h2', {}, 'Analyzing ', chosen.name),
      h('p', { class: 'psub' }, 'Reading their live Meta ads and building your briefing.'),
      steps,
    ),
  ));

  const params = new URLSearchParams({ query: flow.query, pageId: chosen.pageId, name: chosen.name });
  const isAuto = flow.search.outcome === 'auto' && flow.search.chosenPageId === chosen.pageId;
  params.set('method', isAuto ? 'auto' : 'user');
  if (chosen.website) params.set('website', chosen.website);
  if (chosen.industry) params.set('industry', chosen.industry);
  if (chosen.verified) params.set('verified', '1');

  const es = new EventSource('/api/analyze/stream?' + params.toString());
  let failed = false;
  es.addEventListener('progress', (ev) => {
    const { stage, status, detail } = JSON.parse(ev.data);
    const s = stepEls[stage]; if (!s) return;
    if (status === 'active') { s.row.classList.add('active'); s.ic.innerHTML = '<div class="spinner"></div>'; }
    else { s.row.classList.remove('active'); s.row.classList.add('done'); s.ic.innerHTML = icon.check; }
    if (detail) s.detail.textContent = detail;
  });
  es.addEventListener('done', (ev) => { es.close(); const { reportId } = JSON.parse(ev.data); location.hash = `#/report/${reportId}`; });
  es.addEventListener('error', (ev) => {
    failed = true; es.close();
    let msg = 'Analysis failed. Please try again.';
    try { if (ev.data) msg = JSON.parse(ev.data).message; } catch {}
    viewAnalysisError(chosen, msg);
  });
  // Network drop / server gone: EventSource fires a generic error with no data.
  es.onerror = () => { if (!failed && es.readyState === EventSource.CLOSED) { es.close(); viewAnalysisError(chosen, 'Lost connection to the AdIntel server during analysis.'); } };
}

function viewAnalysisError(chosen, message) {
  mount(h('div', { class: 'view' },
    h('div', { class: 'refuse', style: 'margin-top:56px' },
      h('div', { class: 'icon', html: icon.alert }),
      h('h3', {}, 'Analysis couldn’t finish'),
      h('p', {}, message),
      h('div', { style: 'margin-top:20px;display:flex;gap:10px;justify-content:center' },
        h('button', { class: 'btn btn-primary', onclick: () => startAnalysis(chosen) }, 'Try again'),
        h('button', { class: 'btn btn-ghost', onclick: () => viewHome() }, 'New search'),
      ),
    ),
  ));
}

// ── Screen 5: Executive Report ─────────────────────────────────────────────
function barTable(rows) {
  const max = Math.max(1, ...rows.map((r) => r.ads));
  return h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Volume'), h('th', { class: 'num' }, 'Ads'), h('th', { class: 'num' }, 'Share'))),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', {}, r.label),
      h('td', { class: 'bar-cell' }, h('div', { class: 'bar' }, h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round((r.ads / max) * 100)}%` })))),
      h('td', { class: 'num' }, String(r.ads)),
      h('td', { class: 'num' }, r.adSharePct + '%'),
    ))),
  );
}
function paras(text) { return (text || '').split(/\n{2,}/).map((p) => h('p', { html: mdInline(p) })); }
function mdInline(s) { return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function section(num, title, bodyNode) {
  return h('div', { class: 'section' }, h('h3', {}, num ? h('span', { class: 'n' }, num) : null, title), h('div', { class: 'body' }, bodyNode));
}

async function viewReport(id) {
  mount(h('div', { class: 'view' }, h('div', { class: 'stat-row', style: 'margin-top:60px' }, ...Array.from({ length: 4 }, () => h('div', { class: 'stat skeleton', style: 'height:92px' })))));
  let data;
  try { data = await api(`/api/reports/${id}`); } catch (e) { toast(e.message); location.hash = '#/'; return; }
  const v = data.view; const r = v.report; const rel = v.reliability; const hd = v.headline;

  const relColor = (n) => (n >= 80 ? 'var(--green)' : n >= 55 ? 'var(--amber)' : 'var(--text-3)');
  const volumeNote = hd.metaReportedApprox
    ? `Meta’s Ad Library reports ≈${hd.metaReportedApprox} results for this page (Meta’s own approximate figure).`
    : 'Total active-ad count isn’t independently verifiable, so no total is claimed — only the counts above, which we verified by direct count.';

  const el = h('div', { class: 'view' },
    h('a', { class: 'back-link', href: '#/reports', 'data-nav': '' }, h('span', { html: icon.back }), 'All reports'),
    h('div', { class: 'report-head' },
      h('div', { class: 'report-title' },
        h('div', { class: 'kicker' }, 'Competitive Intelligence Briefing'),
        h('h1', {}, v.advertiser.name, v.advertiser.verified ? h('span', { class: 'verified', html: icon.verified }) : null),
        h('div', { class: 'sub' }, [v.advertiser.industry, v.advertiser.website].filter(Boolean).join(' · '), ' · ', new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })),
      ),
      h('div', { class: 'report-actions' },
        h('a', { class: 'btn btn-ghost btn-sm', href: `/api/reports/${id}/csv` }, h('span', { html: icon.download }), 'CSV'),
        h('a', { class: 'btn btn-primary btn-sm', href: `/api/reports/${id}/pdf` }, h('span', { html: icon.download }), 'PDF'),
      ),
    ),

    h('div', { class: 'stat-row' },
      stat('Ads collected', String(hd.collectedAds)),
      stat('Unique creatives', String(hd.uniqueCreatives)),
      stat('Top creative', hd.topCreative ? h('span', {}, String(hd.topCreative.duplicateCount), h('small', {}, ' ads')) : '—'),
      stat('Confidence', h('span', {}, String(rel.overall), h('small', {}, '/100'))),
    ),
    h('div', { class: 'callout' },
      h('span', { html: `<strong>${hd.collectedAds} ads → ${hd.uniqueCreatives} unique creatives.</strong> ` + escapeHtml(volumeNote) }),
      h('span', { class: 'cap' }, 'Public data only — spend, reach, CTR, and audience targeting are not exposed by the Ad Library and are never estimated.'),
    ),
  );

  const secs = r
    ? [
        section('1', 'Executive Summary', h('div', {}, ...paras(r.executiveSummary))),
        h('div', { class: 'section insight-lead' }, h('h3', {}, h('span', { class: 'n' }, '2'), 'Biggest Strategic Insight'), h('div', { class: 'body' }, ...paras(r.biggestStrategicInsight))),
        section('3', 'Messaging Strategy', h('div', {}, ...paras(r.messagingStrategy))),
        section('4', 'Creative Winners', h('div', {}, v.winners.length ? winnersTable(v.winners) : h('p', { class: 'muted' }, 'No creatives.'), ...paras(r.creativeWinners))),
        section('5', 'Hook Distribution', h('div', {}, ...paras(r.hookDistribution), v.hooks.length ? barTable(v.hooks) : null)),
        section('6', 'Offer Distribution', h('div', {}, ...paras(r.offerDistribution), v.offers.length ? barTable(v.offers) : null)),
        section('7', 'Competitive Weaknesses', h('div', {}, ...paras(r.competitiveWeaknesses))),
        section('8', 'Counter Strategy', h('div', {}, ...paras(r.counterStrategy))),
        section('9', 'Recommendations', h('div', {}, ...paras(r.actionItems))),
      ]
    : [
        section('', 'Creative Winners', h('div', {}, v.winners.length ? winnersTable(v.winners) : h('p', { class: 'muted' }, 'No creatives.'))),
        v.hooks.length ? section('', 'Hook Distribution', barTable(v.hooks)) : null,
        h('div', { class: 'section' }, h('h3', {}, 'AI narrative'), h('div', { class: 'body muted' }, v.reportError || 'Not generated.')),
      ];
  secs.push(reliabilitySection(rel, relColor));
  el.append(...secs.filter(Boolean));
  mount(el);
}

function stat(k, v) { return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
function winnersTable(winners) {
  return h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, h('th', { class: 'rank' }, '#'), h('th', {}, 'Creative'), h('th', { class: 'num' }, 'Ads'), h('th', { class: 'num' }, 'Runtime'), h('th', { class: 'num' }, 'Type'))),
    h('tbody', {}, ...winners.map((w) => h('tr', {},
      h('td', { class: 'rank' }, String(w.rank)),
      h('td', {}, w.headline || '—'),
      h('td', { class: 'num' }, String(w.duplicateCount)),
      h('td', { class: 'num' }, (w.runtimeDays != null ? w.runtimeDays + 'd' : '—')),
      h('td', { class: 'num' }, w.creativeType),
    ))),
  );
}
function reliabilitySection(rel, relColor) {
  const cell = (k, val, measured = true) => h('div', { class: 'rel' },
    h('div', { class: 'k' }, k),
    h('div', { class: 'v' }, measured ? val + '' : 'N/A'),
    h('div', { class: 'meter' }, h('i', { style: `width:${measured ? val : 0}%;background:${relColor(measured ? val : 0)}` })),
  );
  return h('div', { class: 'section' },
    h('h3', {}, 'Reliability'),
    h('div', { class: 'rel-grid' },
      cell('Overall', rel.overall),
      cell('Advertiser', rel.advertiserConfidence),
      cell('Data completeness', rel.dataCompleteness),
      cell('Coverage', rel.coverage, rel.coverageMeasured),
      cell('Creative coverage', rel.creativeCoverage),
    ),
    rel.missingDataExplanations && rel.missingDataExplanations.length
      ? h('ul', { class: 'rel-notes' }, ...rel.missingDataExplanations.map((e) => h('li', {}, e)))
      : null,
  );
}

// ── Screen 6: Saved Reports ────────────────────────────────────────────────
async function viewReports() {
  setActiveNav();
  mount(h('div', { class: 'view' }, h('div', { class: 'page-head' }, h('div', { class: 'kicker' }, 'Library'), h('h2', {}, 'Saved reports')), h('div', { class: 'report-list' }, ...Array.from({ length: 3 }, () => h('div', { class: 'skeleton', style: 'height:72px' })))));
  let reports = [];
  try { reports = (await api('/api/reports')).reports; } catch (e) { toast(e.message); }

  const list = reports.length
    ? h('div', { class: 'report-list' }, ...reports.map((r) => h('a', { class: 'report-item', href: `#/report/${r.id}`, 'data-nav': '' },
        h('div', { class: 'avatar' }, initial(r.advertiserName)),
        h('div', { class: 'ri-main' },
          h('div', { class: 'ri-name' }, r.advertiserName),
          h('div', { class: 'ri-sub' }, `${r.collectedAds} ads → ${r.uniqueCreatives} creatives · ${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`),
        ),
        h('div', { class: 'ri-stat' }, h('b', {}, r.overall + '/100'), h('br'), 'confidence'),
        h('span', { class: 'muted', html: icon.arrow }),
      )))
    : h('div', { class: 'empty' }, h('h3', {}, 'No reports yet'), h('p', {}, 'Run your first competitor analysis to see it here.'), h('div', { style: 'margin-top:18px' }, h('a', { class: 'btn btn-primary', href: '#/', 'data-nav': '' }, 'New search')));

  mount(h('div', { class: 'view' },
    h('div', { class: 'page-head' }, h('div', { class: 'kicker' }, 'Library'), h('h2', {}, 'Saved reports'), h('p', {}, 'Every analysis you run is saved here. Revisit, download, or compare.')),
    list,
  ));
}

// ── Router ─────────────────────────────────────────────────────────────────
function setActiveNav() {
  const el = document.getElementById('nav-reports');
  if (el) el.style.color = location.hash.startsWith('#/report') ? 'var(--text)' : '';
}
function route() {
  const hash = location.hash || '#/';
  setActiveNav();
  const m = hash.match(/^#\/report\/([a-z0-9-]+)$/i);
  if (m) return viewReport(m[1]);
  if (hash.startsWith('#/reports')) return viewReports();
  return viewHome();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (a && a.getAttribute('href')?.startsWith('#')) { /* let hashchange handle */ }
});
window.addEventListener('hashchange', route);
route();
