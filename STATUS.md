# Status — parkrun Volunteer Roster Tool

*Clonbur Woods parkrun. Updated 2026-07-05.*

## What exists right now

**Only the generator core** — a command-line engine that reads saved EMS pages and proposes a
roster. Written in TypeScript, run with `npm run gen`. No database, no poll, no web app, no
deployment yet (those are later build steps — see `DESIGN.md §7`).

```
src/parse.ts      EMS "Save Page As" HTML  ->  dates, slots, history, task list
src/registry.ts   merge saved pages        ->  volunteers (barcode, name, experience, RD-eligible)
                                                + deduped history
src/rules.ts      the roster rules (as data)
src/score.ts      the generator: requests-first, then random, within the rules
src/cli.ts        glue: read files + availability -> print proposed roster
scenarios/*.json  real WhatsApp polls turned into availability inputs
test/backtest.test.ts   `npm test` — pins behaviour on both sample weeks (deterministic)
```

Run it:
```
npm run gen                                   # all known volunteers available (healthy-week demo)
npm run gen -- --avail scenarios/2026-07-04.json
npm run gen -- --avail scenarios/2026-07-04.json --seed 7   # a different random valid roster
```

---

## Proposed workflow (the target system — mostly NOT built yet)

### Volunteer (monthly)
1. Opens our poll link (replaces the WhatsApp poll).
2. **Picks their name** from the known list (seeded from EMS) — or, if new, types name + parkrun
   **barcode** once. Accepts a short privacy notice (we store name + barcode; GDPR).
3. Ticks the week(s) they can do, and optionally requests specific job(s).

This is the step that kills the identity problem: we capture the **barcode at poll time**, so no
one has to reverse-engineer "Ger"/"Marie" into an EMS record later (see samples below).

### Coordinator
**One-time setup:** import a batch of saved EMS pages (**Save Page As** — our sanctioned import,
no scraping/credentials; see `DESIGN.md §2`) to seed the registry + back-history + RD-eligibility
into our DB.

**Each week (the rotating role):**
1. Open the app → **Generate** → proposed roster with a one-line reason per slot and any warnings.
2. Tweak, **Confirm** (the app stores the confirmed roster as history), then **type it into EMS by
   hand** (EMS has no import; the tool never writes to EMS).

No weekly EMS save: our DB is the system of record; confirmed rosters become next week's history,
and new volunteers arrive via the poll. An **occasional** EMS reconcile catches on-the-day changes.

**Built today:** only the *Generate* step (as a CLI), plus manual EMS parsing for the seed. Poll,
upload UI, name-pick, storage/persistence, and the confirm-and-store step are still to build.

---

## Rules defined (implemented in `src/rules.ts` + `src/score.ts`)

**The 9 mandatory on-the-day roles** (every week, all must be covered):
Run Director · Event Day Course Check · First Timers Welcome · Timekeeper ×2 · Barcode Scanning ·
Finish Tokens · Marshal · Tail Walker.

**Excluded from generation** (handled outside the poll): Results Processor (post-event; Shauna or
Yvonne) and Volunteer Co-ordinator (whoever runs the app).

**Doubling** — one person, two roles. Sanctioned pairs (silent):
- Run Director **+** Finish Tokens
- First Timers Welcome **+** one of {Course Check, Barcode Scanning, Timekeeper}

Any *other* double is **impossible** (can't be in two places during the run), so it's never
produced — short weeks leave roles unfilled with a "need more people" warning instead.

**Headcount** — minimum **7 distinct people** (reached by sanctioned doubling, never by dropping a
role). Physical cap of **2 during-run roles per person** (no triple-booking).

**Run Director** — only someone **RD-eligible**, derived automatically from history (anyone who has
been RD before), with manual override.

**Assignment policy** — *requests first, then random*:
- An explicit request is honoured whenever feasible (at most **one** honoured per person, so
  "Marshal or Tail Walker" means one of them, not both).
- Everything else is filled **at random** among valid people (randomness gives week-to-week
  variety); re-run with a new `--seed` for an alternative roster.
- A role someone marks **avoid** is a hard exclusion.

**Warnings emitted** — fewer than 7 people · any unfilled mandatory role · any non-sanctioned
double · any request that couldn't be placed.

---

## The two samples

Both are real WhatsApp polls, saved under `scenarios/`. They also demonstrate the identity gap.

### `2026-07-11.json` — "Sat 11th", 7 votes (a tight week)
Name→barcode matching: **5 of 7 resolved**, 2 could not be (no barcode):

| Poll name | Matched |
|---|---|
| Helen | Helen ALLERTON |
| Teresa Keane | Teresa KEANE *(wants Marshal/Tail Walker)* |
| Marie | Marie FRASER *(wants Course Check)* |
| Grainne Holleran | Grainne HOLLERAN-MULLINS |
| Shauna Parkrun | Shauna FEERICK |
| **Marcus** | **unresolved — needs barcode** |
| **Martina Donagher** | **unresolved — needs barcode** |

### `2026-07-04.json` — "Sat 4th", 7 votes + coordinator notes (a backtest week)
Name→barcode matching: **4 clean + 1 shaky of 7**, plus 2 note-people:

| Poll / note | Matched |
|---|---|
| Eilís | Eilís NIC DHONNCHA |
| Blaithin | Bláithín COSTELLO |
| Olivia | Olivia O'MALLEY *(wants Timekeeper)* |
| edel feeney | Edel FEENEY |
| Ger | Geraldine CAMPBELL *(**uncertain** guess)* |
| Yvonne *(note)* | Yvonne PETERS HILL *(wants Course Check)* |
| Anne Heneghan *(note)* | Ann HENEGHAN *(wants Marshal/Tail Walker)* |
| **Eleanor Meeneghan** | **unresolved — needs barcode** |
| **Síle Flynn** | **unresolved — needs barcode** |

**Consistent finding: ~2–3 of every 7 voters can't be resolved from a name alone.** That is the
core justification for capturing barcodes in the poll.

---

## Test runs vs. human roster

### 04/07 — backtest (we have the real EMS roster the coordinator actually made)

The generator was given only the 7 people we could resolve (Shauna was *not* in this poll, so it
couldn't use her). History was restricted to weeks *before* 04/07 so it couldn't "see the answer".

| Role | Generator proposed | Actual human roster | Match |
|---|---|---|---|
| Run Director | Eilís | Eilís | ✅ exact |
| Finish Tokens | Eilís *(doubled w/ RD)* | Eilís *(doubled w/ RD)* | ✅ exact |
| Course Check | Yvonne *(requested)* | Yvonne | ✅ exact |
| Timekeeper | Olivia *(requested)* | Olivia | ✅ exact |
| Barcode Scanning | Bláithín | Bláithín | ✅ exact |
| Timekeeper | Edel | Geraldine | valid, different person |
| First Timers Welcome | Edel *(doubled, sanctioned)* | Shauna | Shauna unavailable to tool |
| Marshal | Geraldine | Ann | valid, interchangeable |
| Tail Walker | Ann *(requested)* | Edel | valid, interchangeable |

**Outcome:** 7 people, 2 sanctioned doublings, **no warnings**; **all 3 requests honoured**;
**5 of 9 slots match the human exactly**, and it reproduced the human's key structural choice
(Eilís on RD **+** Finish Tokens). Divergences are where a role is genuinely interchangeable or
where the human used Shauna (whom the poll didn't include).

### 11/07 — forward test (EMS has no roster for this week yet)

Only 5 of 7 resolved, so a deliberately under-staffed week. Output:

```
Run Director            Grainne HOLLERAN-MULLINS   (also Finish Tokens — sanctioned)
Event Day Course Check  Marie FRASER               (requested)
First Timers Welcome    Helen ALLERTON
Timekeeper              Helen ALLERTON             (also First Timers Welcome — sanctioned)
Timekeeper              Marie FRASER
Barcode Scanning        Shauna FEERICK
Finish Tokens           Grainne HOLLERAN-MULLINS
Marshal                 Teresa KEANE               (requested)
Tail Walker             Shauna FEERICK
Slots filled: 9/9   Distinct people: 5

⚠ Only 5 distinct volunteers — minimum is 7.
⚠ Marie FRASER does both Course Check and Timekeeper — outside the usual combinations.
⚠ Shauna FEERICK does both Tail Walker and Barcode Scanning — outside the usual combinations.
```

**Outcome:** honours both requests (Marie→Course Check, Teresa→Marshal) and uses the 2 sanctioned
doublings, but correctly **flags that the week is 2 people short** — with only 5 bodies for 9
roles, 2 non-sanctioned doubles are unavoidable and are surfaced as warnings rather than hidden.
This is the tool doing its job: telling the coordinator "you need more volunteers," not pretending
5 people make a clean roster.

---

## Known limitations / not done

- **Not validated at a *typical* week size** (~10–15 available). Both samples are 7-vote weeks.
- Identity matching is currently **manual** (done by hand for the samples); no fuzzy matcher yet,
  and the poll-with-barcode that removes the need for it isn't built.
- **RD-eligibility depends on the history window** — someone who last did RD before the imported
  weeks won't be auto-eligible (that's what the manual override is for).
- No persistence, no poll UI, no web app, no deployment. Rules could later move to a declarative
  config or a constraint solver (MiniZinc/OR-Tools) — deferred; the greedy engine fits the current
  "requests then random" policy and the tiny problem size.
