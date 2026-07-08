# parkrun Volunteer Roster

A web tool for Clonbur Woods parkrun. It runs a monthly volunteer poll (capturing each volunteer's
parkrun **barcode**, so identity is unambiguous), then generates a **draft weekly roster** that
follows the event's rules, for the coordinator to review and enter into EMS. The tool never touches
the parkrun system — it only prepares a draft.

More detail: [`DESIGN.md`](DESIGN.md) (design + decisions), [`STATUS.md`](STATUS.md) (what's built),
[`TESTING.md`](TESTING.md) (test plan), [`PROPOSAL.md`](PROPOSAL.md) (non-technical overview).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # typecheck (svelte-check)
npm test         # generator regression tests (needs local fixtures — see below)
```

The database is a local SQLite file (default `data/roster.db`; override with `ROSTER_DB`).
Seed it by importing a saved EMS page via the **Import EMS** page in the app.

## Personal data is deliberately NOT in this repo

Volunteer names + parkrun barcodes are personal data, so these are gitignored and must exist
locally:

- `data/roster.db` — the live database
- `Volunteer Rosters _ EMS*.html` — saved EMS pages used to seed it
- `scenarios/*.json` — real poll fixtures the test suite reads

Because of this, `npm test` only runs where those local fixtures are present. *(TODO: anonymised
fixtures so tests can run in CI.)*

## Stack

SvelteKit + Node's built-in SQLite (no native build). Deploy target: `adapter-node` behind nginx
(see `DESIGN.md §7`).
