import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsv } from '../utils/csv.js';
import { CSV_COLUMNS, creativeGroupToCsvRow } from '../reporting/csv-exporter.js';
import { slugify } from '../utils/fs.js';
import { createLogger, setLogLevel } from '../utils/logger.js';
import {
  analyzeDemo,
  candidatesFor,
  searchAdvertiser,
  type Mode,
} from './orchestrator.js';
import { DEMO_ADVERTISERS } from './demo-data.js';
import { ReportStore } from './store.js';
import { buildReportView } from './report-view.js';
import { renderPdf, renderReportHtml } from './report-pdf.js';

const log = createLogger('server');
setLogLevel((process.env['LOG_LEVEL'] as 'info') || 'info');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const MODE: Mode = process.env['MODE'] === 'live' ? 'live' : 'demo';
const PORT = Number.parseInt(process.env['PORT'] ?? '4321', 10);
const store = new ReportStore(path.join(PROJECT_ROOT, 'webdata', 'reports'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback: unknown non-API path serves the app shell.
    const shell = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html']! });
    res.end(shell);
  }
}

/** POST /api/search { query } */
async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readBody(req)) as { query?: string };
  const query = (body.query ?? '').trim();
  if (!query) return sendJson(res, 400, { error: 'Enter a company name.' });

  const pages = candidatesFor(query, MODE);
  if (pages.length === 0) {
    return sendJson(res, 200, {
      query,
      mode: MODE,
      outcome: 'refuse',
      chosenPageId: null,
      candidates: [],
      message:
        MODE === 'demo'
          ? `No demo data for “${query}”. Try Nike, Solace, or HubSpot.`
          : `No advertiser found for “${query}”.`,
    });
  }
  sendJson(res, 200, searchAdvertiser(query, pages, MODE));
}

/** GET /api/analyze/stream?query=&pageId= — SSE progress then a final event. */
async function handleAnalyzeStream(res: http.ServerResponse, url: URL): Promise<void> {
  const query = (url.searchParams.get('query') ?? '').trim();
  const pageId = (url.searchParams.get('pageId') ?? '').trim();
  const pages = candidatesFor(query, MODE);
  const search = pages.length ? searchAdvertiser(query, pages, MODE) : null;
  const chosen = pages.find((p) => p.pageId === pageId);

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!chosen || !search) {
    send('error', { message: 'That advertiser is no longer available. Please search again.' });
    res.end();
    return;
  }

  const candidate = search.candidates.find((c) => c.pageId === pageId);
  const method: 'auto-accepted' | 'user-selected' =
    search.outcome === 'auto' && search.chosenPageId === pageId ? 'auto-accepted' : 'user-selected';

  try {
    const result = await analyzeDemo(
      {
        query,
        pageId,
        page: chosen,
        resolutionConfidencePct: candidate?.confidencePct ?? 100,
        resolutionMethod: method,
        resolutionReasons: candidate?.reasons ?? [],
      },
      (stage, status, detail) => send('progress', { stage, status, detail }),
    );
    const id = `${slugify(result.advertiser.name)}-${Date.now().toString(36)}`;
    await store.save(id, result);
    send('done', { reportId: id });
  } catch (err) {
    log.error(`Analysis failed: ${String(err)}`);
    send('error', { message: 'Analysis failed. Please try again.' });
  } finally {
    res.end();
  }
}

async function handleReports(res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { reports: await store.list() });
}

async function handleReport(res: http.ServerResponse, id: string): Promise<void> {
  const saved = await store.get(id);
  if (!saved) return sendJson(res, 404, { error: 'Report not found.' });
  sendJson(res, 200, { mode: MODE, view: buildReportView(saved.result) });
}

async function handleReportPdf(res: http.ServerResponse, id: string): Promise<void> {
  const saved = await store.get(id);
  if (!saved) return sendJson(res, 404, { error: 'Report not found.' });
  const pdf = await renderPdf(renderReportHtml(buildReportView(saved.result)));
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${slugify(saved.advertiserName)}-report.pdf"`,
  });
  res.end(pdf);
}

async function handleReportCsv(res: http.ServerResponse, id: string): Promise<void> {
  const saved = await store.get(id);
  if (!saved) return sendJson(res, 404, { error: 'Report not found.' });
  const csv = buildCsv(CSV_COLUMNS, saved.result.creativeGroups.map(creativeGroupToCsvRow));
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${slugify(saved.advertiserName)}-creatives.csv"`,
  });
  res.end(csv);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const p = url.pathname;

    if (req.method === 'POST' && p === '/api/search') return await handleSearch(req, res);
    if (req.method === 'GET' && p === '/api/analyze/stream') return await handleAnalyzeStream(res, url);
    if (req.method === 'GET' && p === '/api/reports') return await handleReports(res);

    const reportMatch = p.match(/^\/api\/reports\/([a-z0-9-]+)(\/pdf|\/csv)?$/i);
    if (req.method === 'GET' && reportMatch) {
      const [, id, sub] = reportMatch;
      if (sub === '/pdf') return await handleReportPdf(res, id!);
      if (sub === '/csv') return await handleReportCsv(res, id!);
      return await handleReport(res, id!);
    }

    if (req.method === 'GET') return await serveStatic(res, p);
    res.writeHead(405).end('Method Not Allowed');
  } catch (err) {
    log.error(`Unhandled: ${String(err)}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error.' });
    else res.end();
  }
});

server.listen(PORT, () => {
  log.info(`AdIntel web app running at http://localhost:${PORT}  (mode: ${MODE})`);
  log.info(`Demo advertisers available: ${Object.values(DEMO_ADVERTISERS).map((d) => d.page.name).join(', ')}`);
});
