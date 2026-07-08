# TODOs — deferred from v0 (post-4-weekend items)

Source of truth for context: the design doc at
`~/.gstack/projects/playtest-crew/vic-master-design-20260706-234327.md`.

## 1. OpenAI-compatible + Gemini LLMClient implementations
- **What:** Ship the two remaining provider impls behind the existing `LLMClient` seam (Anthropic ships in v0/W2).
- **Why:** CLAUDE.md mandates provider-agnostic; v0 satisfies it by interface only (recorded deviation — see "Constraint reconciliation" in the design doc).
- **Depends on:** the `LLMClient` seam existing (W2).
- **Start:** copy the Anthropic impl's shape; OpenAI-compatible first (covers vLLM/Ollama/gateways).

## 2. `playtest bench` — cross-model comparison command
- **What:** Same game, same YAML spec, different models; publish the comparison as build-log content.
- **Why:** the `LLMClient` seam's secondary justification; publishable newsletter material.
- **Depends on:** TODO 1 (needs ≥2 providers to compare).

## 3. Formalize the precision metric
- **What:** Track "fraction of verified findings a human agrees are real bugs" as a first-class metric alongside replay survival.
- **Why:** replay survival measures reproducibility, not truth (outside-voice finding #5); v0 handles this informally via human sanity-check before filing.
- **Depends on:** enough real findings to measure (post-W3 hunt).

## Also recorded in the design doc (not duplicated here)
- Virtual-time replay spike → Open Question 5 (W3 timeboxed).
