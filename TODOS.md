# TODOs — deferred from v0 (post-4-weekend items)

Source of truth for context: the design doc at
`~/.gstack/projects/playtest-crew/vic-master-design-20260706-234327.md`.

## 1. Gemini LLMClient implementation
- **What:** The remaining provider impl behind the existing `LLMClient` seam.
- **Why:** CLAUDE.md mandates provider-agnostic; Anthropic (v0/W2) and
  OpenAI-compatible (W4, see ROADMAP.md — covers local models via
  Ollama/vLLM plus any hosted OpenAI-compatible gateway) now ship; Gemini
  is the last recorded deviation.
- **Depends on:** the `LLMClient` seam existing (W2).
- **Start:** copy the OpenAI-compatible impl's shape (Gemini's REST API is
  closer to it than to Anthropic's).

## 2. `playtest bench` — cross-model comparison command
- **What:** Same game, same YAML spec, different models; publish the comparison as build-log content.
- **Why:** the `LLMClient` seam's secondary justification; publishable newsletter material.
- **Depends on:** TODO 1 (needs ≥2 providers to compare).

## 3. Formalize the precision metric
- **What:** Track "fraction of verified findings a human agrees are real bugs" as a first-class metric alongside replay survival.
- **Why:** replay survival measures reproducibility, not truth (outside-voice finding #5); v0 handles this informally via human sanity-check before filing.
- **Depends on:** enough real findings to measure (post-W3 hunt).

## 4. Scripted action prefix — steer the driver deterministically
- **What:** Let a run start with a declared, fixed action sequence ("always
  do X first"), then hand control to the driver (random or explorer). Likely
  a `setup_actions` list in the YAML spec, executed through the same
  executor path so it lands in the trace like any other action.
- **Why:** Gets past menus/tutorials and reaches a specific game phase
  before exploration starts; also the cheapest form of "influence the LLM"
  — soft steering already exists via `state_notes` + action descriptions.
- **Depends on:** nothing — executor and trace already treat all actions
  uniformly.
- **Start:** parse `setup_actions` in `src/spec.ts`, dispatch them before the
  driver loop in `src/runner.ts`.

## 5. Vision-based perception (OpenCV / vision model) for closed games
- **What:** A perception layer for games that can't expose
  `window.__ptc_state()` (canvas-only, no source access): screenshot →
  vision model or CV → structured state.
- **Why:** v0 deliberately anti-scoped this (spec.md: "state adapters, not
  general vision") because pixels are nondeterministic and unhashable —
  vision breaks the replay-3/3 hashing core. Any design must keep the input
  trace deterministic and treat vision output as *perception*, not as the
  replay-verification hash source.
- **Depends on:** a real target game that justifies it; an answer for what
  `preStateHash` means without a state adapter (perceptual hash? input-only
  traces with screenshot diffing?).
- **Start:** as a spike on one canvas game, same 30-minute disqualification
  format as the Phaser spikes.

## 6. Real-time games: virtual-time control (pause/step the game loop)
- **What:** Harness-controlled game clock — fake `performance.now()` /
  `requestAnimationFrame` / timers via injected shims so real-time games can
  be paused, single-stepped, and replayed deterministically.
- **Why:** Everything today assumes turn-based (state settles between
  actions). This is the gate to live-action games. Was the W3 timeboxed
  spike (Open Question 5); deferred because 2048 is turn-based — there was
  no live target to validate against.
- **Depends on:** vendoring the first real-time game (do both together).
- **Risk:** virtual time can itself break replay fidelity — stays a spike
  until proven.

## 7. UX-issue reporting (subjective findings alongside bugs)
- **What:** Extend the hunt report beyond oracle-verified bugs to
  LLM-judged user-experience issues (confusing states, unclear feedback,
  dead-feeling interactions), sourced from the explorer's per-step
  reasoning (`llm.jsonl`) and/or a post-run judge pass.
- **Why:** The bug half shipped in W3 (`report.md`); UX issues are the other
  half of what a human playtester delivers.
- **Risk (why it was cut from v0):** the design doc flags the LLM anomaly
  judge as a false-positive/trust risk. UX findings can't be
  replay-verified, so they must be reported in a clearly separate,
  lower-trust section — never mixed with verified findings.
- **Depends on:** TODO 3's precision metric thinking (how to keep trust
  measurable for unverifiable findings).

## 8. Other game platforms (beyond the browser)
- **What:** Unity / native / mobile targets.
- **Why recorded:** asked for explicitly; nearest in-scope expansion is
  other *browser* engines (Phaser spikes, deferred from W2/W3). Anything
  beyond the browser replaces the whole Playwright/CDP input+state layer —
  a strategic post-v0 decision, not an incremental feature.
- **Depends on:** demand evidence (the outreach checkpoint) pointing at a
  platform; Phaser spikes first as the cheap expansion.

## Also recorded in the design doc (not duplicated here)
- Virtual-time replay spike → Open Question 5 (W3 timeboxed) — now TODO 6.
