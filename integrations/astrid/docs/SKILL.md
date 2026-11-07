---
name: snap
description: Drive Snap (ComfyUI-MAINodes) on a ComfyUI on this machine from Astrid: pages, page binding, one call per Snap tool, proposals that wait for the person, and letting go. Read snap-core next through snap.call.
---

# Snap from Astrid

Snap is a view over a local ComfyUI graph with its own tool table: recipes and bricks, takes, scenes and shots, Cast
and location records, the critic docket and the Book (beats, cuts, boards, the Cut). This pack calls that table; it is
a pointer, and Snap's own skills say how to use it well.

## Setup (once)

- `SNAP_BASE`: the ComfyUI, on this machine only, e.g. `http://127.0.0.1:8188` (anything else is refused).
- `SNAP_AGENT`: your name to Snap, e.g. `astrid-<session>`. Without it your calls can't hold a page.
- `SNAP_TOKEN`: only when a snap-gate stands in front of ComfyUI.

## Work

1. `snap.pages`: the person's Snap pages, who drives each, and where calls go.
2. `snap.call {tool: "use_page", args: "{\"page\": \"<id or name>\"}"}` binds you to one page (or pass `page` on
   your first call). One agent drives a page at a time; a page another agent holds answers with its name.
3. `snap.call {tool: "read_skill", args: "{\"name\": \"snap-core\"}"}`, then the task skill it points to.
4. `snap.call {tool: "<any tool>", args: "<JSON>"}`. `GET <SNAP_BASE>/mainodes/snap/tools` lists every tool and schema.
5. When you are done: `snap.call {tool: "use_page", args: "{\"page\": null}"}`. A hold idle for 10 minutes lapses.

## Read the answers

- `{proposed: "p12", status: …}` means it waits for the person (a GPU run, a Cast change, a story edit): not a failure.
  `list_proposals` shows their answers; a proposal whose record moved on is `stale` and is re-made, not accepted.
- `idempotency_key` comes back with each call. Retry a call with the same key (`idempotency_key` input): you get the
  first answer (`replayed: true`), or `in_flight: true` while it still runs; it never runs twice.
- Pictures come back as files listed in the result. Nothing is cut; long lists page explicitly.

## From a Cut to Astrid and back

The Cut reaches Astrid by the person's Push (or their Book's auto-push) on Snap's Cut lens, or by
`tools/astrid_push.py push --book <book>` from a shell: one timeline per Book in its production's project, clip ids =
the cut ids (`C7`), the dialogue on A2 with its words (`timelines words --published`). Each clip's `generation.snap`
names its take, cut, Book and pins. To ask for a re-take: `snap.call` the Book's tools (`get_book` → the unit →
`compile_unit` → `apply_unit` → `run`): it waits as a proposal in the Room; after the person accepts the new active take,
`tools/astrid_push.py swap --book <book> --cut C7` puts it into the same clip in place (same id, its new file, its
`generation.snap` and words). `generation.snap.dials` lists the steering dial rows the take ran, curve keys in the
take's own seconds, the clock of the words: to land a dial's peak on a word, `snap.call set_cut_dials {book, cut,
move_key: {dial, key: "peak", to_s: <the word's start>}}`, then `retake {take, dials: "cut", seed: "same"}`, then the
swap. Reads (`get_book`, `get_take`, `list_proposals`) answer even while another agent drives the
page; `withdraw_proposal` takes back your own out-of-date proposal, saying why.
