# Build log: four weekends of playtest-crew

Playtest-crew is an automated playtesting harness for browser games — an
agent plays the game inside a real Chromium browser, oracles watch for
failures, and every finding ships with a **replayable input trace**: a bug
report you can re-run and watch reproduce, deterministically, 3 times out
of 3. This is the first post; here's what four weekends of building it
looked like, warts included.

## The bet

Most "AI plays your game" demos stop at "look, it can play the game."
That's not useful to a studio — the useful claim is "here's a bug, here's
exactly how to make it happen again." Reproducibility, not cleverness, was
the whole bet. Everything below is downstream of one design choice made in
week 1: hash the game state *before* every dispatched action, record it,
and make replay walk the identical code path as recording. If a bug
doesn't reproduce 3/3 on replay, it's a flake, not a finding — no exceptions,
no "trust me."

v0 scope, on purpose: one game (a seeded fork of
[2048](https://github.com/gabrielecirulli/2048)), one Explorer agent, CLI
only, no dashboard, no SaaS. Four weekends, hard deadline — if a plan
didn't fit, the plan got cut, not the deadline.

## Week 1 — can this even be deterministic?

Built the trace format, the replayer, a seeded 2048 fork, a random-walk
runner, and a console-error oracle. The entire week was really one
question: can a browser game be made to replay identically? Determinism
came from patching the fork's random calls to a seeded PRNG injected
*before* any game script runs, plus dispatching input through Chrome
DevTools Protocol events instead of OS-level input. Proved end-to-end: 3/3
replays, 60/60 hash matches, and a deliberately planted bug reproduced at
the exact action index every time.

Recorded deviation: Bun can't complete Playwright's Chromium launch
handshake on Windows, so the CLI transparently re-execs itself under Node.
Annoying, invisible to everything downstream.

## Week 2 — teaching the harness what a game *is*

A YAML spec per game (actions, budgets, invariants, terminal states) so
adding a new game doesn't mean touching the executor. Invariant and hang
oracles. And the first LLM Explorer: state JSON in, one action out,
constrained to a fixed action alphabet via a JSON-schema enum so the model
literally cannot propose an illegal move.

The Explorer's first real bug wasn't in the game — it was in the prompt.
The model kept describing two side-by-side tiles as "vertically adjacent."
Turned out the fork's grid is serialized column-major (`grid[x][y]`), and
the model assumed rows. Fixed with a `state_notes` field in the spec: a
plain-English note on how to read the state, injected into the system
prompt. Measured result once that was fixed: the Explorer covered 83
distinct states against random's 62 on the same 100-action budget — +34%,
mostly because random burns budget on moves that do nothing and the
Explorer learns to stop trying them.

## Week 3 — from "candidate" to "finding"

A run can only produce *candidates* — something that looked wrong once.
Week 3 built the judge: replay each candidate's cut trace three times with
the oracles watching, and only call it a finding if the same failure
refires on every single replay within a small tolerance window. Anything
less is a flake, evidence kept but not shipped as a bug report.

Then the unattended hunt: sweep N seeds, auto-verify every candidate, write
one report with findings, flakes, and over-budget candidates kept strictly
separate. Validated the whole pipeline the same way week 1 validated
determinism — plant a bug on purpose, watch it get caught, revert it.
Planted invariant fired at action 14, verifier judged it FINDING 3/3.
A 5-seed, 750-action smoke hunt afterward found nothing — and said so
plainly. "0 findings" is a valid report, not a bug in the report.

## Week 4 — the pivot, and the shipping weekend

The plan going into week 4 was: file a real bug against upstream 2048,
make the repo public, ship a demo video, write this post. First thing that
happened: filing an upstream bug meant running the hunt against the real
2048, and that meant reasoning honestly about who'd ever run this thing.
Every run so far had been against a paid cloud API. That's a fine way to
build a harness; it's a bad way to hand someone a tool and say "try it."

So the upstream bug got deferred and the local-LLM path got pulled
forward instead — a provider-agnostic `LLMClient` was already the
CLAUDE.md-mandated shape, the OpenAI-compatible half of it was just
unwritten. Ollama's `/v1/chat/completions` endpoint turned out to support
schema-constrained JSON output the same way Anthropic's API does, so the
Explorer needed zero changes — just a second `LLMClient` implementation
and a `--llm-provider` flag. First real run against a local `llama3.2`:
60/60 calls resolved, zero fallbacks, 51 distinct states. No API key,
no per-token cost, no cloud dependency for anyone who wants to try this.

The demo video in the README is that exact run's actual output — the
harness's own Playwright recording, not a staged screencast — with the
full decision log (every move, with the model's stated reasoning)
checked in alongside it.

Also shipped this weekend: CI now replays the checked-in baseline trace
three times on every push, so "does this still reproduce" stops being a
manual step before merging.

## What's next

Repo is staying private a little longer. Filing a real upstream 2048 bug,
Phaser-engine replay-fidelity spikes, virtual-time control for real-time
games, and a Gemini `LLMClient` are next up — tracked with reasoning in
[TODOS.md](../../TODOS.md). The build stays boring on purpose: Playwright,
JSON, SHA-256. Boring layers are the ones you can make deterministic, and
determinism is the entire product.
