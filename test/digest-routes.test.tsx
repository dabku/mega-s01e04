import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function app() {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
}

function fixture(lines: string[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
}

// Extract table rows and their text without a browser or an HTML parsing dependency.
// Fixture job names contain only ASCII letters, so entity decoding is unnecessary here.
function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)].map(([markup]) => ({
    markup,
    cells: [...markup.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
      .map((match) => match[1].replace(/<[^>]*>/g, '').trim()),
  }));
}

function event(at: string, job: string, status: string, owner: string | null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

describe('digest routes', () => {
  it('returns 404 for missing and invalid nights on both endpoints', async () => {
    for (const path of ['/digest/2026-10-27', '/api/digest/2026-10-27', '/digest/not-a-night', '/api/digest/not-a-night']) {
      expect((await app().request(path)).status, path).toBe(404);
    }
  });

  it('serves an empty night rather than treating it as missing', async () => {
    fixture(['', '']);
    const html = await app().request(`/digest/${night}`);
    const json = await app().request(`/api/digest/${night}`);
    expect(html.status).toBe(200);
    expect(await html.text()).toMatch(/nothing ran/i);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('shares ordered jobs and preserves aggregation, warnings, offsets and bad-line counts', async () => {
    fixture([
      event('2026-10-28T10:00:00+02:00', 'zeta', 'ok', 'zed'),
      event('2026-10-28T09:30:00+01:00', 'alpha', 'ok', null),
      event('2026-10-28T09:00:00+02:00', 'alpha', 'fail', 'old', 'broken'),
      event('2026-10-28T10:00:00+01:00', 'beta', 'retry', 'bee'),
      event('2026-10-28T10:01:00+01:00', 'beta', 'retry', 'bee'),
      event('2026-10-28T10:02:00+01:00', 'beta', 'retry', 'bee'),
      event('2026-10-28T10:00:00+01:00', 'gamma', 'retry', 'gee'),
      event('2026-10-28T10:01:00+01:00', 'gamma', 'retry', 'gee'),
      '{broken',
      JSON.stringify({ at: '2026-10-28T10:00:00+01:00', job: 'invalid', status: 'unknown', owner: null }),
      '', '   ', '',
    ]);
    const htmlResponse = await app().request(`/digest/${night}`);
    const jsonResponse = await app().request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toEqual({
      night,
      badLines: 2,
      counts: { ok: 2, retry: 5, fail: 1 },
      rows: [
        { job: 'alpha', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: 'broken', firstAt: '2026-10-28T09:00:00+02:00', lastAt: '2026-10-28T09:30:00+01:00', hasFailed: true },
        { job: 'beta', owner: 'bee', runs: 3, retries: 3, lastStatus: 'retry', lastError: null, firstAt: '2026-10-28T10:00:00+01:00', lastAt: '2026-10-28T10:02:00+01:00', hasFailed: false },
        { job: 'gamma', owner: 'gee', runs: 2, retries: 2, lastStatus: 'retry', lastError: null, firstAt: '2026-10-28T10:00:00+01:00', lastAt: '2026-10-28T10:01:00+01:00', hasFailed: false },
        { job: 'zeta', owner: 'zed', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T10:00:00+02:00', lastAt: '2026-10-28T10:00:00+02:00', hasFailed: false },
      ],
    });
    const rows = tableRows(html).filter((row) => row.cells.some((cell) => digest.rows.some(({ job }) => job === cell)));
    expect(rows.map((row) => row.cells.find((cell) => digest.rows.some(({ job }) => job === cell)))).toEqual(digest.rows.map(({ job }) => job));
    expect(rows[0].cells).toContain('—');
    expect(rows[0].cells).toContain('2026-10-28T09:00:00+02:00');
    expect(rows[0].cells).toContain('2026-10-28T09:30:00+01:00');
    // The existing layout's warn class is the visual warning convention.
    const warned = (markup: string) => /class=["'][^"']*\bwarn\b[^"']*["']/.test(markup);
    expect(warned(rows[0].markup)).toBe(true); // recovered failure
    expect(warned(rows[1].markup)).toBe(true); // three retries
    expect(warned(rows[2].markup)).toBe(false); // two retries
    expect(warned(rows[3].markup)).toBe(false);
  });
});
