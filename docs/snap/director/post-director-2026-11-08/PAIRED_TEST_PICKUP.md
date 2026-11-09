# Paired, human-led test pickup

Use `snap-research-2026-11-08`. Both full addenda, Astra's capability review and the [consolidated implementation plan](IMPLEMENTATION_PLAN.md) are on this branch. The current application source baseline is28260fa; newer commits add notes/evidence. The original lab continues its already approved video test separately.

## Pick up the code

From the MAINodes checkout on the other machine:

```sh
git fetch origin
git switch snap-research-2026-11-08
git pull --ff-only origin snap-research-2026-11-08
```

Use that machine's own ComfyUI instance, visible Snap page and local user data. Restart/reload as required by the normal install workflow, then verify the serving revision, tool table and page ownership. A Git checkout does not contain the first machine's live Book database, model weights or private profile. Use a small local Book or a native export you choose to import. The [review media](../dogfood-2026-11-08/review.html) is evidence, not a runtime database.

## Use existing controls for the paired trial

Start with **Let agents run off** and the Book's relevant stages at **assist**, set through the normal UI on this test instance. This deliberately exercises native proposals and human choices. It does not alter the original lab or create a new product mode. Later, compare a collaborate stage if you want approved render work to proceed with fewer button presses.

The agent prepares context, options, previews and reviewable work. The human chooses story/style, visual direction, candidate picks and scope changes. Once a concrete batch is authorized, preserve that authorization instead of asking the same question again. Reversible reads/preparation should keep moving. Do not bypass the native route with confirmed flags or change autonomy to evade a decision.

Keep intent and actor truthful: a human can direct an agent to apply an approval in chat, with the actual quote retained and execution still labeled agent. Machine QA is analysis, even when legacy metadata says by=person. Release page ownership while the human chooses; resume only when the direction is clear. Keep this trial on its own instance so it cannot change the running lab's profile or page.

## One small paired test

- State a short brief and intended Book; verify the agent uses that destination and separates observed facts from guesses.
- Preview a strategy. Confirm scope and parameters; verify preview starts no render and writes no creative canon.
- Review one concrete story/style proposal, amend it if desired, then approve through the native path. Verify the accepted version and actual actor metadata.
- Prepare a tiny board/candidate pair. Use keyboard navigation and Escape as well as the pointer. Check the candidate/result reached by Work Open.
- Choose the visual direction yourself, then authorize one render or concrete batch. Confirm started/ready/failed state, reload survival and result navigation.
- Make one small direction change. Check what becomes stale and what will be redone before approving it. Avoid gratuitous changes to a valuable production; use the small test Book.
- Choose the take, inspect the actual assembled export with sound, and record what the agent checked versus what the human saw/heard.

Record friction plainly: confusing labels, unnecessary repeated questions, wrong target, hidden technical requirements, unwanted action, lost input/focus, duplicate jobs, missing stale state, slow review or weak options. Keep the receipt/screenshot and the smallest expected behavior. Current raw Book-ID/JSON controls and broader Room accessibility/attribution gaps are known open findings; the candidate fallback Escape issue is already fixed.

## Before the next implementation branch

Use the [plan](IMPLEMENTATION_PLAN.md) to select one coherent change. Keep the rest explicitly queued. The first aim is useful human control with good agent preparation; automatic technique improvement and speech are later, separately verified capabilities. Read the [cloud handoff](../../CLOUD_HANDOFF_2026-11-08.md) for exact current qualification limits and [Astra's full review](ASTRA_REVIEW.md) for source evidence.
