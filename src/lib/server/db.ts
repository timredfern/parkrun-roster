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
      PRIMARY KEY (date, athlete_id)
    );
    CREATE TABLE IF NOT EXISTS poll_requests (
      date        TEXT NOT NULL,
      athlete_id  INTEGER NOT NULL,
      tid         INTEGER NOT NULL,  -- a requested job for that week
      PRIMARY KEY (date, athlete_id, tid)
    );
  `);
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

export function volunteerName(athleteId: number): string | null {
  const r = db().prepare('SELECT first, last FROM volunteers WHERE athlete_id = ?').get(athleteId) as
    | { first: string; last: string }
    | undefined;
  return r ? `${r.first} ${r.last}`.trim() : null;
}

// A volunteer submitting the poll. `entries` is one row per upcoming Saturday.
export interface PollSubmission {
  athleteId: number;
  first: string;
  last: string;
  entries: { date: string; available: boolean; prefer: number[] }[];
}

export function savePoll(sub: PollSubmission): void {
  const d = db();
  // Add the person if they're new (don't clobber an existing EMS record's name/vc).
  d.prepare('INSERT INTO volunteers (athlete_id, first, last, vc) VALUES (?, ?, ?, 0) ON CONFLICT(athlete_id) DO NOTHING').run(
    sub.athleteId,
    sub.first,
    sub.last,
  );
  const addAvail = d.prepare('INSERT INTO availability (date, athlete_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const delAvail = d.prepare('DELETE FROM availability WHERE date = ? AND athlete_id = ?');
  const delReq = d.prepare('DELETE FROM poll_requests WHERE date = ? AND athlete_id = ?');
  const addReq = d.prepare('INSERT INTO poll_requests (date, athlete_id, tid) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  d.exec('BEGIN');
  try {
    for (const e of sub.entries) {
      delReq.run(e.date, sub.athleteId); // re-submitting replaces prior answer for that week
      if (e.available) {
        addAvail.run(e.date, sub.athleteId);
        for (const tid of e.prefer) addReq.run(e.date, sub.athleteId, tid);
      } else {
        delAvail.run(e.date, sub.athleteId);
      }
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// Who's available for a given Saturday, with their requested jobs (from the poll).
export function getPollForDate(date: string): { athleteId: number; prefer: number[] }[] {
  const d = db();
  const rows = d
    .prepare(
      `SELECT a.athlete_id AS id, GROUP_CONCAT(r.tid) AS tids
       FROM availability a
       LEFT JOIN poll_requests r ON r.date = a.date AND r.athlete_id = a.athlete_id
       WHERE a.date = ?
       GROUP BY a.athlete_id`,
    )
    .all(date) as { id: number; tids: string | null }[];
  return rows.map((r) => ({
    athleteId: r.id,
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
