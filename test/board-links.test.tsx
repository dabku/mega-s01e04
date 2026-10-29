import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';
import * as reader from '../src/digest/reader.js';

describe('board night links', () => {
  it('discovers only regular files with valid calendar dates', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    try {
      mkdirSync(join(runsDir, '2026-10-30.jsonl'));
      writeFileSync(join(runsDir, '2026-02-29.jsonl'), '');
      writeFileSync(join(runsDir, '2026-04-31.jsonl'), '');
      writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
      symlinkSync('missing', join(runsDir, '2026-10-29.jsonl'));
      symlinkSync('2024-02-29.jsonl', join(runsDir, '2026-10-28.jsonl'));
      const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
      expect(readStatus(config).nights).toEqual(['2024-02-29']);
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('keeps the board available when one night cannot be read', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    const originalReadNight = reader.readNight;
    const spy = vi.spyOn(reader, 'readNight').mockImplementation((dir, night) => {
      if (night === '2026-10-29') throw new Error('simulated read failure');
      return originalReadNight(dir, night);
    });
    try {
      writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
      writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
      const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
      const status = readStatus(config);
      expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
      expect(status.digestCounts['2026-10-29']).toBeNull();
      expect(status.digestCounts['2026-10-28']).toEqual({ ok: 0, retry: 0, fail: 0 });
      const response = await createApp(config).request('/');
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('href="/digest/2026-10-29"');
      expect(html).toContain('—');
      expect(html).toContain('ok 0 / retry 0 / fail 0');
    } finally {
      spy.mockRestore();
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
  it('links nights and shows valid event counts, including recovered failures', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    try {
      const events = [
        { at: '2026-10-28T01:00:00+01:00', job: 'one', owner: null, status: 'fail' },
        { at: '2026-10-28T02:00:00+01:00', job: 'one', owner: null, status: 'retry' },
        { at: '2026-10-28T03:00:00+01:00', job: 'one', owner: null, status: 'ok' },
        { at: '2026-10-28T04:00:00+01:00', job: 'two', owner: 'reader', status: 'ok' },
      ];
      writeFileSync(join(runsDir, '2026-10-28.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\nnot json\n`);
      writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
      const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
      const status = readStatus(config);
      expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
      expect(status.digestCounts['2026-10-28']).toEqual({ ok: 2, retry: 1, fail: 1 });
      expect(status.digestCounts['2026-10-29']).toEqual({ ok: 0, retry: 0, fail: 0 });

      const response = await createApp(config).request('/');
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('href="/digest/2026-10-28"');
      expect(html).toContain('href="/digest/2026-10-29"');
      expect(html).toContain('ok 2 / retry 1 / fail 1');
      expect(html).toContain('ok 0 / retry 0 / fail 0');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});
