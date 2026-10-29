import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-page-'));
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

it('renders missing owner and error values as dashes without changing the API values', async () => {
  const night = '2026-10-28';
  const values = [
    { job: 'null', owner: null },
    { job: 'empty', owner: '', error: '' },
    { job: 'blank', owner: ' \t ', error: ' \t ' },
    { job: 'present', owner: ' Alice ', error: ' broken ' },
  ];
  writeFileSync(join(runsDir, `${night}.jsonl`), values.map((value) => JSON.stringify({
    at: '2026-10-28T10:00:00+01:00', status: 'fail', ...value,
  })).join('\n'));
  const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
  const response = await app.request(`/digest/${night}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) =>
    [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]),
  ).filter((cells) => cells.length > 0);
  expect(rows.map((cells) => [cells[0], cells[1], cells[5]])).toEqual([
    ['blank', '—', '—'], ['empty', '—', '—'], ['null', '—', '—'], ['present', ' Alice ', ' broken '],
  ]);

  const api = await app.request(`/api/digest/${night}`);
  expect(api.status).toBe(200);
  const digest: NightDigest = await api.json();
  expect(digest.rows.map(({ job, owner, lastError }) => ({ job, owner, lastError }))).toEqual([
    { job: 'blank', owner: ' \t ', lastError: ' \t ' },
    { job: 'empty', owner: '', lastError: '' },
    { job: 'null', owner: null, lastError: null },
    { job: 'present', owner: ' Alice ', lastError: ' broken ' },
  ]);
});
