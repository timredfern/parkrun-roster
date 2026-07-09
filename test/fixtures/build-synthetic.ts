// Generates test/fixtures/synthetic-ems.html — a fake EMS "Volunteer Rosters" page with invented
// people/barcodes, in the exact shape parse.ts expects. Committed so tests run anywhere with no
// personal data. Regenerate: `npx tsx test/fixtures/build-synthetic.ts`.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Fake volunteers: id (= barcode), first, last, lifetime volunteer count.
const P: Record<number, { i: number; f: string; l: string; vc: number }> = {
  1: { i: 1000001, f: 'Ann', l: 'ALPHA', vc: 40 },
  2: { i: 1000002, f: 'Bob', l: 'BRAVO', vc: 35 },
  3: { i: 1000003, f: 'Cara', l: 'CHARLIE', vc: 20 },
  4: { i: 1000004, f: 'Dan', l: 'DELTA', vc: 15 },
  5: { i: 1000005, f: 'Eve', l: 'ECHO', vc: 12 },
  6: { i: 1000006, f: 'Fay', l: 'FOXTROT', vc: 8 },
  7: { i: 1000007, f: 'Gus', l: 'GOLF', vc: 25 },
  8: { i: 1000008, f: 'Hana', l: 'HOTEL', vc: 30 },
  9: { i: 1000009, f: 'Ivan', l: 'INDIA', vc: 5 },
  10: { i: 1000010, f: 'Jo', l: 'JULIET', vc: 18 },
  11: { i: 1000011, f: 'Kim', l: 'KILO', vc: 22 },
  12: { i: 1000012, f: 'Lee', l: 'LIMA', vc: 3 },
};

const weeks = ['30/05/2026', '06/06/2026'];

// Each row = one role instance across the two weeks (person key per week).
// RD (tid 1) is held by Ann then Bob → both become RD-eligible. RD also does Finish Tokens
// (a sanctioned double), mirroring real rosters.
const rows: { tid: number; role: string; wk: [number, number] }[] = [
  { tid: 1, role: 'Run Director', wk: [1, 2] },
  { tid: 34, role: 'Event Day Course Check', wk: [2, 3] },
  { tid: 15, role: 'First Timers Welcome', wk: [3, 9] },
  { tid: 2, role: 'Timekeeper', wk: [4, 4] },
  { tid: 2, role: 'Timekeeper', wk: [5, 10] },
  { tid: 11, role: 'Barcode Scanning', wk: [6, 11] },
  { tid: 13, role: 'Finish Tokens', wk: [1, 2] },
  { tid: 7, role: 'Marshal', wk: [7, 12] },
  { tid: 19, role: 'Tail Walker', wk: [8, 8] },
];

const cell = (tid: number, pk: number) => {
  const p = P[pk]!;
  const slot = { tid, i: p.i, f: p.f, l: p.l, vc: p.vc, h: 1 };
  return `<td data-s="${encodeURIComponent(JSON.stringify(slot))}"><div>${p.f} ${p.l}</div></td>`;
};

const html = `<!DOCTYPE html>
<html lang="en"><head><title>Volunteer Rosters | EMS</title></head>
<body>
<table class="rostertbl">
<thead><tr><th class="diag"></th>${weeks.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((r) => `<tr data-t="${r.tid}"><th><span>${r.role}</span></th>${r.wk.map((pk) => cell(r.tid, pk)).join('')}</tr>`).join('\n')}
</tbody>
</table>
</body></html>
`;

writeFileSync(join(here, 'synthetic-ems.html'), html);
console.log('wrote synthetic-ems.html');
