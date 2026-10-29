import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Instant = { seconds: number; fraction: string };
type Event = { at: string; instant: Instant; job: string; status: RunStatus; owner: string | null; error?: string };

function validDate(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function parseInstant(value: string): Instant | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  if (!validDate(Number(year), Number(month), Number(day)) || Number(hour) > 23 ||
      Number(minute) > 59 || Number(second) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) return null;
  const millis = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
  return Number.isFinite(millis) ? { seconds: millis / 1000, fraction: fraction.replace(/0+$/, '') } : null;
}

function compareInstant(a: Instant, b: Instant): number {
  return a.seconds - b.seconds || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);
}

function parseEvent(value: unknown): Event | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== 'string' || typeof record.job !== 'string' || !record.job.trim() ||
      (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') ||
      (typeof record.owner !== 'string' && record.owner !== null) ||
      ('error' in record && typeof record.error !== 'string')) return null;
  const instant = parseInstant(record.at);
  if (!instant) return null;
  return { at: record.at, instant, job: record.job, status: record.status, owner: record.owner,
    ...(typeof record.error === 'string' ? { error: record.error } : {}) };
}

function compareJobs(a: string, b: string): number {
  const left = Array.from(a, char => char.codePointAt(0)!);
  const right = Array.from(b, char => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export const readNight: ReadNight = (runsDir, night) => {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
  if (!date || !validDate(Number(date[1]), Number(date[2]), Number(date[3]))) return null;
  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: Instant; last: Instant; errorAt: Instant | null }>();
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let event: Event | null = null;
    try { event = parseEvent(JSON.parse(line) as unknown); } catch { /* malformed JSON */ }
    if (!event) { digest.badLines++; continue; }
    digest.counts[event.status]++;
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, { first: event.instant, last: event.instant, errorAt: event.error === undefined ? null : event.instant,
        row: { job: event.job, owner: event.owner, runs: 1, retries: Number(event.status === 'retry'),
          lastStatus: event.status, lastError: event.error ?? null, firstAt: event.at, lastAt: event.at,
          hasFailed: event.status === 'fail' } });
      continue;
    }
    const { row } = existing;
    row.runs++;
    row.retries += Number(event.status === 'retry');
    row.hasFailed ||= event.status === 'fail';
    if (compareInstant(event.instant, existing.first) < 0) { existing.first = event.instant; row.firstAt = event.at; }
    if (compareInstant(event.instant, existing.last) >= 0) {
      existing.last = event.instant; row.lastAt = event.at; row.owner = event.owner; row.lastStatus = event.status;
    }
    if (event.error !== undefined && (existing.errorAt === null || compareInstant(event.instant, existing.errorAt) >= 0)) {
      existing.errorAt = event.instant; row.lastError = event.error;
    }
  }
  digest.rows = Array.from(jobs.values(), entry => entry.row).sort((a, b) => compareJobs(a.job, b.job));
  return digest;
};
