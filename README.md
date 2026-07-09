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
npm test         # generator regression tests (synthetic fixtures; real-data tier if data/ present)
```

The database is a local SQLite file (default `data/roster.db`; override with `ROSTER_DB`).
Seed it by importing a saved EMS page via the **Import EMS** page in the app.

## Personal data is deliberately NOT in this repo

Volunteer names + parkrun barcodes are personal data, so these are gitignored and must exist
locally:

- `data/roster.db` — the live database
- `Volunteer Rosters _ EMS*.html` — saved EMS pages used to seed it
- `scenarios/*.json` — real poll fixtures the test suite reads

`npm test` runs everywhere against **committed synthetic fixtures** (`test/fixtures/`, fake
people/barcodes); the richer real-data backtest is an extra tier that runs only when the `data/`
EMS pages are present locally, and skips otherwise.

## Deploy

Runs as a Docker container (SvelteKit `adapter-node`). Stateless apart from the SQLite DB volume,
so put it behind any reverse proxy that terminates TLS and forwards the standard headers.

```bash
cp .env.example .env      # set ORIGIN (public URL), ROSTER_PORT, ROSTER_DB_DIR
docker compose up -d --build
```

Point the reverse proxy at the published port. **`ORIGIN` must match the public URL** or form POSTs
are rejected (SvelteKit CSRF). Back up the DB volume — it's the only stateful thing.

## Stack

SvelteKit + Node's built-in SQLite (no native build). See [`DESIGN.md`](DESIGN.md) for the design.
