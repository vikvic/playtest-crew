# TODOs — deferred from v0 (post-4-weekend items)

Source of truth for context: the design doc at
`~/.gstack/projects/playtest-crew/vic-master-design-20260706-234327.md`.

## 1. Get a defect-level finding on a bigger, actively-used real game
- **What:** `games/emoji-minesweeper` (muan/emoji-minesweeper, MIT, 905
  stars, updated days ago, live at muan.co/emoji-minesweeper) is done —
  a real, bigger, messier game (100-cell board, per-cell DOM-property
  state, a board-reshuffling first-click-safety mechanic, analytics +
  service worker noise) integrated via the SDK model, 3/3 replay
  verified. **Still open:** a 20-seed hunt against it found 2 verified
  (3/3) hang candidates, but on inspection neither is a real defect —
  both are the hang oracle correctly catching a no-op streak after an
  early flood-fill reveal exposed most of the board in one click. So
  the bigger-target integration is proven, but the "finding that
  demonstrates product value to someone other than us" goal from the
  previous version of this item is still unmet.
- **Why:** replay survival and hunt correctness are proven twice now
  (minesweeper, emoji-minesweeper); a *defect* found on something people
  actually play — not a mechanism proof — is the piece still missing.
- **Depends on:** either deeper hunting against `emoji-minesweeper`
  (more seeds, larger budgets, or a real invariant violation rather than
  a hang) or a third target. Two side-findings from this attempt worth
  folding into whichever comes next: (a) `exposeState()` here exposes
  full ground truth (unmasked bomb locations) rather than the
  player-visible view — a deliberate, documented choice for this game,
  but worth deciding as a general SDK convention; (b) the local 7B
  explorer (`qwen2.5:7b-instruct`) repeats action picks over a 100-item
  action alphabet that it reliably avoids over 2048's 4-item one — a
  real scaling limit on the explorer's ability to track "which of N
  things did I just pick" as the action space grows, independent of
  reasoning quality.

## 2. Formalize the precision metric
- **What:** Track "fraction of verified findings a human agrees are real bugs" as a first-class metric alongside replay survival.
- **Why:** replay survival measures reproducibility, not truth (outside-voice finding #5); v0 handles this informally via human sanity-check before filing.
- **Depends on:** enough real findings to measure (post-W3 hunt).

## 3. Scripted action prefix — steer the driver deterministically
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

## 4. Vision-based perception (OpenCV / vision model) for closed games
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

## 5. Real-time games: virtual-time control (pause/step the game loop)
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

## 6. UX-issue reporting (subjective findings alongside bugs)
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
- **Depends on:** TODO 2's precision metric thinking (how to keep trust
  measurable for unverifiable findings).

## 7. Other game platforms (beyond the browser)
- **What:** Unity / native / mobile targets.
- **Why recorded:** asked for explicitly; nearest in-scope expansion is
  other *browser* engines (Phaser spikes, deferred from W2/W3). Anything
  beyond the browser replaces the whole Playwright/CDP input+state layer —
  a strategic post-v0 decision, not an incremental feature.
- **Depends on:** demand evidence (the outreach checkpoint) pointing at a
  platform; Phaser spikes first as the cheap expansion.

## Also recorded in the design doc (not duplicated here)
- Virtual-time replay spike → Open Question 5 (W3 timeboxed) — now TODO 5.
