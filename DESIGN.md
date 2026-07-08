# parkrun Volunteer Roster Tool — Design

*Working doc. Event: Clonbur Woods parkrun (EMS event id 2325). Last updated: 2026-07-04.*

---

## 1. Problem

Each month the volunteer coordinator for Clonbur Woods parkrun:

1. Runs a poll (currently WhatsApp) asking who's available to volunteer, and for which jobs.
2. Reverse-engineers informal poll names ("Dave", "Sarah H") into real people, because to
   roster someone in parkrun's **EMS** (Event Management System) you must find them by full
   name or by **parkrun barcode** (the unique source of truth — names are not unique).
3. Applies a set of rostering rules (which jobs may combine, rotate people through jobs, don't
   put someone on Run Director unless they've done it before) to build the weekly roster.
4. Enters the roster into EMS by hand.

The coordinator role **rotates** between volunteers, so the tool must be usable by different
people, not just one power user.

The most painful, error-prone step is **identity matching** (poll name → real person → barcode).
Capturing the barcode at poll time removes it almost entirely.

---

## 2. Key decisions

### 2.1 No scraping, no stored parkrun credentials

We do **not** scrape EMS or log into parkrun on anyone's behalf. Reasons:

- parkrun actively blocks automated access (a public results page returned **HTTP 403** to an
  automated fetch).
- The long-term ambition is that parkrun HQ might adopt this into EMS. A tool built on
  credential-capture or scraping is a non-starter for HQ and would sabotage that goal.
- Security/GDPR liability of holding parkrun logins — made worse because the coordinator role
  rotates between people.

The data argument ("scraping gives the same data as manual seeding") is true about the *data*
but misses the point: ToS, security, and adoption all care about the **access method**, not the
payload. So we get the data by a sanctioned method instead (below).

### 2.2 Data source: "Save Page As" from EMS — to SEED, not weekly

EMS has **no export button**, but the coordinator can **Save Page As** from their own logged-in
browser session. That is human-initiated, uses their own auth, generates no automated traffic,
and is ToS-clean. The saved HTML is a rich, structured export.

**This is a one-time seed, not a weekly chore.** Our tool generates the rosters, so once a roster
is confirmed and entered into EMS it becomes *our* history for next time — we already hold it and
never need to read it back. New volunteers arrive via our poll (barcode captured at signup). So:

- **Seed once** from a batch of saved EMS pages → registry + back-history + RD-eligibility.
- **Persist** everything in SQLite; our DB is the **system of record** going forward.
- **Append** each confirmed roster to history ourselves — no EMS save per week.
- **Reconcile occasionally** (optional): re-import an EMS save now and then to pick up on-the-day
  changes (swaps, no-shows) and any volunteers added directly in EMS, correcting drift. Surface a
  soft "last reconciled N weeks ago" nudge; never force it.

### 2.3 EMS is an external system we hand a proposal to

We never write to EMS. The tool outputs a **proposed roster**; today a human types it into EMS.
If parkrun ever adopts this, that manual step is the clean seam an official API would fill.
Volunteers authenticate to **our** system with **our** auth — never their parkrun login.

### 2.4 RD-eligibility: derived, with manual override

A volunteer is Run-Director-eligible if they have appeared as Run Director (task id 1) in any
imported history. The coordinator can override (add/remove eligibility) — because 6 weeks of
history won't capture someone who last did RD a year ago.

### 2.5 Doubling rules: only sanctioned pairs are possible (hard rule)

A person may hold two *during-run* roles ONLY if they form a **sanctioned pair** (RD + Finish
Tokens; First Timers Welcome + Course Check/Barcode/Timekeeper) — you can't be in two places during
the run. Any other combination is **impossible**, so the generator never produces it. When there
aren't enough people to staff the nine jobs within those pairs, roles are left **unfilled** and the
tool reports "you need more volunteers" — it never invents an impossible double. (Results Processor
is post-event and Volunteer Co-ordinator is the operator; both are excluded from generation, so
they don't count as during-run roles. Real rosters that appear to "triple up" — e.g. Yvonne on
First Timers Welcome + Barcode + Results Processor — are a sanctioned during-run pair plus the
post-event RP.)

### 2.6 Stack & hosting

- **TypeScript, full-stack** — one language for the generator core, poll UI, and coordinator API.
- **SQLite** — single file under `/tank` (rides existing Borg backup). Ample for ~40 volunteers
  + years of history; no need to run Postgres on the 8GB host.
- **Deployment** on the eclectronics.org box at **`roster.eclectronics.org`**, behind the
  existing nginx reverse proxy + Cloudflare DNS + certbot.
  - **Open:** Docker (matches Immich/PeerTube; clean rebuild/redeploy loop — *leaning this way*)
    vs LXC/LXD (matches gitea/navidrome; own macvlan IP; install-once). Deploy-time decision;
    does not affect application code. Settle when we reach deployment.

---

## 3. EMS data extraction (verified against real saved pages)

Saved file layout (Chrome "Save Page As"): `Volunteer Rosters _ EMS<suffix>.html` + a
`..._files/` folder.

Two data locations in the HTML — **use the visible table, not the hidden blob**:

- **`<input class="jsInitGET">`** holds a URL-encoded JSON blob = the *initial page load only*
  (current/future weeks). It also contains the canonical **task list** (`tasks`: id → role name)
  and useful metadata (event id/name, `homeevs`, candidate pools `stw`/`rec`). **But it does NOT
  contain historical weeks** — when the coordinator navigates back, AJAX updates the table DOM,
  not this input.
- **The visible `<table class="rostertbl...">`** is the reliable source for whatever weeks are on
  screen, including history:
  - Column dates: `<thead> <th>DD/MM/YYYY</th> ...`
  - Each role row: `<tr data-t="<tid>"> <th><span>Role name</span></th> <td>...` per week.
  - A filled cell: `<td data-s="<url-encoded JSON>">` where the JSON is one **slot**:
    `{ "tid": <task id>, "i": <athlete id>, "f": "<first>", "l": "<last>", "vc": <lifetime
    volunteer count>, "h": <home event id>, "x": <bool> }`.
  - Empty cell: `<td></td>`.

**Athlete id == barcode.** `i: 4152078` renders on the page as `A4152078`. So the slot's `i`
gives us the barcode directly — the identity-matching problem is solved for free from EMS data.

**Getting history:** the coordinator uses the "weeks back" control (config exposes
`weeksBack: 5`) then Save Page As. One such save observed = **6 weeks × ~11–12 filled slots**.

**Fragility:** this is parkrun's private page markup — more stable than live scraping, but a
redesign could break the parser. Parser must fail loudly, not silently mis-map.

### Canonical roles seen (task id → name)

`1` Run Director · `2` Timekeeper · `4` Results Processor · `7` Marshal · `8` Pre-event Setup ·
`11` Barcode Scanning · `13` Finish Tokens · `14` Number Checker · `15` First Timers Welcome ·
`19` Tail Walker · `20` Volunteer Co-ordinator · `34` Event Day Course Check · `35` parkwalker
(plus others in the full list: Photographer, Pacer, VI Guide, etc.).

---

## 4. Roster rules (from the coordinator's whiteboard, reconciled with real data)

Mandatory on-the-day roles and their sanctioned doubling (hard rule — only these pairs possible):

| Role (task id)              | Sanctioned doubling                            |
| --------------------------- | ---------------------------------------------- |
| Course Check / Event Day (34) | may also do First Timers Welcome            |
| Run Director (1)            | may also do Finish Tokens                      |
| Timekeeper (2) ×2           | single-role each; a TK may cover First Timers Welcome |
| Barcode Scanning (11)       | may also do First Timers Welcome               |
| Finish Tokens (13)          | may double as Run Director                      |
| First Timers Welcome (15)   | covered by Course Check *or* Scanner *or* TK   |
| Marshal (7)                 | single role                                    |
| Tail Walker (19)            | single role                                    |
| Results Processor (4)       | post-event; usually Yvonne or Shauna (soft pref) |
| Volunteer Co-ordinator (20) | the operator; effectively excluded from the 7 |

- **Minimum 7 people** per roster (a floor reached via doubling; a normal week is ~11–12).
- Results Processor + Volunteer Co-ordinator sit outside the on-the-day core of 9.
- **First Timers Welcome** is the only role with a *choice* of partner — main source of puzzle.
  *(Open: is there a preference order among Course Check / Scanner / TK, or "whoever's spare"?)*

---

## 5. Data model

- **Volunteer** — `athlete_id` (PK, = barcode), `first`, `last`, `vc` (experience from EMS),
  `rd_eligible` (derived: any history row with tid=1; overridable), prefs (`willing_rd`,
  `avoid_roles`).
- **Role** — `tid`, `name`, `single_only` (bool), plus the sanctioned-doubling adjacency.
- **HistoryEntry** — `(date, athlete_id, tid)`, one per filled slot; append-only, upsert on
  re-import. Drives rotation + RD-eligibility.
- **Availability** — per upcoming week: which volunteers are available + their role preferences.
  The *new* data our own poll collects. (Registry/roles/history all come from EMS saves.)

---

## 6. Rule engine

Small problem (~11 slots, ~40 people): **no constraint solver**. Greedy assignment with many
random restarts, keeping the best-scoring valid roster. Debuggable and instant.

- **Template = the 9 mandatory on-the-day roles.** Results Processor + Volunteer Co-ordinator
  are **excluded from generation** (VC = whoever runs the app; RP = Shauna/Yvonne — assigned
  outside the poll).
- **Hard constraints:** fill mandatory roles from available volunteers; **a person may hold two
  during-run roles ONLY as a sanctioned pair** (§2.5) — any other double is impossible, so the
  role is left unfilled rather than double-booked; ≤ 2 during-run roles per person; Run Director
  only from `rd_eligible ∪ override`. Headcount floors at **7 people** via sanctioned doubling.
- **Assignment policy:** *requests first, then random* — an explicit request is honoured whenever
  feasible (at most one per person: "Marshal or Tail Walker" = one of them), and the rest are
  filled at random among eligible people (randomness supplies week-to-week variety). `avoid` is a
  hard exclusion. No rotation scoring.
- **Warnings:** roles that can't be filled → "you need more volunteers"; fewer than 7 distinct
  people. (Non-sanctioned doubles can't occur, so there's no warning for them — they simply never
  happen.)
- **Output:** proposed roster + one-line rationale per slot + warnings. Coordinator edits and
  types into EMS.

---

## 7. Build order

1. **Generator core (first)** — pure TS modules, no server/DB/Docker:
   `parse` (EMS HTML → records) → `registry`/`history` (merge saves) → `rules` (config) →
   `score` (assignment) → a CLI runner. **Validated against the real saved weeks** with a
   hardcoded availability list. *This is what we build now.*
2. **Persistence** — SQLite; import saved EMS pages; store registry/history/poll.
3. **Poll** — web flow: volunteers submit availability + prefs; pick-your-name from the known
   registry (only genuinely new people type name + barcode); consent/privacy notice (GDPR).
4. **Coordinator UI** — upload EMS save, generate proposal, tweak, export for manual EMS entry.
5. **Deploy** — Docker-or-LXC on the host, nginx proxy at `roster.eclectronics.org`, certbot,
   SQLite file on `/tank` for backup.

---

## 8. Open questions

- First Timers Welcome partner preference order (§4)?
- How far back should rotation look (all imported history, or last N weeks weighted)?
- Poll delivery: how do volunteers reach it (link in the WhatsApp group, email, both)?
- Deployment: Docker vs LXC (§2.6).

---

## 9. GDPR note

We store names + barcodes (personal data, UK/EU). Needs: a lawful basis (consent, cleanest for a
volunteer group), a plain-English privacy notice accepted at registration, and data kept on our
own box (SQLite on `/tank`). Volunteers use our auth, never their parkrun login.
