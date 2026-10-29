import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  dirs.push(dir);
  return dir;
}
function writeNight(dir: string, lines: unknown[], night = '2026-10-28'): void {
  writeFileSync(join(dir, `${night}.jsonl`), lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
}
const event = (at: string, overrides: Record<string, unknown> = {}) => ({ at, job: 'job', status: 'ok', owner: 'owner', ...overrides });
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('readNight', () => {
  it('reads the committed fixture, counting events and preserving recovery', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest).not.toBeNull();
    expect(digest!.badLines).toBe(1);
    expect(digest!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest!.rows.map(row => row.job)).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
    expect(digest!.rows.find(row => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', hasFailed: false,
    });
    expect(digest!.rows.find(row => row.job === 'digest/render')!.owner).toBeNull();
    expect(digest!.rows.find(row => row.job === 'notes/backup')!.hasFailed).toBe(true);
  });

  it('distinguishes missing and invalid nights from an empty file', () => {
    const dir = tempDir();
    expect(readNight(dir, '2026-10-28')).toBeNull();
    for (const night of ['../2026-10-28', '2026-2-01', '2026-02-29', '2026-13-01', '2026-10-00']) expect(readNight(dir, night)).toBeNull();
    writeNight(dir, ['  ', '', '\t']);
    expect(readNight(dir, '2026-10-28')).toEqual({ night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    mkdirSync(join(dir, '2026-10-29.jsonl'));
    expect(() => readNight(dir, '2026-10-29')).toThrow();
  });

  it('rejects malformed and invalid records without losing valid ones', () => {
    const dir = tempDir();
    const at = '2026-10-28T12:00:00Z';
    writeNight(dir, [
      '{', 'null', '[]', '42', event(at, { job: '' }), event(at, { job: '  ' }),
      event(at, { status: 'FAIL' }), event(at, { owner: 1 }), event(at, { owner: undefined }),
      event(at, { error: null }), event(at, { error: 1 }), event('not a date'),
      event('2026-02-29T12:00:00Z'), event('2026-10-28T24:00:00Z'),
      event('2026-10-28T12:00:00'), event('2026-10-28T12:00:00+01:60'),
      ' \r', event(at, { owner: null, error: '' }), '',
    ]);
    const digest = readNight(dir, '2026-10-28')!;
    expect(digest.badLines).toBe(16);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest.rows[0]).toMatchObject({ owner: null, lastError: '', runs: 1 });
  });

  it('orders by instant and input ties, retaining original offsets and latest supplied error', () => {
    const dir = tempDir();
    writeNight(dir, [
      event('2026-10-28T12:00:00+01:00', { status: 'fail', error: 'first error' }),
      event('2026-10-28T12:30:00+02:00', { owner: 'early', error: 'older error' }),
      event('2026-10-28T11:00:00Z', { owner: null, status: 'retry', error: 'tied error' }),
      event('2026-10-28T11:00:00.0001Z', { owner: 'recovered', status: 'ok' }),
      event('2026-10-28T11:00:00.00001Z', { error: 'latest error' }),
      event('2026-10-28T10:30:00Z', { owner: 'early tie' }),
    ]);
    expect(readNight(dir, '2026-10-28')!.rows[0]).toEqual({
      job: 'job', owner: 'recovered', runs: 6, retries: 1, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T12:30:00+02:00', lastAt: '2026-10-28T11:00:00.0001Z', hasFailed: true,
    });
  });

  it('uses input order for latest ties including a null owner and sorts by code point', () => {
    const dir = tempDir();
    const at = '2024-02-29T00:00:00Z';
    writeNight(dir, [event(at, { job: '𐀀' }), event(at, { job: '\ue000' }), event(at, { job: 'a', error: 'old' }),
      event('2024-02-29T01:00:00+01:00', { job: 'a', owner: null, status: 'fail', error: 'new' })]);
    const rows = readNight(dir, '2026-10-28')!.rows;
    expect(rows.map(row => row.job)).toEqual(['a', '\ue000', '𐀀']);
    expect(rows[0]).toMatchObject({ owner: null, lastStatus: 'fail', lastError: 'new', firstAt: at,
      lastAt: '2024-02-29T01:00:00+01:00', hasFailed: true });
  });
});
