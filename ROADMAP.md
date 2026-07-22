# Roadmap — v0 (4 weekends)

Source of truth for full detail: the design doc at
`~/.gstack/projects/playtest-crew/vic-master-design-20260706-234327.md`.

## W1 — done

Trace format + replayer, seeded 2048 fork, random runner, console-error oracle.

Determinism proven end-to-end: 3/3 replays, 60/60 hash matches; planted-bug
pipeline reproduced at the exact action index (`runs/w1-planted/`).

Recorded deviations: Windows Bun→Node hop; 2048 uses `stateSource: "adapter"`
instead of DOM; oracle validated via a temporary planted bug (reverted).

## W2 — done (code deliverables)

- YAML game-spec parser (`specs/2048.yaml`, `src/spec.ts`): actions with
  descriptions, budgets, invariants, `terminal_states`; code hooks stay in
  `src/games/<game>.ts`.
- Invariant + hang oracles (`src/oracles.ts`), hang guarded by
  `terminal_states`; runs now accumulate deduped candidates (by oracle +
  signature) up to the `max_verifications` cap instead of stopping at the
  first fire.
- Verdict logic for W3 verification (`src/verdict.ts`): 3/3 within ±3 index
  tolerance → finding, anything less → flake; pre-fire hash mismatch marks
  `nondeterministic` without changing the verdict.
- `LLMClient` seam + Anthropic impl (`src/llm.ts`); Explorer driver
  (`src/explorer.ts`) with schema-enum-constrained choice, no-op-annotated
  history, seeded random fallback. **Beat-random measured:** 83 vs 62
  distinct states on the same 100-action budget (2048, seed 42) — +34%.
- `playtest rebaseline` (`src/rebaseline.ts`): re-records
  `baselines/<game>/trace.jsonl`, replaces it only after 3/3 replay
  verification. Baseline checked in; CI replay smoke is a W4 item.
- Deviations/notes: explorer initially wedged on a no-op action because the
  prompt lacked effect feedback — fixed by fresh state reads for the driver
  plus "(changed nothing!)" history annotations; hang oracle caught the
  wedge live, which is exactly its job.

## W2 — deferred per pre-declared cut order

- Phaser candidate shortlist + replay-fidelity spikes (item 4 in the cut
  order, first to slip → W3): vendor, patch, record ~50 actions, replay 3× —
  disqualify bad fits before committing. Blocks Open Question 1.
- Demand checkpoint (non-code, founder task): any replies/calls from the 15
  outreach messages? Reply-calibrated kill-switch triggers at end of W2.

## W3 — done (code deliverables)

- Verification pipeline (`src/verify.ts`, `playtest verify`): replays each
  candidate's cut trace 3× with oracles observing (`src/replayer.ts` gained
  `observeOracles` + `continueOnMismatch`), feeds the observations to
  `src/verdict.ts`, writes `verdict.json` into the bundle. Candidate bundles
  now carry a machine-readable `candidate.json`; older bundles are rejected
  with a clear re-record message.
- Validated end-to-end with the W1 planted-bug method: temporary spec
  invariant (`state.score < 40`) fired at action 14, verify judged it
  FINDING 3/3, invariant reverted before commit (`runs/w3-planted/`).
- Unattended bug hunt (`src/hunt.ts`, `playtest hunt --seeds 1-50`): lean
  per-seed runs (no video/screenshots, gap 0), auto-verify every candidate,
  `report.md` + `report.json` with findings / flakes / unverified strictly
  separated. Smoke: 5 seeds × 150 actions in ~9s, honest "0 findings" report
  (`runs/w3-hunt-smoke/`).

## W3 — deferred

- Virtual-time spike (Open Question 5): no live target — 2048 is turn-based,
  so there is nothing to validate the spike against until a real-time game
  is vendored. Do it together with the first real-time port.
- Phaser candidate shortlist + replay-fidelity spikes (slipped from W2):
  needs third-party games vendored; unchanged, still blocks Open Question 1.
- Demand checkpoint (non-code, founder task): check replies to the outreach
  batch; the reply-calibrated kill-switch decision is overdue from end of W2.

## W4 — done (code + shipping deliverables)

Per spec.md, W4 is the shipping weekend, not more infrastructure: README
demo video, one upstream bug filed, repo public, first build-log post, plus
the CI replay smoke deferred from W2.

- **Re-scoped mid-weekend:** the upstream-bug-filing step was pulled in
  favor of local-LLM support (originally a post-v0 TODO). Reasoning:
  a cloud-API-only explorer makes the demo expensive to run and hands
  nobody else a way to try it cheaply — fix the cost/friction problem
  before spending the weekend on outreach artifacts that depend on it.
- Local LLM support: `OpenAICompatibleClient` (`src/llm.ts`) — talks to any
  `/v1/chat/completions` server (Ollama, vLLM, hosted gateways); `--driver
  explorer --llm-provider openai-compatible` on the CLI, model/base-URL
  configurable via `--llm-model` / `PTC_BASE_URL` / `PTC_API_KEY`. Same
  fallback contract as Anthropic (unusable response → seeded random pick,
  exhausted retries → harness-error). Structured output enforced
  server-side via `response_format: json_schema`, same as Anthropic's
  structured outputs — the Explorer driver needed zero changes.
- CI (`.github/workflows/ci.yml`): typecheck, unit tests, then a 3× replay
  of the checked-in `baselines/2048/trace.jsonl` on every push/PR — the
  automated version of what `rebaseline` already checks by hand.
- Demo video (`docs/demo/explorer-2048-local-llm.webm` +
  matching `.llm.jsonl`): 60-action, 35s real run against local `llama3.2`
  — 0 random fallbacks, 51/60 distinct states. The harness's own
  Playwright headed-mode recording, not a staged screencast; embedded in
  the README with the exact repro command.
- First build-log post (`docs/buildlog/2026-07-20-four-weekends.md`),
  linked from the README.
- **Repo visibility:** held private for now (explicit call — not yet ready
  to make public).
- **Upstream bug filing — done, but on a small proof target, not a real
  one yet.** Deferred from W4 itself in favor of local-LLM support (see
  above); filed post-v0 instead, once the SDK model made a second game
  integration cheap. Filed:
  [davidjbrossard/minesweeper#1](https://github.com/davidjbrossard/minesweeper/issues/1)
  — a real, 3/3-verified `revealed` counter bug found on the very first
  extended run against `games/minesweeper` (see the SDK adoption entry
  below). **Caveat:** the target repo is a small, effectively unused
  example project (0 stars, not in active use) — it proves the pipeline
  can find and file a real bug end-to-end, but it is not evidence the
  harness delivers value against a game anyone actually plays.
- **Attempted against a bigger, actively-used target — mechanism
  reconfirmed, no new defect yet.** `games/emoji-minesweeper` (905
  stars, updated days ago, live at muan.co/emoji-minesweeper): 3/3
  replay verified on a materially harder integration (100-cell board,
  per-cell DOM-property state instead of a central array, a
  board-reshuffling first-click-safety mechanic, bundled analytics +
  service worker noise). A 20-seed hunt surfaced 2 verified (3/3) hang
  candidates, but both turned out to be the hang oracle correctly
  catching a no-op streak after an early flood-fill reveal exposed most
  of the board in one click — not product defects, so nothing was filed.
  **Still needed:** TODOS.md #1 — either hunt this target harder or find
  a different one to get the actual "this matters to someone else"
  finding.

## Post-v0 (in progress, unblocked after W4's demand checkpoint)

- Gemini `LLMClient` (`src/llm.ts`): fetch-based, same shape as the
  OpenAI-compatible client. `GEMINI_API_KEY` required — no local-server
  fallback like the other two providers, so a missing key throws
  immediately rather than defaulting to anything. CLAUDE.md's
  provider-agnostic mandate (Anthropic, OpenAI-compatible, Gemini) is now
  fully satisfied by code, not just by interface.
- `playtest bench` (`src/bench.ts`): runs the explorer under several
  `LLMClient` configs on the same game/seed/budget, reports distinct-state
  coverage, fallback rate, and per-call latency. A model that fails to run
  (missing key, model not found) is recorded as a `harness-error` row with
  its error rather than aborting the comparison — same honest-accounting
  rule as `hunt`. Measured: `qwen2.5:7b-instruct` beat `llama3.2` on
  coverage (57/60 vs 51/60 distinct states, seed 7) at ~1.25× the per-call
  latency — confirms the manual comparison done by hand earlier this
  session, now automated.
- `hunt --llm-provider`/`--llm-model`: closed a gap where `hunt` only ever
  passed `--driver` to `run()`, silently defaulting every explorer sweep to
  Anthropic — a local-model hunt had no way to select its provider.
- **SDK adoption model** ([sdk/README.md](../sdk/README.md)): the fork
  model (`docs/PORTING.md`) requires vendoring the game, hand-patching
  every `Math.random()` call site, and writing a bespoke state adapter —
  too much integration cost to expect from a game developer who isn't
  already invested in this project. The SDK model cuts that to one script
  tag (`sdk/ptc-sdk.js`) plus one call (`PTC.exposeState(fn)`):
  - `seed_strategy: global-random-patch` (`src/prng.ts`) overwrites
    `Math.random` globally via the harness's existing `addInitScript`
    mechanism — the game's source is never touched for determinism.
  - `src/games/sdk.ts`'s `sdkGameHooks({name, dir})` supplies
    `waitUntilReady`/`readState` generically (identical to what 2048's
    hand-written hooks already did — 2048 itself was refactored onto this
    factory, no behavior change, confirmed by its baseline still replaying
    3/3 after the refactor).
  - `browser.ts` now serves `sdk/ptc-sdk.js` at a fixed URL
    (`/__ptc_sdk__/ptc-sdk.js`) for every registered game, so nothing needs
    vendoring into the game's own directory.
  - **Proof, from-scratch:** `games/dice-demo` — a purpose-built toy with no
    playtest-crew-specific code beyond one `exposeState()` call — runs,
    replays 3/3, and hunts cleanly through the unmodified pipeline
    (`run`/`replay`/`verify`/`hunt` all work; only `GameConfig` matters to
    them, not how a game implements it).
  - **Proof, real third-party code:** `games/minesweeper` (vendored,
    unmodified apart from the two documented SDK steps) — 3/3 replay,
    and a real, previously-unknown bug found and 3/3-verified on the
    first extended run (filed upstream, see below). This is a small,
    low-stakes repo, so treat it as proof the mechanism works, not proof
    the harness is valuable against something people actually play.
  - **Proof, bigger and actively-used:** `games/emoji-minesweeper` (905
    stars, live at muan.co/emoji-minesweeper) — same 3/3 replay result on
    a materially harder integration (100-cell board, per-cell
    DOM-property state, a board-reshuffling mechanic, real network/SW
    noise); see the upstream-bug entry below for the honest result of
    hunting it (mechanism reconfirmed, no defect found yet).

## Post-v0

Deferred items live in [TODOS.md](TODOS.md).
