# playtest-crew

An automated playtesting harness for browser games. An agent plays the game inside a real Chromium browser, oracles watch for failures (console errors today; invariants and hangs in W2), and every finding ships with a **replayable input trace** — a bug report you can re-run and watch reproduce, deterministically, 3 times out of 3.

v0 scope: one game (a seeded fork of [2048](https://github.com/gabrielecirulli/2048)), one Explorer agent, CLI only. TypeScript + [Bun](https://bun.com), [Playwright](https://playwright.dev) for browser control.

## Quickstart

```bash
bun install

# run a playtest (headless by default, seeded random driver)
bun src/cli.ts run --game 2048

# let the LLM explorer play instead (needs ANTHROPIC_API_KEY in .env)
bun src/cli.ts run --game 2048 --driver explorer

# LLM-driven run, capped at 30 steps, with reasoning + video recorded:
#   video/*.webm        — the full run
#   llm.jsonl           — one line per step: state seen, chosen action,
#                         the model's reasoning ("why"), token usage, and
#                         a videoTs offset to scrub the video to that moment
bun src/cli.ts run --game 2048 --driver explorer --max-actions 30

# watch the bot play
bun src/cli.ts run --game 2048 --headed

# replay a recorded trace 3 times and verify determinism
bun src/cli.ts replay --trace runs/<name>/trace.jsonl --times 3

# re-record + 3/3-verify the checked-in CI baseline after any adapter change
bun src/cli.ts rebaseline --game 2048
```

`run` flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--driver <name>` | random | `random` (seeded walker) or `explorer` (LLM; model via `PTC_MODEL`, default `claude-opus-4-8`) |
| `--seed <n>` | 42 | Deterministic seed (game PRNG + move driver) |
| `--max-actions <n>` | spec | Action budget per run (default from `specs/<game>.yaml`) |
| `--gap <ms>` | 120 | Pacing between actions (`0` = as fast as the harness can go) |
| `--screenshot-every <n>` | 10 | Screenshot sampling interval (`0` = off) |
| `--out <dir>` | `runs/<run-id>` | Output directory |
| `--headed` | off | Show the browser window |

`replay` exits `0` on a clean reproduction, `1` on a state-hash mismatch, `2` on a harness/format error (e.g. trace recorded by an incompatible adapter version — never blamed on the game).

### Artifacts

Each run writes to `runs/<name>/`:

```
summary.json                    outcome, distinct-state count, candidates, llm stats
trace.jsonl                     versioned header + one line per action (see Trace format)
llm.jsonl                       explorer runs only: one line per LLM call — the state the
                                model saw, its chosen action and stated reasoning ("why"),
                                token usage, and a videoTs offset into the run video
                                (fallback lines keep the raw unparseable response)
video/*.webm                    full-run recording
shots/                          sampled screenshots
findings/<oracle>-<i>/          one folder per deduped candidate (console-error, invariant, hang):
  trace.cut.jsonl               trace cut at the firing action — the replayable repro
  oracle.txt                    what fired and why
  at-fire.png                   screenshot at the moment of failure
```

Candidates are deduped by (oracle, signature) and bundled up to the spec's `max_verifications` cap (default 5); overflow is listed in the summary as unverified candidates. Three oracles ride along on every run: **console-error** (page errors + `console.error`), **invariant** (spec predicates over the state — a predicate that throws also fires), and **hang** (state hash unchanged for N dispatched actions — suppressed while a `terminal_states` predicate holds, so a game-over screen never ships as a "verified" non-bug). Verdict logic for the W3 verification pipeline (3/3 reproduction, ±3 index tolerance, flake demotion) lives in `src/verdict.ts`.

## How moves are decided

Two drivers, selected with `--driver`; everything downstream (trace, hashing, replay, oracles) is driver-blind.

- **`random`** (default): a seeded Mulberry32 walker (seeded `seed ^ 0x9e3779b9`, distinct from the game's tile-spawn PRNG) picks uniformly from the action alphabet. Same seed → same move sequence — the determinism baseline, and the coverage baseline the explorer must beat.
- **`explorer`** (W2): each step, the LLM sees the serialized game state, the described action alphabet, and its recent actions annotated with whether each one changed anything, and returns the next action through a provider-agnostic `LLMClient` (`src/llm.ts`; Anthropic impl in v0, choice constrained server-side via a JSON-schema enum, stable system prompt cached). An unusable response falls back to a seeded random pick (counted in the summary); an API failure that survives retries ends the run as harness-error.

The success criterion — explorer must cover at least as many distinct states (unique `preStateHash` values) as random on the same budget — is measured in the run summary. First measurement (2048, seed 42, 100 actions): **explorer 83 distinct states vs random 62 (+34%)**, mostly because random burns budget on no-op moves and the explorer avoids them.

### Inspecting the explorer's decisions

Every explorer run writes `llm.jsonl` next to the trace — one line per API call:

```json
{"videoTs":"0:07.1","videoTMs":7124,"actionIndex":3,"state":{...},"action":"ArrowLeft",
 "why":"Merge the two adjacent 2s in the bottom row into a 4.","fallback":false,
 "usage":{"inputTokens":712,"outputTokens":31,"cacheReadInputTokens":0}}
```

- `videoTs` / `videoTMs` is the offset into that run's `video/*.webm` (capture starts at page creation), so you can scrub the recording to the exact moment of any decision.
- `state` is the exact JSON the model saw; `action` + `why` are its choice and stated reasoning; `usage` makes per-run API cost auditable.
- Fallback lines carry `fallback: true` plus the raw unparseable response instead of `why`.

This log is the explorer's debugger. Its first use immediately caught a real bug: the model described two side-by-side tiles as "vertically adjacent" — the 2048 adapter serializes its grid column-major (`grid[x][y]`) and the model assumed rows, burning budget on no-op moves. The fix is the `state_notes` field in `specs/<game>.yaml`: free-text notes on how to read the state JSON (orientation, units, quirks), injected into the explorer's system prompt.

## Architecture: how moves reach the browser

A four-layer stack. The key design choice: the agent never touches the browser directly — all input funnels through **one executor**, so recording and replay are physically the same code path.

**Layer 1 — Playwright over CDP** (`src/browser.ts`). A tiny `node:http` static server serves the vendored game on a loopback port; Playwright launches Chromium and talks to it over the Chrome DevTools Protocol. "Pressing a key" is a CDP `Input.dispatchKeyEvent` — Chromium synthesizes a trusted keyboard event inside the page, no OS-level input involved. This is why headless and headed behave identically.

**Layer 2 — the shared executor** (`src/executor.ts`). The only module allowed to dispatch input. One `step()` does, in order:

1. **Wait** the recorded/paced gap (clamped to 2s max),
2. **Read state** — `page.evaluate(() => window.__ptc_state())` serializes the game's internal state (grid, score, over/won) out of the page,
3. **Hash it** — canonical JSON (recursively sorted keys, floats banned) → SHA-256, the `preStateHash`,
4. **Dispatch** — `page.keyboard.press(...)` or a mouse action.

Hash-before-dispatch is the load-bearing trick: every trace line records "the world looked exactly like *this* when I did *that*." On replay the same executor runs the same steps, and the first hash mismatch pinpoints the exact action where determinism broke.

**Layer 3 — the state channel** (game fork + `src/prng.ts`). The fork exposes `window.__ptc_state()`, and determinism comes from `addInitScript` injecting a seeded Mulberry32 PRNG as `window.__ptc_rng` *before any game script runs*. The fork's random call sites use `(window.__ptc_rng || Math.random)()` — a scoped patch, not a global `Math.random` override, so the game still works when opened manually (the fallback kicks in).

**Layer 4 — the agent** (`src/runner.ts`). A read–decide–act loop: JSON state out via `evaluate`, one action name in via the executor. The trace writer sits in the executor path, not in the agent — which is why every finding automatically comes with a replayable trace.

The whole thing is deliberately boring technology — Playwright, JSON, SHA-256 — because the product claim ("this bug reproduces 3/3") only holds if every layer is deterministic, and boring layers are the ones you can make deterministic.

### Code map

```
                bun src/cli.ts (Windows: re-execs under Node)
                        │
          ┌─────────────┴──────────────┐
          │ run                        │ replay
          ▼                            ▼
   src/runner.ts                src/replayer.ts
   driver picks action          reads trace.jsonl, checks header
   (seeded random today,        compatibility (src/trace.ts), feeds
   LLM Explorer in W2)          recorded actions back one by one
          │                            │
          │   every action, both paths │
          └──────────┬─────────────────┘
                     ▼
              src/executor.ts        ←— the ONLY module that dispatches input
              wait → readState →
              hash (src/hash.ts) →
              dispatch
                     │
                     ▼
              src/browser.ts
              node:http static server + Playwright Chromium,
              injects seeded PRNG (src/prng.ts) via addInitScript
                     │  CDP (Input.dispatchKeyEvent / page.evaluate)
                     ▼
              games/2048/  (vendored fork)
              exposes window.__ptc_state(), uses window.__ptc_rng
                     │
   side channels:    ▼
   • console/pageerror → oracle → cut trace → findings/console-error-<i>/
   • src/trace.ts TraceWriter → trace.jsonl   • video/ + shots/ → runs/<name>/
   • src/games/{types,g2048,index}.ts → GameConfig registry (per-game adapter)
```

Recording and replay converge on the same executor — that shared path, plus hash-before-dispatch, is what makes "reproduces 3/3" a mechanical check instead of a hope.

## Action model

The harness never *discovers* actions — you declare them. `GameConfig.actions` is a static **action alphabet** (for 2048: the four arrow keys), fixed for the whole game, not computed per state. An action is either a key press or a pointer event at fixed coordinates (`src/trace.ts`):

```ts
{ type: "key"; key: string }
{ type: "pointer"; kind: "click" | "move"; x: number; y: number }
```

There is deliberately no per-state legality check. The harness leans on a property most games share: an inapplicable input is a **no-op**. If 2048 can't move left, ArrowLeft changes nothing, the next `preStateHash` equals the previous one, and replay still works. Solving "which actions are legal right now?" would require deep game-specific knowledge; ignoring the question stays deterministic.

Action *context* comes in two pieces (both landed in W2):

1. The **YAML game spec** (`specs/<game>.yaml`) gives each action a human-readable description, plus budgets, invariants, `terminal_states`, and `state_notes` (how to read the state JSON — see "Inspecting the explorer's decisions") — the declarative half of a game integration (the code hooks stay in `src/games/<game>.ts`). Authoring the spec is the porting step where you teach the harness what the game *means*, not just where its files live.
2. The **LLM Explorer** consumes them: its prompt gets the state snapshot, recent action history (with no-op annotations — without them the model can't tell a move did nothing and wedges on it), and the described alphabet. Legality/strategy live in the model's judgment — the harness constrains the choice to the alphabet via a JSON-schema enum, then dispatches it.

Known gap: games whose action space changes shape per state (appearing buttons, menus, unit selection). Pointer actions cover *fixed* click targets declared up front, but enumerating "what's clickable right now" would need a per-state affordance scanner — not in v0 scope, and one reason the W2 candidate spikes target keyboard-driven games where a static alphabet is the true action space.

## Trace format

`trace.jsonl`: a versioned JSON header line, then one line per action.

- **Header**: `{v, game, runId, seedStrategy, seed, viewport, stateSource, adapterVersion}`. Replay refuses traces from an incompatible `stateSource`/`adapterVersion` with a `HarnessMismatchError` (and a rebaseline hint) rather than reporting a false game bug.
- **Lines**: `{i, tMs, action, preStateHash, screenshotRef?}`.
- Written with a crash-safe append (`writeSync` per line); a truncated final line is dropped and flagged, any other corruption is fatal.
- When an oracle fires, the trace is **cut at the firing action** — the minimal artifact that still reproduces.

## Headless / accelerated loops

Headless is the default. A seed-sweep bug hunt is just a shell loop today:

```powershell
foreach ($seed in 1..50) {
  bun src/cli.ts run --game 2048 --seed $seed --out "runs/hunt-$seed"
}
```

then grep `runs/hunt-*/summary.json` for `"candidate-finding"`. Runs are independent — launch several in parallel for free throughput.

For speed, `--gap 0 --screenshot-every 0` removes all artificial delay; for a turn-based game like 2048 the cost per action is then just harness overhead (~10–30ms), so a 200-action run takes a few seconds. Caveat: that removes *pacing*, it doesn't accelerate the game's clock — a real-time game still runs at wall-clock speed. True acceleration (faking `performance.now()` / `requestAnimationFrame`) is the W3 virtual-time spike; it's a spike because virtual time can itself break replay fidelity.

## Porting to another game

The harness is game-agnostic; a game plugs in via a `GameConfig` (`src/games/types.ts`, ~30 lines — see `src/games/g2048.ts`), registered in `src/games/index.ts`: file location, viewport, legal actions, `waitUntilReady`, and a `readState`. The real porting cost is elsewhere:

1. **State extraction** — the game must expose a JSON-serializable state snapshot (`window.__ptc_state()`). Easy with source access; painful without.
2. **Determinism** — every `Math.random()` call site that affects gameplay must route through `(window.__ptc_rng || Math.random)()`. 2048 had exactly two. Games with physics, `Date.now()` dependencies, or animation-frame-sensitive logic are where replay fidelity gets hard — which is why W2 starts with replay-fidelity **spikes** on candidate games (vendor, patch, record 60 actions, replay 3×) to disqualify bad fits in 30 minutes instead of a lost weekend.
3. **The spec** — `specs/<game>.yaml`: action descriptions, budgets, invariants, `terminal_states`, and `state_notes` explaining any non-obvious state encoding (2048's grid is column-major; without that note the explorer misread the board). A short explorer run with a look at `llm.jsonl` will tell you whether the model understands your state format.

A simple deterministic DOM/keyboard game ports in under an hour. Most of the config is declarative via the YAML spec; the code hooks (`src/games/<game>.ts`) are ~20 lines.

## Playing 2048 yourself

Open `games/2048/index.html` directly in a browser — without the harness, `window.__ptc_rng` is absent and the fork falls back to `Math.random`, so it plays like normal 2048.

## Development

```bash
bun test            # unit tests (hash, PRNG, trace, executor)
bunx tsc --noEmit   # typecheck
```

**Windows note:** Bun cannot complete Playwright's Chromium launch handshake on win32 ([oven-sh/bun#27977](https://github.com/oven-sh/bun/issues/27977)), so `src/cli.ts` transparently re-execs itself under Node (≥ 23.6, for native TS type stripping) on Windows. All modules are runtime-agnostic (`node:crypto`/`node:fs`/`node:http`, explicit `.ts` import extensions) so both runtimes work; Linux/CI stays pure Bun.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the W1–W3 plan; post-v0 deferrals live in [TODOS.md](TODOS.md).
