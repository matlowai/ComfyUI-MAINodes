# Astra final source review — 2026-11-08

Reviewed integrated WIP over `eb8cc3a`, 22:41 UTC. Bounded review of prior A1/A3 fixes, local adaptations, native instruction matcher and its new tests. No source edits or runtime mutation. Read `REVIEW.md`, complete `LOCAL_ADAPTATIONS.diff`, final host/service/dialog modules, native matcher/Library diffs and actual native board selection. Coordinator owns browser/runtime acceptance and the complete gate.

> **Final disposition: F1 and F2 resolved and independently verified.** The coordinator applied both narrow guards and regression tests. I read the final changes and independently ran `nice -n 19 node --test tests/snap/director/service-host.test.mjs`: **17/17 passed**, including both reproductions, disabled-board variants and the existing enabled-method cycle check. The native instruction/pin tests also passed **2/2**. No remaining serious source finding in this bounded review; full latest-snapshot qualification remains with the gate owner.

## Concrete findings (resolved)

### F1 — P2: unrelated board-method preferences can break Transform Footage

Original integrated `web/snap/director/service.mjs:81-84` requested `forTool(make_board)` for every snapshot unit regardless of strategy stages. Adding the current Book to an otherwise valid Transform Footage request exposed board-method cycles and failed the entire preview, even though that strategy has no boards stage. The new current-Book prefill makes this a reachable normal UI path.

Pure production-host harness reproduction:

```js
const h = harness();
h.preferences([
  h.note({view_method:'qwen21_view'}, 'method:ph3_view', 'person'),
  h.note({view_method:'ph3_view'}, 'method:qwen21_view', 'person', 'instruction:qwen@1'),
]);
const q = {strategy:'transform-footage@1.0.0', source_take:'take-original', inputs:{change:'A blue jacket'}};
// Without book: ok:true; stages orient/source/transform/critique/upscale.
await h.call('plan_strategy', q);
// Before fix: METHOD_SCOPE_CYCLE ph3_view → qwen21_view → ph3_view.
await h.call('plan_strategy', {...q, book:'book:film'});
```

Sent immediately to coordinator and integration owner. Coordinator applied an enabled-boards guard during review; it is now at service lines 82/85. The regression verifies both requests succeed, no `make_board` operation exists, and normal edit output remains; it additionally checks a strategy with its boards stage explicitly disabled. Independently verified PASS.

### F2 — P2: explicitly disabled upscale can still fail on its unused method cycle

`web/snap/director/service.mjs:87` checks the enabled stage but not the caller's explicit `parameters.upscale:false`. The method loop at lines 69-79 can reject the whole transform even though native planning must skip upscale.

Reproduced with:

```js
const h = harness();
h.preferences([
  h.note({upscale_method:'stage2'}, 'global', 'person'),
  h.note({upscale_method:'inherit'}, 'method:stage2', 'person', 'instruction:up@1'),
]);
await h.call('plan_strategy', {
  strategy:'transform-footage@1.0.0', source_take:'take-original',
  parameters:{upscale:false}, inputs:{change:'A blue jacket'},
});
// Before fix: METHOD_SCOPE_CYCLE stage2 → null → stage2.
```

Fixed by the coordinator at `service.mjs:71` and independently verified PASS. The final guard implements this narrow handling: an explicit request `upscale:false` cannot be overridden under existing precedence, so retain ordinary tool context if needed but do not resolve its unused method. Avoid treating every initially false inherited value identically: a method note may intentionally enable upscale under the existing typed-preference rules. The regression verifies `ok:true`, zero `upscale_take` and an empty method context. The existing enabled board-method cycle regression still fails clearly as intended and passed in the same focused run.

No other serious correctness regression was found in this bounded review. These findings concern resolving inactive operations; the stable-method loop itself terminates or detects a repeated method, and the selected method context is now passed to the native instruction resolver.

## Prior findings and small adapter changes

- **A1 addressed for active operations:** `host.mjs:59` now passes the selected method; `methodFor` mirrors the actual native board purpose rule in `booktools.js:513` and `edits.js:684`, including explicit method precedence. Recast selects `remake_swap`; explicit upscale selects its own method. Unknown inherited upscale remains unresolved rather than guessing a backend. Empty brick context avoids leaking an unrelated open recipe.
- **A3 addressed at the relevant default:** `dialog.mjs:121-142` derives shot, scene or Book scope, respects an explicitly edited scope, and invalidates prepared notes after target changes. The root entry supplies current Book context, and the native Library rail uses that same entry. Common settings remain JSON; that is a known UX limit, not a commit-blocking regression.
- **First image omission:** `references.mjs:127` correctly reports exclusion of the required first-role image after budget selection. Existing ambiguity and required-reference checks still run. It changes proposal validity only, not native init graphs.
- **Removed arbitrary caps:** inspected changes preserve finite-number/type checks, structural schemas, cycle detection and native edit batches of three. No source/runtime correctness regression identified from the cap removals in ordinary supported inputs. This review did not stress pathological input sizes.

## Book matcher activation risk and proof boundary

`web/snap/instructions.js:97-101` now recognizes an explicit Book context, an explicit Book pin, or current native scene membership. Other scope branches retain their prior behavior. This intentionally activates previously stored Book notes; it is not a behavior-neutral refactor.

I independently ran:

```sh
nice -n 19 node --test tests/snap/director/native-instructions.test.mjs
```

**2/2 passed.** These tests evaluate the actual resolver/pin source with injected native dependencies: explicit Book scope, scene/shot membership, sibling exclusion, newly included queue refs and no mutation of the caller's workflow object. They are materially stronger than the old captured matcher excerpt. They do not inventory or approve the content of every production's old notes; their stubbed hash is not a digest-implementation test.

The coordinator separately reports real saved-note isolation and proposal checks passing on the isolated instance. F1/F2 are now independently verified fixed. The matcher evidence bounds this integration risk sufficiently for a reviewed WIP commit, subject to the required full gate. Before using an old production on changed serving code, inspect its actual resolved stack/pin delta, since legitimate old Book notes now apply. No new approval mechanism or compatibility switch is needed.

This review does not certify a full gate, GPU/media behavior, final exports or listening. It adds no feature requests beyond correcting F1/F2.
