/**
 * playtest-crew SDK — the entire integration surface for a game that wants
 * to be playtested by the harness, beyond the YAML spec (specs/<game>.yaml).
 *
 * Include this script FIRST in your page (before your game's own scripts),
 * then call:
 *
 *   window.PTC.exposeState(() => yourStateObject);
 *
 * whenever your state is ready or changes — the harness calls the function
 * you pass it after every dispatched action, so it should always return the
 * CURRENT state, not a snapshot taken once. That's the only required call.
 *
 * What this script does NOT do: patch your game's randomness. That's a
 * harness-side concern — set `seed_strategy: global-random-patch` in your
 * game's spec, and the harness overwrites `Math.random` itself before your
 * page's scripts run (see src/prng.ts). Your code never needs to touch
 * Math.random, __ptc_rng, or anything seed-related; just call Math.random()
 * normally, same as if this SDK didn't exist.
 *
 * State must be JSON-serializable (plain objects/arrays/strings/numbers/
 * booleans/null) — the harness hashes it as canonical JSON. exposeState
 * validates this immediately with a clear error rather than letting a bad
 * shape surface as a mysterious hashing failure deep in a run.
 */
(function () {
  "use strict";

  var stateFn = null;

  window.PTC = {
    /**
     * Register the function the harness calls to read your game's current
     * state. Call this once; call it again to replace the function (e.g.
     * if state moves to a different object after a reset).
     */
    exposeState: function (fn) {
      if (typeof fn !== "function") {
        throw new Error("PTC.exposeState() needs a function that returns your state, got " + typeof fn);
      }
      stateFn = fn;
      window.__ptc_state = function () {
        var state = stateFn();
        try {
          JSON.stringify(state);
        } catch (e) {
          throw new Error(
            "PTC.exposeState(): the state your function returned isn't JSON-serializable (" +
              e.message +
              "). Only plain objects/arrays/strings/numbers/booleans/null are allowed — " +
              "no functions, undefined, Dates, Maps, or circular references.",
          );
        }
        return state;
      };
    },
  };
})();
