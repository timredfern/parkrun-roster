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
    draft** → **tweak** any assignment (per-slot dropdown) → **Confirm & save**.
  - **`/admin/rosters`** — browse previously saved (confirmed) rosters.
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

Which roles the **poll offers** volunteers to request is per-parkrun config (`POLL_ROLES` env; the
full role list lives in `src/lib/core/rules.ts`). Clonbur drops **First Timers Welcome** and
**Finish Tokens** from the poll because they're always paired/absorbed — the generator still fills
them, volunteers just can't request them directly. Other parkruns can offer a different set.

Each volunteer picks a **role mode** in the poll: **any** (put me anywhere), **prefer** (I'd like
these but I'm flexible), or **only** (I'll do these and nothing else).

Policy: **requests first, then rotate.**
- A **prefer** request is honoured whenever feasible (at most one per person: "Marshal *or* Tail
  Walker" = one of them).
- An **only** request outranks a flexible one for that role (so the flexible person moves aside); if
  several people want *only* the same role, it goes **first-come-first-served** (earliest sign-up),
  and a later "only" requester who misses out is left off (they said only that role).
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

**Volunteer (monthly):** open `/` → **Volunteer** → barcode (add name once if new) → pick **one
Saturday** (each shows how many have signed up so far) → choose **any / prefer / only** roles →
submit. (New volunteers accept a one-time privacy notice when registering; known volunteers aren't
re-asked. One Saturday per volunteer; re-submitting replaces the previous choice — a returning
volunteer sees their current signup **pre-filled** with a note, so they can change it.)

**Coordinator:** once, `/admin/import` a Save-Page-As of the EMS Volunteer Rosters page to seed the
registry + history. Each week: `/admin/generate` → pick the Saturday → review the draft + warnings,
tweak any slot → **Confirm & save** → type it into EMS. Past rosters are at `/admin/rosters`.

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

- **Auth** — none; `/admin` is reachable by URL. Needed before real volunteer data goes on the
  public internet.

(Note: tweaking a saved roster re-runs no validation — a hand-edited slot is saved as-is, since
it's a draft the coordinator types into EMS anyway.)
