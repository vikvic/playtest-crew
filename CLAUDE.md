# playtest-crew
Read SPEC.md before any planning. Hard constraints:
- v0 scope only: one game, one Explorer agent, CLI, no dashboard, no SaaS, no Unity.
- 4-weekend deadline. If a plan exceeds it, cut scope, never the deadline.
- TypeScript + Bun. Playwright for browser control. Provider-agnostic LLMClient (Anthropic, OpenAI-compatible, Gemini).
- Every bug report must include a replayable input trace; non-replaying findings are demoted to flakes.