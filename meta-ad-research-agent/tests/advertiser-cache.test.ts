import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAdvertiserCache, JsonFileAdvertiserCache } from '../src/resolver/advertiser-cache.js';

describe('InMemoryAdvertiserCache', () => {
  it('normalizes queries on get/remember', () => {
    const c = new InMemoryAdvertiserCache();
    c.remember('Acme  Solar!', { pageId: '1', name: 'Acme Solar' }, '2026-07-16T00:00:00Z');
    expect(c.get('acme solar')?.pageId).toBe('1');
    expect(c.get('ACME   SOLAR')?.pageId).toBe('1');
  });
});

describe('JsonFileAdvertiserCache', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-cache-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('persists and reloads resolutions', async () => {
    const file = path.join(dir, 'cache.json');
    const c1 = await JsonFileAdvertiserCache.load(file);
    c1.remember('Solace', { pageId: '110702245120634', name: 'Solace' }, '2026-07-16T00:00:00Z');
    await c1.persist();

    const c2 = await JsonFileAdvertiserCache.load(file);
    expect(c2.get('solace')?.pageId).toBe('110702245120634');
  });

  it('loads gracefully when the file is missing', async () => {
    const c = await JsonFileAdvertiserCache.load(path.join(dir, 'does-not-exist.json'));
    expect(c.get('anything')).toBeUndefined();
  });
});
