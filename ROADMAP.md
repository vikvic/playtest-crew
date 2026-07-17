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

## Post-v0

Deferred items live in [TODOS.md](TODOS.md).
