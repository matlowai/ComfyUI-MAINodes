# MAI video tools (alpha)

Three nodes and one widget that remove drudgery around renders without taking
any decision away from you. None of them runs a model.

## MAI Video Out (file + sidecars + draft preview)

Save Video with the record beside it. Frames (+ audio) go through ComfyUI's
own encoder (h264 / av1, CRF), exactly like Create Video + Save Video; the
extras are each off unless wired or toggled:

- `hold_map` -> `<prefix>_00001_.holdmap.json`: the clock that produced these
  frames. H3 Load Hold Map and the deck's hold-map staircase read it.
- `write_meta` -> `<prefix>_00001_.meta.json`: seeds, models, LoRAs, steps,
  samplers, inject schedule, encode time, your `notes`, all read out of the
  graph that ran. The compare viewer's metadata strip and the scorer's labels
  come from here instead of from file names.
- `draft_preview` + `latent`: decode the sampled latent through the tiny VAE
  in `models/vae_approx` (`taeh3` for H3; any stem) into `<prefix>_draft.mp4`.
  The tiny VAE is loaded for that call and released after; with the toggle
  off nothing is loaded and nothing runs. Cost measured 2026-08-21: 8 ms per
  latent frame at 864x480, 21 ms at 1344x768, 42 ms at 1080p.

## MAI Load Video (path) / MAI Select Every Nth

The two things the graphs still took from VideoHelperSuite: a video by
absolute or input-relative path (as ComfyUI's VIDEO type, frames and fps
alongside), and every n-th frame from an offset. For a smeared clip use H3
Exact Recover instead; it is exact.

## MAI Video Compare (2-6, synchronized)

It is the review surface of `tools/compare_deck/` inside ComfyUI, grown
into a full player. Wire 2 to 6 renders into the node and queue once: it
writes each one as a small h264 preview (CPU, no VAE, no tensors kept) and
the widget plays them as live `<video>` elements, so it costs no VRAM.
Driving it, once the previews load:

- **Pick the pair.** Keys 1 to 6 choose sources (the last two pressed are A
  and B), and the mode buttons switch between side by side, flip, wipe and,
  for more than two, a synchronized grid. Hover a source to hear it, click
  to lock its audio there.
- **Move together.** Space plays and pauses everything, the arrows step one
  frame (shift steps 12), F flickers A against B. All sources stay on the
  lead's clock.
- **Loop the moment that matters.** The timeline draws the A side's stereo
  waveform, and the loop brackets are always live: `i` and `o` set them from
  the playhead, or drag the grab tabs, or double-click to reset to the whole
  clip. Playback stays inside the brackets, which is how you watch one seam
  fifty times without touching anything.
- **Let the graph mark it up.** Wire `H3 Time Smear`'s `hold_map_used` into
  the node's `hold_map` and the regenerated window is drawn as a band with
  enter and exit blips as the playhead crosses it. `curves` takes
  `{name: [per-frame floats]}` and draws each as a lane under the playhead.
  Both inputs are optional and were appended last, so older graphs keep
  their widget order.
- **Keep the verdict.** Enter stars the B side, which sets the node's
  `winner` widget; the NEXT queue passes that source through `winner_video`
  and `winner_index`. Pick, then finalize in a second execution: a graph
  never waits on a human mid-run.
- **Export what you just watched.** The export button renders the current
  pair, in the current mode, over the current loop, plus a two second end
  card carrying each side's label, seed, frame count, fps and size. It is
  frame-exact through WebCodecs (VP9, AV1 or H.264, up to 100 Mbps, Opus
  audio) and falls back to real-time capture where WebCodecs or the muxers
  are unavailable, which the dialog says before you press anything. The two
  muxers are vendored under `web/vendor/` (MIT, see its README).
- The gear panel holds the rest: region edit, the frame counter overlay, and
  which blips fire. Its settings are per node and survive a reload.

Known issues (alpha): in-node playback sync between sources is
approximate and can drift or stagger, and scrubbing during playback can
wedge the transport (re-queue or reload recovers). In clock sync mode
audio follows only the clock-owning side, so locking audio to the other
pane is silent until sync mode is flipped. The realtime export records
audio from the locked side even when it is not one of the two playing
panes; prefer the precise export. The standalone deck
pages (`tools/compare_deck/`) are the reliable review surface today; a
combined-single-stream preview that removes the sync problem by
construction is the planned next iteration.

The original wiring notes:

A media UI, not a processing stage. The node writes each wired VIDEO once as a
small h264 preview into the temp directory (CPU, no VAE, no tensors kept) and
the widget plays them in the browser with the flipbook's player: one set of
live `<video>` elements, buffered start-together, flip / wipe / side-by-side
for a pair, a grid for more.

- hover a source to hear it, click to lock its audio
- space play/pause all, arrows step all one frame (shift: 12), F flicker A/B
- 1-6 pick the pair (last two pressed), Enter stars the B side
- the star sets the node's `winner` widget; the NEXT queue passes that source
  through `winner_video` (and `winner_index`). Pick, then finalize in a second
  execution: a graph never waits on a human mid-run.

The flipbook deck (https://matlowai.github.io/flipbook/derope.html) is the
offline twin, same player code.

## MAI Seed Hunter (compare + winner seed)

Video Compare that knows about seeds: wire 2-6 cheap candidates and the seed
each ran on (labels default to the seed), star the keeper, and the NEXT queue
passes the starred candidate's seed out of `winner_seed` for the finalize
pass's RandomNoise (and its video out of `winner_video`). The seed-hunt pass
and the finalize pass are two executions by design.

## MAI Motion Editor additions

Alpha. The editor's rows, modal, undo and run buttons have only been exercised by
an automated browser so far; expect rough edges, and treat anything surprising
as a bug to report rather than a design choice.

Verified headless against a lab instance (2026-08-22, Playwright): run-to-here
renders base + oracle + filmstrip and holds the graph; a drag on the block lane
creates exactly the dragged range (snapped to the token grid); the live envelope
drives the dilated clock, the play loop and the price before any render; the
modal applies as one undo step; run-from-here resumes at the editor with the
whole base chain from ComfyUI's cache (14 nodes cached, editor + downstream
executed); a fresh page load restores the last run's filmstrip from the server.

- **run to here / run from here** on the node: the first is partial execution
  (nothing downstream), the second a normal queue where unchanged upstream
  nodes come from the cache, so it resumes at this node. Editing a row then
  "run from here" is the retry loop.
- **Undo**: the node's undo/redo is the fine-grained one (every row edit, drag,
  modal apply). ComfyUI's own ctrl+z jumps back to the graph's last snapshot
  (the widget re-hydrates from it and says so); the graph tracker does not see
  edits made inside the widget individually, so ctrl+shift+z at graph level
  has nothing to redo after that. Use the node's buttons or ctrl+z/ctrl+shift+z
  while the editor has focus.
- **hold_until_edited** (default on): with no rows, a run stops after the
  filmstrip; lay out rows and run again.
- **Cache reality**: ComfyUI keeps only the previous prompt's outputs, so
  running other graphs in between evicts the base pass and the next
  run-from-here re-renders it. The other way to lose the cache is a seed that
  moves: the frontend's default "control after generate" is randomize on
  nodes it builds, so the plain Run button re-renders the base every time
  until both RandomNoise nodes are set to fixed. The node's run buttons pin
  every seed control to fixed before queueing.

- **Play** (space): the filmstrip plays at fps; in the dilated clock each
  frame lingers for its hold, so the slowdown is seen, not inferred.
- **clock: world / dilated**: the timeline's x-axis reads as "when" (frame)
  or as "how long it costs" (cumulative holds). The compiled hold curve from
  the last run is drawn over the jerk profile in both.

## Paste an API workflow

With the pack installed, Ctrl-V of API-format JSON on the canvas works: the
stock paste handler only takes UI-format workflows, so `web/api_paste.js`
catches API JSON first and routes it through the frontend's own `loadApiJson`
(widgets built from the server schema, never by position). It replaces the
graph, so a non-empty canvas asks first. The deck's "api" links and every
`*_api.json` in `examples/` paste directly now.

## Compare deck (outside ComfyUI)

[`tools/compare_deck/`](tools/compare_deck/) builds the review page used for
the sweeps in this pack: a manifest JSON in, one self-contained HTML file
out, with a card grid, a sortable metric table, a synced A/B (side by side
or wipe) on a waveform timeline, and a frame-exact export of the current
view. `make_manifest.py` drafts the manifest from a folder of clips; you
fill in the groups and descriptions. The clips stay where they are, so
nothing but HTML is produced. A live deck built with it:
<https://matlowai.github.io/flipbook/trueclock.html>. Standalone Python, no
ComfyUI import, see [`tools/compare_deck/README.md`](tools/compare_deck/README.md).

## What these replace

Our graphs used VHS_LoadVideoPath and VHS_SelectEveryNthImage; both are
covered. Create Video + Save Video stay valid; MAI Video Out is those plus the
sidecars. The compare node replaces opening three files and scrubbing them to
roughly the same place.
