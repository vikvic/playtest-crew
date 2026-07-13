/**
 * Replay-verification verdict (pure logic, W2; the pipeline that produces
 * ReplayObservations by actually re-running cut traces is W3).
 *
 * Design doc "Run Outcomes":
 * - finding  — the same oracle fired again within ±replay_index_tolerance
 *              (default 3) of the original index on EVERY replay (3/3).
 * - flake    — anything less: refire outside tolerance, missing refire, or
 *              <3/3 reproduction. Pre-decided policy: timing-sensitive real
 *              bugs that fail the tolerant bar ship as flake evidence; the
 *              strict bar is never loosened past ±3 to rescue a demo.
 * - preStateHash mismatches BEFORE the refire point do not fail the
 *   reproduction; they independently mark the trace nondeterministic:true —
 *   a trust signal in the report, not a verdict.
 */

export const DEFAULT_REPLAY_INDEX_TOLERANCE = 3;
export const REQUIRED_REPRODUCTIONS = 3;

/** What one replay of a cut trace observed. */
export interface ReplayObservation {
  /** Action index where the same (oracle, signature) refired; null = never. */
  refiredAtIndex: number | null;
  /** First preStateHash mismatch index; null = every hash matched. */
  firstHashMismatchIndex: number | null;
}

export interface Verdict {
  verdict: "finding" | "flake";
  /** Replays (out of observations.length) where the refire landed in tolerance. */
  reproductions: number;
  /** Any pre-fire hash mismatch across the replays. Trust signal only. */
  nondeterministic: boolean;
}

function reproduced(
  originalIndex: number,
  obs: ReplayObservation,
  tolerance: number,
): boolean {
  return (
    obs.refiredAtIndex !== null && Math.abs(obs.refiredAtIndex - originalIndex) <= tolerance
  );
}

function sawPreFireMismatch(originalIndex: number, obs: ReplayObservation): boolean {
  if (obs.firstHashMismatchIndex === null) return false;
  // "Before that point" = before where the oracle (re)fired; if it never
  // refired, everything up to the original fire index counts as pre-fire.
  const firePoint = obs.refiredAtIndex ?? originalIndex;
  return obs.firstHashMismatchIndex <= firePoint;
}

export function judge(
  originalIndex: number,
  observations: ReplayObservation[],
  tolerance: number = DEFAULT_REPLAY_INDEX_TOLERANCE,
): Verdict {
  const reproductions = observations.filter((o) =>
    reproduced(originalIndex, o, tolerance),
  ).length;
  const nondeterministic = observations.some((o) => sawPreFireMismatch(originalIndex, o));
  return {
    verdict:
      observations.length >= REQUIRED_REPRODUCTIONS && reproductions === observations.length
        ? "finding"
        : "flake",
    reproductions,
    nondeterministic,
  };
}
