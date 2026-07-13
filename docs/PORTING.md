# Porting a game to the harness

This is the complete checklist for adding a new game, with the existing 2048
integration as the worked example for every step. Budget for a simple
deterministic DOM/keyboard game: under an hour.

## How the harness "sees" a game (read this first)

There is **no computer vision**. The agent never looks at pixels — the game
exposes its internal state as JSON through a function you add to the fork
(`window.__ptc_state()`), and that JSON is what gets hashed for replay
verification and fed to the LLM explorer as text. Screenshots and video are
recorded as *evidence* for humans, never used for decisions.

This is deliberate:

- **Determinism** — replay verification compares exact SHA-256 hashes of the
  state. "The board looks the same" (vision) can't give you a 3/3-reproduces
  guarantee; "the state serializes to identical bytes" can.
- **Cost** — a text state is a few hundred tokens; vision calls are ~100×
  more expensive per step and slower.
- **No misreading** — the model reasons over ground truth, not its
  interpretation of a rendering.

The price is that every game must expose its state — easy with source
access, which is why the harness vendors a fork of each game.

## The checklist

### 1. Vendor the game

Copy the game's source into `games/<name>/` with a static entry HTML file.
The harness serves this folder over a loopback HTTP port; no build step.

> 2048 example: `games/2048/` is a fork of gabrielecirulli/2048, entry
> `index.html`.

### 2. Expose the state adapter

Add `window.__ptc_state()` to the fork: a synchronous function returning the
game's logical state as a JSON-serializable object. Rules:

- **Integers, strings, booleans only — no floats.** The canonical-JSON
  hasher rejects floats because they don't round-trip reliably.
- **Read the game's internal model, not the DOM.** DOM actuators often lag a
  frame behind the logic (2048's does); the model is synchronous truth.
- Keep it small — this exact JSON goes into every LLM prompt.

> 2048 example: `games/2048/js/application.js` (line ~8) reads the
> `GameManager` directly and returns
> `{ grid: number[4][4] (0 = empty), score, over, won }`.

### 3. Make it deterministic

Find **every** `Math.random()` call site that affects gameplay and change it
to:

```js
(window.__ptc_rng || Math.random)()
```

The harness injects `window.__ptc_rng` (a seeded Mulberry32) before any game
script runs. The `|| Math.random` fallback means the fork still plays
normally when opened by hand, outside the harness.

> 2048 example: exactly two call sites — `games/2048/js/grid.js` (random
> empty cell) and `games/2048/js/game_manager.js` (2-vs-4 tile value).

Also hunt for other nondeterminism: `Date.now()` in game logic, physics,
animation-frame-sensitive state. If you find any, this game may need the
virtual-time work (see ROADMAP) — consider a different candidate.

### 4. Write the code hooks

Create `src/games/<name>.ts` exporting a `GameHooks` (see
`src/games/types.ts`) — three things:

- `dir` — absolute path to the vendored folder
- `waitUntilReady(page)` — resolve when the game is playable (waiting for
  `window.__ptc_state` to exist is usually enough)
- `readState(page)` — evaluate `__ptc_state()` in the page

Then register it in the `hooksRegistry` in `src/games/index.ts`.

> 2048 example: `src/games/g2048.ts` — the whole file is ~30 lines.

### 5. Write the YAML spec

Create `specs/<name>.yaml` — the declarative half, everything a human would
tell a playtester:

- `game`, `entry`, `viewport`
- `seed_strategy: scoped-prng`, `state_source: adapter`, and an
  `adapter_version` string — **bump it on any fork/adapter change**, replay
  refuses traces from a mismatched version
- `actions` — the full action alphabet (key presses and/or fixed-coordinate
  clicks), each with a `description` the explorer reads
- `state_notes` — how to read the state JSON: orientation, units, quirks.
  Don't skip this: 2048's grid is column-major (`grid[x][y]`), and without
  the note the explorer misread the board and wasted moves.
- `budgets` — `max_actions`, `screenshot_every`, `max_verifications`
- `oracles.invariants` — expressions over `state` that must always be true
- `terminal_states` — expressions that mean "legitimately over" (these mute
  the hang detector so a game-over screen isn't reported as a freeze)

> 2048 example: `specs/2048.yaml`.

### 6. Verify the port (the 30-minute disqualification test)

Run this sequence before investing further; a game that fails step 2 is a
bad fit, and it's better to learn that in 30 minutes:

```bash
# 1. does it run at all?
bun src/cli.ts run --game <name> --max-actions 60

# 2. does it replay 3/3? (the whole point)
bun src/cli.ts replay --trace runs/<run-id>/trace.jsonl --times 3

# 3. check in a verified baseline
bun src/cli.ts rebaseline --game <name>

# 4. does the LLM understand your state format?
bun src/cli.ts run --game <name> --driver explorer --max-actions 15
```

After step 4, read the run's `llm.jsonl` — if the model's `why` lines
describe the board wrongly or it repeats no-op moves, improve `state_notes`
and rerun.

## What you do NOT need

- No vision/OpenCV, no image processing.
- No per-state "which actions are legal" logic — the harness relies on
  inapplicable inputs being no-ops (see "Action model" in the README).
- No changes to the harness core (`runner`, `executor`, `replayer`,
  `oracles`) — a port only touches `games/<name>/`, `src/games/<name>.ts`,
  and `specs/<name>.yaml`.
