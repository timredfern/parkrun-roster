# Status — how the tool works

*Clonbur Woods parkrun. What's actually built, as of this commit.*

A SvelteKit app (Node `adapter-node` + Node's built-in SQLite) that runs a monthly volunteer poll
and generates a draft weekly roster for a coordinator to review and enter into parkrun's EMS.

## Site structure (routes)

- **`/`** — public landing:
  - status cards: volunteers known · weeks of history · eligible run directors;
  - **"Responses so far"** — per-Saturday response counts for the current month;
  - a **Volunteer** button that opens the poll in a modal (`<dialog>`).
  - **`/?month=YYYY-MM`** — a past month's poll, **read-only** (no voting; voting is only shown for
    the current/open month).
- **`/lookup?barcode=`** — small JSON endpoint the poll uses to check if a barcode is known.
- **`/admin`** — coordinator hub (unauthenticated for now), linking:
  - **`/admin/generate`** — pick a Saturday (auto-loads that week's poll responses) → **Generate
    draft** → **Confirm & save**.
  - **`/admin/import`** — upload saved EMS pages to seed/reconcile.
- A discreet **"Coordinator →"** link in the public footer.

## Identity — the core idea

`athlete_id == parkrun barcode`. The poll captures the **barcode** (barcode-first: enter it, and we
only ask for a name if it's unknown), so a volunteer is always identified unambiguously — no more
matching informal WhatsApp names to EMS records.

## Data (SQLite, WAL mode; file per `ROSTER_DB`)

- **`volunteers`** — `athlete_id` (PK = barcode), `first`, `last`, `vc` (lifetime volunteer count),
  `rd_override` (`eligible`/`ineligible`/null).
- **`history`** — `(date, athlete_id, tid, source)`; `source` is `ems` (imported) or `confirmed`
  (a roster we generated and saved). Deduped by `(date, athlete_id, tid)`, so re-importing EMS
  never double-counts. Drives rotation + RD-eligibility.
- **`availability`** — `(date, athlete_id)`: who's available that Saturday (from the poll).
- **`poll_requests`** — `(date, athlete_id, tid)`: jobs a volunteer requested for that Saturday.

## The generator (`src/lib/core`)

Fills the **9 mandatory on-the-day roles** (Run Director, Course Check, First Timers Welcome, two
Timekeepers, Barcode Scanning, Finish Tokens, Marshal, Tail Walker). Results Processor + Volunteer
Co-ordinator are excluded (assigned outside the poll).

Policy: **requests first, then rotate.**
- An explicit request is honoured whenever feasible (at most one per person: "Marshal *or* Tail
  Walker" = one of them).
- Remaining slots go to whoever is most **due** — hasn't done that role recently, per `history`
  (weeks before the target date) — with a tiny random tie-break.

Hard rules (never violated):
- **Run Director** only from the RD-eligible set (derived from anyone who's held RD, plus manual
  override).
- A person may hold **two during-run roles only as a sanctioned pair** (RD+Finish Tokens; First
  Timers Welcome + Course Check/Barcode/Timekeeper); ≤2 during-run roles each. Any other double is
  physically impossible, so it's never produced.
- If the roles can't be covered within those rules, they're **left unfilled** and the tool says
  **"you need more volunteers"** (plus a warning under 7 distinct people).

Confirmed rosters are written back into `history` (`source='confirmed'`), so each week feeds the
next week's rotation and RD-eligibility.

## Workflows

**Volunteer (monthly):** open `/` → **Volunteer** → barcode (add name once if new) → tick
Saturdays → optionally request a role → consent → submit.

**Coordinator:** once, `/admin/import` a Save-Page-As of the EMS Volunteer Rosters page to seed the
registry + history. Each week: `/admin/generate` → pick the Saturday → review the draft + warnings →
**Confirm & save** → type it into EMS.

## Tests

`npm test` — two tiers: a **synthetic fixture** (`test/fixtures/`, fake people; runs anywhere) that
pins the rules/invariants + rotation, and a **real-data backtest** that reads `data/` and skips when
those (gitignored) files aren't present. `npm run check` typechecks.

## Deployment

Docker (`node:24-slim`, no native build), `adapter-node`, behind nginx at
`roster.eclectronics.org`. Config via `.env` (`ORIGIN`, `ROSTER_PORT`, `ROSTER_DB_DIR`,
`EVENT_NAME`). DB persists on `/tank/www/roster` (inside the Borg backup set). Site-specific deploy
lives in the `selfhostingsetup` repo (`roster/`).

## Not built yet

- **Review stored rosters** — a UI to browse past confirmed rosters. *(planned)*
- **Tweak a draft before confirming** — the draft is currently saved as generated; editing per-slot
  before Confirm is *planned*.
- **Auth** — none; `/admin` is reachable by URL. Needed before real data goes on the public
  internet.
