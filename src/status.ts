import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { NightDigest } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  digestCounts: Record<string, NightDigest['counts'] | null>;
};

function validNight(name: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) return false;
  const night = name.slice(0, 10);
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && validNight(entry.name))
      .map((entry) => entry.name.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  const digestCounts = Object.fromEntries(
    nights.map((night) => {
      try {
        return [night, readNight(config.runsDir, night)?.counts ?? null];
      } catch {
        return [night, null];
      }
    }),
  );
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    digestCounts,
  };
}
