// Parses a "Save Page As" export of the EMS Volunteer Rosters page.
//
// IMPORTANT (verified against real saved pages): historical weeks live in the VISIBLE table
// (`data-s` per <td>), NOT in the hidden `jsInitGET` blob (that holds only the initial
// current/future load). So we parse the table. The blob is used only for the canonical task list.
// See DESIGN.md §3.

export interface Slot {
  tid: number; // task id (role)
  i: number; // athlete id == barcode (renders as A<i>)
  f: string; // first name
  l: string; // last name
  vc: number; // lifetime volunteer count
  h?: number; // home event id
}

export interface HistoryEntry {
  date: string; // ISO yyyy-mm-dd
  athleteId: number;
  tid: number;
}

export interface ParsedPage {
  dates: string[]; // ISO, one per table column
  rows: { tid: number; role: string; cells: (Slot | null)[] }[];
  entries: HistoryEntry[]; // flattened filled cells
  slots: Slot[]; // all filled slots (for registry)
  tasks: Map<number, string>; // canonical task id -> name (from jsInitGET; may be empty)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&'); // last, so we don't double-decode
}

function isoDate(ddmmyyyy: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) throw new Error(`Unrecognised date format: ${ddmmyyyy}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseSlotAttr(raw: string): Slot {
  let obj: unknown;
  try {
    obj = JSON.parse(decodeURIComponent(decodeEntities(raw)));
  } catch (e) {
    throw new Error(`Failed to decode slot data-s="${raw.slice(0, 60)}...": ${String(e)}`);
  }
  const o = obj as Record<string, unknown>;
  const num = (k: string) => {
    const v = o[k];
    if (typeof v !== 'number') throw new Error(`slot missing numeric "${k}": ${JSON.stringify(o)}`);
    return v;
  };
  const str = (k: string) => {
    const v = o[k];
    if (typeof v !== 'string') throw new Error(`slot missing string "${k}": ${JSON.stringify(o)}`);
    return v;
  };
  return { tid: num('tid'), i: num('i'), f: str('f'), l: str('l'), vc: num('vc'), h: typeof o.h === 'number' ? o.h : undefined };
}

function parseTasks(html: string): Map<number, string> {
  const tasks = new Map<number, string>();
  const m = /class="jsInitGET" value="([^"]*)"/.exec(html);
  if (!m || !m[1]) return tasks;
  try {
    const blob = JSON.parse(decodeURIComponent(m[1])) as { tasks?: { i: number; n: string }[] };
    for (const t of blob.tasks ?? []) tasks.set(t.i, t.n);
  } catch {
    // tasks are optional metadata; ignore a malformed blob
  }
  return tasks;
}

export function parseEmsHtml(html: string): ParsedPage {
  // Column dates come from the thead (bare <th>DD/MM/YYYY</th>; the leading corner cell has a class).
  const dates: string[] = [];
  for (const m of html.matchAll(/<th>(\d{2}\/\d{2}\/\d{4})<\/th>/g)) dates.push(isoDate(m[1]!));
  if (dates.length === 0) throw new Error('No date columns found — is this an EMS Volunteer Rosters save?');

  const tbodyMatch = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!tbodyMatch) throw new Error('No <tbody> found in roster table.');
  const tbody = tbodyMatch[1]!;

  const rows: ParsedPage['rows'] = [];
  const entries: HistoryEntry[] = [];
  const slots: Slot[] = [];

  for (const rowMatch of tbody.matchAll(/<tr\b[^>]*\bdata-t="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tid = Number(rowMatch[1]);
    const inner = rowMatch[2]!;
    const roleMatch = /<th><span>([\s\S]*?)<\/span>/.exec(inner);
    const role = roleMatch ? decodeEntities(roleMatch[1]!.trim()) : `task ${tid}`;

    const cells: (Slot | null)[] = [];
    for (const td of inner.matchAll(/<td\b([^>]*)>/g)) {
      const attrs = td[1]!;
      const ds = /data-s="([^"]*)"/.exec(attrs);
      if (!ds) {
        cells.push(null);
        continue;
      }
      const slot = parseSlotAttr(ds[1]!);
      if (slot.tid !== tid) {
        throw new Error(`Row tid ${tid} (${role}) has a cell whose slot tid is ${slot.tid} — parser desync.`);
      }
      cells.push(slot);
    }

    if (cells.length !== dates.length) {
      throw new Error(`Row "${role}" has ${cells.length} cells but there are ${dates.length} date columns — parser desync.`);
    }

    cells.forEach((slot, col) => {
      if (!slot) return;
      slots.push(slot);
      entries.push({ date: dates[col]!, athleteId: slot.i, tid });
    });

    rows.push({ tid, role, cells });
  }

  if (rows.length === 0) throw new Error('No roster rows parsed.');

  return { dates, rows, entries, slots, tasks: parseTasks(html) };
}
