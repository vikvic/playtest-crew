# Roadmap — v0 (4 weekends)

Source of truth for full detail: the design doc at
`~/.gstack/projects/playtest-crew/vic-master-design-20260706-234327.md`.

## W1 — done

Trace format + replayer, seeded 2048 fork, random runner, console-error oracle.

Determinism proven end-to-end: 3/3 replays, 60/60 hash matches; planted-bug
pipeline reproduced at the exact action index (`runs/w1-planted/`).

Recorded deviations: Windows Bun→Node hop; 2048 uses `stateSource: "adapter"`
instead of DOM; oracle validated via a temporary planted bug (reverted).

## W2

- Phaser candidate shortlist + replay-fidelity spikes (slipped from W1 per the
  pre-declared cut order): vendor, patch, record 60 actions, replay 3× —
  disqualify bad fits before committing.
- YAML game-spec parser (makes most of `GameConfig` declarative).
- Invariant + hang oracles (hang oracle guarded by `terminal_states`).
- `LLMClient` seam + Anthropic implementation; Explorer loop with the
  beat-random success criterion.
- `playtest rebaseline` command.

## W3

- Replay verification of candidate findings: 3/3 reproduction, ±3 action-index
  tolerance, `max_verifications` budget (default 5).
- Unattended bug hunt (honest fallback deliverable if no real bugs surface).
- Virtual-time spike (Open Question 5): fake `performance.now()` /
  `requestAnimationFrame` to accelerate real-time games — timeboxed, since
  virtual time can itself break replay fidelity.

## Post-v0

Deferred items live in [TODOS.md](TODOS.md).
