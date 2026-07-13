// Persistence layer. Uses Node's built-in SQLite (no native build needed).
// This DB is the system of record: seeded once from EMS, then confirmed rosters accumulate as
// history. See DESIGN.md §2.2 / §5.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseEmsHtml } from '../core/parse.ts';
import type { HistoryEntry } from '../core/parse.ts';
import type { Registry, Volunteer } from '../core/registry.ts';
import { RD_TID } from '../core/rules.ts';

const DB_PATH = process.env.ROSTER_DB ?? 'data/roster.db';

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS volunteers (
      athlete_id  INTEGER PRIMARY KEY,
      first       TEXT NOT NULL,
      last        TEXT NOT NULL,
      vc          INTEGER NOT NULL DEFAULT 0,
      rd_override TEXT            -- 'eligible' | 'ineligible' | NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      date        TEXT NOT NULL,  -- ISO yyyy-mm-dd
      athlete_id  INTEGER NOT NULL,
      tid         INTEGER NOT NULL,
      source      TEXT NOT NULL DEFAULT 'ems',  -- 'ems' | 'confirmed'
      PRIMARY KEY (date, athlete_id, tid)
    );
    CREATE TABLE IF NOT EXISTS availability (
      date        TEXT NOT NULL,  -- the Saturday
      athlete_id  INTEGER NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'any',  -- 'any' | 'prefer' | 'only'
      created_at  INTEGER NOT NULL DEFAULT 0,   -- arrival time (epoch ms) for first-come-first-served
      PRIMARY KEY (date, athlete_id)
    );
    CREATE TABLE IF NOT EXISTS poll_requests (
      date        TEXT NOT NULL,
      athlete_id  INTEGER NOT NULL,
      tid         INTEGER NOT NULL,  -- a selected role (with mode 'prefer' or 'only')
      PRIMARY KEY (date, athlete_id, tid)
    );
  `);
  // Migrate older DBs: add availability.mode / created_at if missing.
  const cols = new Set((d.prepare('PRAGMA table_info(availability)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('mode')) d.exec("ALTER TABLE availability ADD COLUMN mode TEXT NOT NULL DEFAULT 'any'");
  if (!cols.has('created_at')) d.exec('ALTER TABLE availability ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
  // Under the old model, any row with role requests was effectively a soft "prefer".
  d.exec(`UPDATE availability SET mode = 'prefer' WHERE mode = 'any' AND EXISTS
    (SELECT 1 FROM poll_requests r WHERE r.date = availability.date AND r.athlete_id = availability.athlete_id)`);
  _db = d;
  return d;
}

export interface DbStats {
  volunteers: number;
  weeks: number;
  entries: number;
}

export function stats(): DbStats {
  const d = db();
  const v = d.prepare('SELECT COUNT(*) AS n FROM volunteers').get() as { n: number };
  const w = d.prepare('SELECT COUNT(DISTINCT date) AS n FROM history').get() as { n: number };
  const e = d.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number };
  return { volunteers: v.n, weeks: w.n, entries: e.n };
}

// Seed / reconcile from one or more saved EMS pages. Idempotent (upsert).
export function importEmsHtml(htmls: string[]): { volunteers: number; weeks: number; entries: number } {
  const d = db();
  const upV = d.prepare(
    `INSERT INTO volunteers (athlete_id, first, last, vc) VALUES (?, ?, ?, ?)
     ON CONFLICT(athlete_id) DO UPDATE SET first = excluded.first, last = excluded.last,
       vc = MAX(volunteers.vc, excluded.vc)`,
  );
  const upH = d.prepare(
    `INSERT INTO history (date, athlete_id, tid, source) VALUES (?, ?, ?, 'ems')
     ON CONFLICT(date, athlete_id, tid) DO NOTHING`,
  );
  const dates = new Set<string>();
  const vids = new Set<number>();
  let entries = 0;
  d.exec('BEGIN');
  try {
    for (const html of htmls) {
      const page = parseEmsHtml(html);
      for (const s of page.slots) {
        upV.run(s.i, s.f, s.l, s.vc);
        vids.add(s.i);
      }
      for (const e of page.entries) {
        upH.run(e.date, e.athleteId, e.tid);
        dates.add(e.date);
        entries++;
      }
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  return { volunteers: vids.size, weeks: dates.size, entries };
}

// Build the in-memory Registry the generator expects, from the DB.
export function loadRegistry(): Registry {
  const d = db();
  const vrows = d.prepare('SELECT athlete_id, first, last, vc, rd_override FROM volunteers').all() as {
    athlete_id: number;
    first: string;
    last: string;
    vc: number;
    rd_override: string | null;
  }[];
  const hrows = d.prepare('SELECT date, athlete_id, tid FROM history').all() as {
    date: string;
    athlete_id: number;
    tid: number;
  }[];

  const history: HistoryEntry[] = hrows.map((r) => ({ date: r.date, athleteId: r.athlete_id, tid: r.tid }));
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const derivedRd = new Set<number>();
  for (const h of history) if (h.tid === RD_TID) derivedRd.add(h.athleteId);

  const volunteers = new Map<number, Volunteer>();
  for (const r of vrows) {
    const rdEligible =
      r.rd_override === 'ineligible' ? false : r.rd_override === 'eligible' || derivedRd.has(r.athlete_id);
    volunteers.set(r.athlete_id, { athleteId: r.athlete_id, first: r.first, last: r.last, vc: r.vc, rdEligible });
  }

  return { volunteers, history };
}

// Store a confirmed roster as history (replaces any previous confirmed roster for that date).
export function confirmRoster(date: string, slots: { tid: number; athleteId: number }[]): void {
  const d = db();
  const del = d.prepare(`DELETE FROM history WHERE date = ? AND source = 'confirmed'`);
  const ins = d.prepare(
    `INSERT INTO history (date, athlete_id, tid, source) VALUES (?, ?, ?, 'confirmed')
     ON CONFLICT(date, athlete_id, tid) DO UPDATE SET source = 'confirmed'`,
  );
  d.exec('BEGIN');
  try {
    del.run(date);
    for (const s of slots) ins.run(date, s.athleteId, s.tid);
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function setRdOverride(athleteId: number, value: 'eligible' | 'ineligible' | null): void {
  db().prepare('UPDATE volunteers SET rd_override = ? WHERE athlete_id = ?').run(value, athleteId);
}

export function volunteerExists(athleteId: number): boolean {
  return !!db().prepare('SELECT 1 FROM volunteers WHERE athlete_id = ?').get(athleteId);
}

// A volunteer's current poll signup (they have at most one — one Saturday each), or null.
export function getMyPollEntry(athleteId: number): { date: string; mode: string; roles: number[] } | null {
  const d = db();
  const a = d.prepare('SELECT date, mode FROM availability WHERE athlete_id = ?').get(athleteId) as
    | { date: string; mode: string }
    | undefined;
  if (!a) return null;
  const roles = (
    d.prepare('SELECT tid FROM poll_requests WHERE athlete_id = ? AND date = ?').all(athleteId, a.date) as { tid: number }[]
  ).map((r) => r.tid);
  return { date: a.date, mode: a.mode, roles };
}

export function volunteerName(athleteId: number): string | null {
  const r = db().prepare('SELECT first, last FROM volunteers WHERE athlete_id = ?').get(athleteId) as
    | { first: string; last: string }
    | undefined;
  return r ? `${r.first} ${r.last}`.trim() : null;
}

// A volunteer submitting the poll — one Saturday, with a role mode.
export interface PollSubmission {
  athleteId: number;
  first: string;
  last: string;
  date: string;
  mode: 'any' | 'prefer' | 'only';
  roles: number[]; // selected roles (ignored when mode = 'any')
}

// A volunteer signs up for exactly ONE Saturday; re-submitting replaces any prior signup.
export function savePoll(sub: PollSubmission): void {
  const d = db();
  d.prepare('INSERT INTO volunteers (athlete_id, first, last, vc) VALUES (?, ?, ?, 0) ON CONFLICT(athlete_id) DO NOTHING').run(
    sub.athleteId,
    sub.first,
    sub.last,
  );
  d.exec('BEGIN');
  try {
    // Preserve their original arrival time if they're just editing the same Saturday.
    const existing = d.prepare('SELECT created_at FROM availability WHERE athlete_id = ? AND date = ?').get(sub.athleteId, sub.date) as
      | { created_at: number }
      | undefined;
    const createdAt = existing?.created_at || Date.now();

    d.prepare('DELETE FROM availability WHERE athlete_id = ?').run(sub.athleteId);
    d.prepare('DELETE FROM poll_requests WHERE athlete_id = ?').run(sub.athleteId);
    d.prepare('INSERT INTO availability (date, athlete_id, mode, created_at) VALUES (?, ?, ?, ?)').run(
      sub.date,
      sub.athleteId,
      sub.mode,
      createdAt,
    );
    if (sub.mode !== 'any') {
      const addReq = d.prepare('INSERT INTO poll_requests (date, athlete_id, tid) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
      for (const tid of sub.roles) addReq.run(sub.date, sub.athleteId, tid);
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// Who's available for a given Saturday: mode, arrival time, and selected roles.
export function getPollForDate(date: string): { athleteId: number; mode: string; since: number; prefer: number[] }[] {
  const d = db();
  const rows = d
    .prepare(
      `SELECT a.athlete_id AS id, a.mode AS mode, a.created_at AS since, GROUP_CONCAT(r.tid) AS tids
       FROM availability a
       LEFT JOIN poll_requests r ON r.date = a.date AND r.athlete_id = a.athlete_id
       WHERE a.date = ?
       GROUP BY a.athlete_id`,
    )
    .all(date) as { id: number; mode: string; since: number; tids: string | null }[];
  return rows.map((r) => ({
    athleteId: r.id,
    mode: r.mode,
    since: r.since,
    prefer: r.tids ? r.tids.split(',').map(Number) : [],
  }));
}

export function pollCounts(): { date: string; n: number }[] {
  return db()
    .prepare('SELECT date, COUNT(*) AS n FROM availability GROUP BY date ORDER BY date')
    .all() as { date: string; n: number }[];
}

// Dates that have a confirmed (generated-and-saved) roster, newest first.
export function confirmedRosterDates(): string[] {
  return (
    db().prepare("SELECT DISTINCT date FROM history WHERE source = 'confirmed' ORDER BY date DESC").all() as {
      date: string;
    }[]
  ).map((r) => r.date);
}

// The confirmed roster for a date: role task id + who, with names.
export function getConfirmedRoster(date: string): { tid: number; athleteId: number; name: string }[] {
  return db()
    .prepare(
      `SELECT h.tid AS tid, h.athlete_id AS athleteId, TRIM(COALESCE(v.first, '') || ' ' || COALESCE(v.last, '')) AS name
       FROM history h LEFT JOIN volunteers v ON v.athlete_id = h.athlete_id
       WHERE h.date = ? AND h.source = 'confirmed'
       ORDER BY h.tid`,
    )
    .all(date) as { tid: number; athleteId: number; name: string }[];
}
