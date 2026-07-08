# Testing plan

Ordered by value-for-effort. This is a small volunteer tool, not a bank — invest in the fast,
deterministic layers (1–3), add a couple of browser smokes before deploy, and stop there.

Tooling: migrate unit/integration to **Vitest** (native to our Vite stack); **Playwright** for the
E2E smokes. The current `tsx test/backtest.test.ts` harness is the seed of layer 1.

## 1. Rules-engine unit tests — highest value (started)
The generator (`src/lib/core/score.ts`) is pure + deterministic (seeded RNG). Test **invariants**,
not exact rosters:
- all 9 mandatory roles filled when staffing allows; ≤2 roles/person; RD only ever eligible;
  no non-sanctioned double unless forced; requests honoured when feasible; correct warnings fire
  (under-7, unfilled RD, unfilled role).
- Keep adding **real polls as fixtures** (`scenarios/`) — each real week is a captured requirement.
- Consider property-based cases: random availability of size N ⇒ invariants always hold.
- Current coverage: `test/backtest.test.ts` (04/07 backtest + 11/18/25 July).

## 2. Parser tests — the fragile bit (`src/lib/core/parse.ts`)
Parses parkrun's private, undocumented EMS markup — most likely to break silently.
- Golden-file tests vs the saved pages (known counts, specific people, athlete-id == barcode).
- Malformed/edge inputs: empty cells, name entities (`O'MALLEY`), missing `jsInitGET`, row/slot
  `tid` mismatch ⇒ **must throw loudly, not mis-map**.
- A "canary" script that fails if a freshly-saved EMS page won't parse (early warning of format
  changes).

## 3. Persistence/DB tests (`src/lib/server/db.ts`) — moderate value, cheap
Against a temp/in-memory SQLite file:
- import is **idempotent** (re-import ⇒ no duplicate history); `vc` upserts to max;
  `confirmRoster` replaces the prior confirmed roster for a date; `loadRegistry` derives
  RD-eligibility from history **and** honours manual overrides.
- Poll: `savePoll` upserts a new volunteer by barcode; toggling availability off removes it.

## 4. Server-action integration tests
Drive the SvelteKit actions (`import` → `generate` → `confirm`, and `poll`) against a temp DB;
assert DB state + returned data. Catches wiring bugs the pure tests miss.

## 5. Playwright E2E smokes — before deploy only
Two is enough: (a) happy path (import ⇒ tick volunteers ⇒ generate ⇒ confirm), (b) the
"week is short" warning path. High confidence, high maintenance — keep to smokes.

## Not worth testing
Svelte rendering details, CSS, framework glue, exact roster membership for interchangeable slots.

## Later (with auth/GDPR)
Access control on coordinator pages; data-deletion (right-to-erasure) actually removes a
volunteer's rows.
