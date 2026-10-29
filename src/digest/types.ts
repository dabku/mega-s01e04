/** Status of a valid run-log event. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** Aggregated events for one job. */
export interface DigestRow {
  job: string;
  /** Owner from the latest event, including a null owner. */
  owner: string | null;
  /** Number of valid events for this job. */
  runs: number;
  /** Number of retry events for this job. */
  retries: number;
  /** Status of the latest event. */
  lastStatus: RunStatus;
  /** Most recent supplied error, or null if none was supplied. */
  lastError: string | null;
  /** Original timestamp of the earliest event, retaining its offset. */
  firstAt: string;
  /** Original timestamp of the latest event, retaining its offset. */
  lastAt: string;
  /** True if any event failed, even if a later event recovered. */
  hasFailed: boolean;
}

/** Digest of a night, with rows sorted by job using code-point comparison. */
export interface NightDigest {
  night: string;
  /** First and last events are ordered by instant, with input order breaking ties. */
  rows: DigestRow[];
  /** Number of non-empty malformed or invalid records. */
  badLines: number;
  /** Counts of valid events by status, not counts of jobs' final statuses. */
  counts: {
    ok: number;
    retry: number;
    fail: number;
  };
}

/**
 * Synchronously read a night from runsDir. Returns null only for a missing or
 * invalid night; an empty file produces a digest with no rows.
 * The implementation is exported as readNight from ./reader.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
