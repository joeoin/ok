import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { scoreCandidate } from '../resolver/advertiser-resolver.js';
import { buildCsv } from '../utils/csv.js';
import { CSV_COLUMNS, creativeGroupToCsvRow } from '../reporting/csv-exporter.js';
import { slugify } from '../utils/fs.js';
import { createLogger, setLogLevel } from '../utils/logger.js';
import type { AdvertiserPage } from '../types.js';
import { searchAdvertiser } from './orchestrator.js';
import { getLiveEngine, MetaUnreachableError, NoAdsError } from './live.js';
import { ReportStore } from './store.js';
import { buildReportView } from './report-view.js';
import { renderPdf, renderReportHtml } from './report-pdf.js';

const config = loadConfig();
setLogLevel(config.logLevel);
const log = createLogger('server');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const PORT = Number.parseInt(process.env['PORT'] ?? '4321', 10);
const store = new ReportStore(path.join(PROJECT_ROOT, 'webdata', 'reports'));
const engine = getLiveEngine(config);

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
    const shell = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html']! });
    res.end(shell);
  }
}

/** Build a minimal AdvertiserPage from the fields the client carries forward. */
function pageFromParams(url: URL): AdvertiserPage {
  return {
    pageId: (url.searchParams.get('pageId') ?? '').trim(),
    name: (url.searchParams.get('name') ?? '').trim(),
    category: url.searchParams.get('industry') || null,
    website: url.searchParams.get('website') || null,
    likes: null,
    verification: url.searchParams.get('verified') === '1' ? 'BLUE_VERIFIED' : null,
    imageUri: null,
    country: null,
  };
}

/** POST /api/search { query } — live advertiser resolution. */
async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readBody(req)) as { query?: string };
  const query = (body.query ?? '').trim();
  if (!query) return sendJson(res, 400, { error: 'Enter a company name.' });

  let pages: AdvertiserPage[];
  try {
    pages = await engine.search(query);
  } catch (err) {
    if (err instanceof MetaUnreachableError) {
      return sendJson(res, 502, { error: err.reason, kind: 'meta-unreachable' });
    }
    log.error(`Search failed: ${String(err)}`);
    return sendJson(res, 500, { error: 'Search failed. Please try again.', kind: 'error' });
  }

  if (pages.length === 0) {
    return sendJson(res, 200, {
      query,
      outcome: 'refuse',
      chosenPageId: null,
      candidates: [],
      message: `No advertiser matching “${query}” was found in the Meta Ad Library. Check the spelling or try the exact page name.`,
    });
  }
  sendJson(res, 200, searchAdvertiser(query, pages));
}

/** GET /api/analyze/stream?query=&pageId=&name=… — SSE progress then final event. */
async function handleAnalyzeStream(res: http.ServerResponse, url: URL): Promise<void> {
  const query = (url.searchParams.get('query') ?? '').trim();
  const page = pageFromParams(url);
  const method = url.searchParams.get('method') === 'auto' ? 'auto-accepted' : 'user-selected';

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!query || !page.pageId || !page.name) {
    send('error', { message: 'Missing advertiser details. Please search again.' });
    res.end();
    return;
  }

  const scored = scoreCandidate(query, page);
  send('progress', { stage: 'resolving', status: 'active', detail: `Confirming ${page.name}` });

  try {
    const result = await engine.analyze(
      {
        query,
        page,
        resolutionConfidencePct: scored.confidencePct,
        resolutionMethod: method,
        resolutionReasons: scored.reasons,
      },
      (stage, status, detail) => send('progress', { stage, status, detail }),
    );
    const id = `${slugify(result.advertiser.name)}-${Date.now().toString(36)}`;
    await store.save(id, result);
    send('done', { reportId: id });
  } catch (err) {
    const message =
      err instanceof MetaUnreachableError || err instanceof NoAdsError
        ? err.message
        : 'Analysis failed unexpectedly. Please try again.';
    if (!(err instanceof MetaUnreachableError) && !(err instanceof NoAdsError)) {
      log.error(`Analysis failed: ${String(err)}`);
    }
    send('error', { message });
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
  sendJson(res, 200, { view: buildReportView(saved.result) });
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

    const m = p.match(/^\/api\/reports\/([a-z0-9-]+)(\/pdf|\/csv)?$/i);
    if (req.method === 'GET' && m) {
      const [, id, sub] = m;
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
  log.info(`AdIntel running at http://localhost:${PORT} — LIVE (real Meta Ad Library)`);
  if (config.llm.provider === 'none') {
    log.warn('LLM_PROVIDER=none: reports will include data sections but no AI narrative. Set LLM_API_KEY for full briefings.');
  }
});

process.on('SIGINT', () => engine.close().finally(() => process.exit(0)));
process.on('SIGTERM', () => engine.close().finally(() => process.exit(0)));
