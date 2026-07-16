import { chromium } from 'playwright';
import type { ReportView } from './report-view.js';
import type { Distribution } from '../analyzer/aggregate.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const show = (v: string | null | undefined): string => (v && v.trim() ? esc(v) : 'Not Available');

function mdToHtml(md: string): string {
  // Minimal, safe Markdown: bold + paragraphs. Report bodies are our own.
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function distTable(title: string, dist: Distribution[]): string {
  if (!dist.length) return `<h2>${title}</h2><p class="muted">Not determinable from public data.</p>`;
  const rows = dist
    .map((d) => `<tr><td>${esc(d.label)}</td><td>${d.ads}</td><td>${d.creatives}</td><td>${d.adSharePct}%</td></tr>`)
    .join('');
  return `<h2>${title}</h2><table><thead><tr><th>Item</th><th>Ads</th><th>Creatives</th><th>Share</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function section(n: number, title: string, body: string | null): string {
  return `<h2><span class="num">${n}</span>${title}</h2>${body ? mdToHtml(body) : '<p class="muted">Not Available</p>'}`;
}

/** Render a standalone, print-optimized HTML document for the PDF export. */
export function renderReportHtml(view: ReportView): string {
  const a = view.advertiser;
  const h = view.headline;
  const r = view.report;
  const rel = view.reliability;

  const winners = view.winners
    .map(
      (w) =>
        `<tr><td>${w.rank}</td><td>${show(w.headline)}</td><td>${w.duplicateCount}</td><td>${w.runtimeDays ?? '?'}d</td><td>${w.creativeType}</td></tr>`,
    )
    .join('');

  const volumeLine = h.metaReportedApprox
    ? `Meta's Ad Library reports ≈${h.metaReportedApprox} results for this page (Meta's own approximate figure).`
    : `Total active-ad count is not independently verifiable, so no total is claimed — only the counts above, verified by direct count.`;

  const body = r
    ? [
        section(1, 'Executive Summary', r.executiveSummary),
        section(2, 'Biggest Strategic Insight', r.biggestStrategicInsight),
        section(3, 'Messaging Strategy', r.messagingStrategy),
        `<h2><span class="num">4</span>Creative Winners</h2><table><thead><tr><th>#</th><th>Creative</th><th>Ads</th><th>Runtime</th><th>Type</th></tr></thead><tbody>${winners}</tbody></table>${r.creativeWinners ? mdToHtml(r.creativeWinners) : ''}`,
        distTable('5. Hook Distribution', view.hooks),
        distTable('6. Offer Distribution', view.offers),
        section(7, 'Competitive Weaknesses', r.competitiveWeaknesses),
        section(8, 'Counter Strategy', r.counterStrategy),
        section(9, 'Recommendations', r.actionItems),
      ].join('')
    : `<p class="muted">${show(view.reportError)}</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.name)} — Competitive Intelligence</title>
<style>
  @page { margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #18181b; }
  .brand { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #71717a; }
  h1 { font-size: 24pt; margin: 4pt 0 2pt; letter-spacing: -.02em; }
  .sub { color: #52525b; margin: 0 0 4pt; }
  .rule { height: 3px; background: #6d28d9; width: 48px; border-radius: 2px; margin: 10pt 0 16pt; }
  h2 { font-size: 13pt; margin: 20pt 0 6pt; letter-spacing: -.01em; display: flex; align-items: baseline; gap: 8px; page-break-after: avoid; }
  h2 .num { color: #6d28d9; font-size: 10pt; font-weight: 700; }
  p { margin: 6pt 0; }
  .muted { color: #a1a1aa; }
  .cards { display: flex; gap: 10px; margin: 10pt 0; }
  .card { flex: 1; border: 1px solid #e4e4e7; border-radius: 10px; padding: 10pt 12pt; }
  .card .k { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #71717a; }
  .card .v { font-size: 20pt; font-weight: 700; letter-spacing: -.02em; }
  .card .v small { font-size: 10pt; font-weight: 500; color: #71717a; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border-bottom: 1px solid #ececf0; padding: 5pt 8pt; text-align: left; }
  th { color: #71717a; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
  .note { background: #faf5ff; border: 1px solid #ede9fe; border-radius: 10px; padding: 10pt 12pt; margin: 12pt 0; font-size: 9pt; color: #52525b; }
  strong { color: #18181b; }
  footer { margin-top: 22pt; border-top: 1px solid #ececf0; padding-top: 8pt; font-size: 8pt; color: #a1a1aa; }
</style></head><body>
  <div class="brand">Competitive Intelligence Briefing</div>
  <h1>${esc(a.name)}</h1>
  <p class="sub">${show(a.industry)}${a.website ? ' · ' + esc(a.website) : ''} · Generated ${esc(view.createdAt.slice(0, 10))}</p>
  <div class="rule"></div>
  <div class="cards">
    <div class="card"><div class="k">Ads collected</div><div class="v">${h.collectedAds}</div></div>
    <div class="card"><div class="k">Unique creatives</div><div class="v">${h.uniqueCreatives}</div></div>
    <div class="card"><div class="k">Top creative</div><div class="v">${h.topCreative ? h.topCreative.duplicateCount : '—'}<small> ads</small></div></div>
    <div class="card"><div class="k">Confidence</div><div class="v">${rel.overall}<small>/100</small></div></div>
  </div>
  <div class="note"><strong>${h.collectedAds} ads → ${h.uniqueCreatives} unique creatives.</strong> ${esc(volumeLine)} Public data only — spend, reach, and audience targeting are not exposed and are never estimated.</div>
  ${body}
  <footer>Source: Meta Ad Library (public data). Advertiser identified with ${rel.advertiserConfidence}% confidence (${esc(rel.advertiserMethod)}). Report reliability ${rel.overall}/100.</footer>
</body></html>`;
}

/** Render HTML to a PDF buffer via headless Chromium. */
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env['CHROMIUM_PATH'] || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
