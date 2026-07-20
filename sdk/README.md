# playtest-crew SDK

The low-effort integration path — for when [docs/PORTING.md](../docs/PORTING.md)'s full
checklist (fork the game, hand-patch every `Math.random()` call site,
hand-write a state adapter) is more than a game needs.

Compare the two models:

| | Fork model (2048, `docs/PORTING.md`) | SDK model (this) |
| --- | --- | --- |
| Vendoring | game forked into `games/<name>/` | same — still served locally by the harness, but nothing in the game's source is touched for determinism |
| RNG determinism | every `Math.random()` call site hand-patched to `(window.__ptc_rng \|\| Math.random)()` | **zero call sites touched** — the harness overwrites `Math.random` globally (`seed_strategy: global-random-patch` in the spec) |
| State exposure | a bespoke `readState`/`waitUntilReady` pair in `src/games/<name>.ts` | one call — `window.PTC.exposeState(() => state)` — and `src/games/sdk.ts`'s generic `sdkGameHooks({name, dir})` supplies the rest |
| TypeScript hooks needed | ~20–30 lines | **zero** |

`games/dice-demo` is the worked example: a from-scratch turn-based game with
no playtest-crew-specific code beyond the one `exposeState` call, proven to
run/replay/hunt through the full harness (`specs/dice-demo.yaml`,
`src/games/index.ts`).

## Integration (the whole thing)

1. In your page, load the SDK before your own game scripts:

   ```html
   <script src="/__ptc_sdk__/ptc-sdk.js"></script>
   ```

   (The harness serves this at a fixed path for every registered game —
   nothing to vendor or copy into your project.)

2. Whenever your state is ready or changes, call:

   ```js
   window.PTC.exposeState(() => yourStateObject);
   ```

   Pass a function, not a snapshot — the harness calls it fresh after every
   dispatched action. The state must be JSON-serializable (plain
   objects/arrays/strings/numbers/booleans/null); `exposeState` validates
   this immediately with a clear error instead of letting a bad shape
   surface as a mysterious hashing failure mid-run.

3. In your game's spec (`specs/<name>.yaml`), set:

   ```yaml
   seed_strategy: global-random-patch
   state_source: adapter
   ```

4. Register the game with the generic hooks factory instead of writing your
   own (`src/games/index.ts`):

   ```ts
   import { sdkGameHooks } from "./sdk.ts";
   // ...
   "your-game": sdkGameHooks({ name: "your-game", dir: "games/your-game" }),
   ```

That's it — `run`, `replay`, `verify`, `hunt`, and `bench` all work exactly
as they do for 2048, because they only ever depend on the `GameConfig`
contract, not on how a given game happens to implement it.

## What this doesn't cover

- **Non-`Math.random` entropy** (`crypto.getRandomValues`, `Date.now()`-seeded
  logic). The global patch only intercepts `Math.random`; a game drawing
  randomness from elsewhere needs the fork model's per-call-site approach
  instead.
- **Dynamic/appearing action spaces** (menus, buttons that only exist in
  certain states). The action alphabet in the spec is still static — see
  the README's "Action model" section for the current limits.
- **Real-time games.** Turn-based only, same as the rest of v0.
