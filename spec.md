# playtest-crew — v0 Spec (Draft)

**One-liner.** A CLI that points an agent crew at a browser game plus a short game spec, plays it autonomously, and emits evidence-backed bug reports with a regression diff against the previous run.

**Purpose (in order).** (1) Learn agent-driven engineering by building it with a gstack-style sprint. (2) Produce the demo artifact for Plan 1 discovery calls. (3) Open-source visibility. Revenue is explicitly not a goal for v0.

---

## v0 scope

One game. One agent (Explorer). One report format. CLI only.

**In:** headless/headed Chromium via Playwright CDP; YAML game spec; input-trace recording; screenshot+state sampling; invariant checking; LLM-judged anomaly detection with a confidence gate; JSON + Markdown report with video; baseline snapshot and regression diff between runs.

**Out (v1+):** chaos agent, perf agent, multi-game dashboard, Unity/device runners, parallel swarms, any SaaS wrapper. If you catch yourself building any of these before v0 ships, stop.

## Architecture

```
playtest run --spec game.yaml --out runs/2026-07-04/
```

- **Runner** (TypeScript/Bun, matching the gstack ecosystem): launches Chromium via Playwright, loads the game, records video + input trace + console/network logs.
- **Perception:** screenshot every N actions + injected JS hook that serializes exposed game state (`window.__ptc_state` adapter per game). Canvas-only games with no readable state are v0's hardest problem — mitigated by target selection (below), vision-model screenshot reads as fallback.
- **Explorer agent:** loop of observe → propose action (LLM) → execute (CDP input) → evaluate. Goal: maximize state coverage (novel states visited) while checking invariants after every step.
- **Oracles:** three tiers — hard invariants from the spec (assertions on state/DOM: "score ≥ 0", "player position inside bounds"), console/JS errors and hangs (free bugs), and LLM anomaly judgment on screenshot pairs ("did something visually wrong happen?") gated at ≥8/10 confidence, mirroring gstack's `/cso` zero-noise pattern.
- **Reporter:** every finding = `{title, severity, oracle tier, invariant violated, repro input-trace, video timestamp, screenshots, console excerpt, confidence}`. Repro trace must replay — a bug that doesn't reproduce on replay gets demoted to "flake" automatically.
- **Baseline/diff:** run summary (states covered, findings, perf stats) stored per run; `playtest diff` compares two runs and flags regressions/fixes.

## Model layer (provider-agnostic by design)

One `LLMClient` interface, three impls at launch: Anthropic API, OpenAI-compatible endpoint (covers OpenAI, local vLLM/Ollama, most gateways), Gemini. Config in the YAML: `model: {provider, name, vision: bool}`. Cheap model for action proposals, stronger model for anomaly judgment — the two-tier routing gstack uses (Sonnet for actions, Opus for analysis) is the pattern to copy. This also gives you `playtest bench`: same game, same spec, different models — publishable comparison content for the newsletter.

## Game spec format (YAML)

```yaml
game: hextris
url: https://hextris.io          # or localhost build
viewport: {width: 1280, height: 800}
controls:
  left: ArrowLeft
  right: ArrowRight
goal: "Survive as long as possible; blocks clear when 3+ same color touch"
state_adapter: adapters/hextris.js   # exposes window.__ptc_state
invariants:
  - "state.score >= 0"
  - "state.blocks.length < 200"      # leak detector
  - "no console errors"
budget: {max_actions: 500, max_minutes: 15}
```

## Target game candidates (pick ONE for v0)

Criteria: open source, MIT-ish license, browser-native, readable JS state, known to still have open issues.

1. **Hextris** (MIT, canvas but simple global state) — good difficulty midpoint.
2. **2048** (MIT, DOM-readable grid) — easiest; use as the smoke-test target while building, not the demo.
3. **A Phaser-based open-source game with an issues backlog** — best demo value: find a *real* open bug, file it upstream with the agent's repro video. That single GitHub issue is the whole marketing plan for v0.

Stretch dogfood target: your own future prototypes (Pinfinity or jam games) become test subjects — the harness is the first user of everything you build after it.

## Build process — the agent-team experiment itself

Run the full gstack sprint and journal it:

1. `/office-hours` with the kickoff brief below → design doc.
2. `/autoplan` (CEO → design → eng → DX review) → approve plan.
3. Implement in Claude Code; `/review` every branch; `/codex` for one adversarial cross-model review (worth writing about).
4. `/qa` the CLI's own DX; `/ship` each milestone; `/retro` weekly.

Log for each skill: findings that were real vs. noise, where the agent over-engineered, what you overrode. **This log is deliverable #2** — the "what agent teams actually get wrong" post, which is more differentiated content than the tool itself.

### Kickoff brief (paste into `/office-hours`)

> I'm building playtest-crew: a CLI that points an LLM agent at a browser game plus a YAML spec (controls, goals, invariants) and has it play autonomously, checking invariants and judging screenshots for anomalies, then emitting bug reports with replayable input traces and video, plus a regression diff between runs. v0 is one game, one Explorer agent, no dashboard, no SaaS. My pain: game studios burn human hours on repetitive smoke/regression passes; I've built internal versions of this at a large platform company and want an open-source, model-agnostic harness I can demo to studios. Push back on scope, not ambition — I have a history of over-scoping and not shipping. Hard constraint: demoable in 4 weekends.

## Milestones (4 weekends, hard cap)

- **W1:** Runner + spec parser + video/trace recording; plays 2048 with random inputs; console-error oracle works end to end.
- **W2:** State adapter + invariant oracle + LLM action proposal on the real target game; first structured report generated.
- **W3:** Anomaly judge with confidence gate + replay-verification of repro traces + `playtest diff`.
- **W4:** README with 90-second demo video, one upstream bug filed on the target game, repo public, first build-log post.

## Success criteria & kill switch

**Success:** repo public with demo video; ≥1 real bug found that you didn't plant; repro-replay rate ≥80% of reported bugs; you can demo it live in under 5 minutes.
**Kill/park:** if after W2 the agent can't produce a single legitimate finding on the target game, write up why (that post is still valuable) and park it — do not extend the timeline by adding infrastructure.

## Known risks

Canvas-only games defeat DOM perception (mitigate via target selection + state adapters, not general vision, in v0). Token cost per run can balloon (budget caps in spec; cheap-model action loop). LLM anomaly judge false positives destroy trust (confidence gate + replay demotion). The meta-risk is you: infrastructure is comfortable, publishing is not — W4's deliverables are the ones that matter.
