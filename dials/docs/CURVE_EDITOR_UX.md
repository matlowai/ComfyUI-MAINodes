# Time curve editor: editing with the mouse

The rack row's **time** editor (`timeEditor` in `web/dial_rack.js`) used to only draw the curve; points came from presets
and a JSON box. This note is the plan for editing keyframe curves on the canvas. The saved row is unchanged
(`time: {type: "keys", points, unit, interp, smooth, steps, audio}`, checked by `dials/timecurve.py` `check_spec`): the editor
writes the same fields through the same widget, so old workflows load as they were and the backend is not touched.

## How people will use it
- **Match the prompt's seconds.** "(1-6 s) she charges, (6-8 s) peak": points at exactly 1.0 s and 6.0 s. The canvas has
  a seconds axis (a labelled line every 1 s, or 2 / 5 s on long clips), a readout of `time s · level` next to the cursor
  while hovering or dragging, snapping (0.1 s by default) and a selected point's time (always in seconds) and level as
  number fields. A **clip** field sets the clip length the editor draws, so an 8 s clip can be edited before its first
  run (a run's report still overwrites it, as before).
- **Quick shape, then tweak.** A preset or a few clicks, then fine-tune: drag, the number fields, arrow keys (time ±0.1 s,
  level ±0.05; Shift ×10) and Delete.
- **Beats and sections.** After a run with `curve_audio`, the waveform is drawn behind the curve in keyframe mode too, with
  detected onsets as ticks; snap can be set to onsets. Audio-driven curves can be turned into keyframes (one step per
  latent frame) to hand-edit.
- **Clip length changes.** Curves in clip fractions stretch with the clip, seconds stay put. Switching the unit converts
  the points, so nothing moves on the canvas; the JSON shows the converted numbers.
- **Resolution honesty.** The model sees one value per latent frame (1, 4, 4, 4, 4 pixel frames, about 1/6 s); the
  frame edges are ticks under the axis, snap can use them, and the help says sharper changes are averaged per frame
  and renders ramp over about 1.5 s (TIMECURVE.md). The amber line (M per latent frame) stays.
- **Mistakes.** Undo / redo (buttons, and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on the focused canvas), and **Reset** to the
  curve the editor opened with.
- **Reuse.** **Copy** / **Paste** the row's whole time spec (curve, steps, audio) as JSON through the clipboard, with an
  in-page copy as the fallback when the clipboard is blocked; Paste also works on a row without a curve and accepts a
  bare `[[t, M], ...]` list. This is how a curve gets to another row or to the stage-2 rack of a de-rope workflow.
- **Fine control.** The JSON box stays and syncs both ways. **Taller** doubles the canvas.
- **Envelopes that reverse the dial.** Dylan's punch freeze (a motion row at strength 1: 0.5, 1 into the punch, −2 for
  0.7 s at the impact, back to 0.5) needs negative levels by mouse, a zoom to place the 0.7 s dip, and the strength the
  model gets (level × row strength) without arithmetic. **bottom** / **top** set the mouse range (both widen to fit typed
  or pasted points and stay widened while the editor is open, so the canvas does not rescale after a drag); 0 is a solid
  line; the readout says `2.40 s · level -2.00 · strength -2.00`; a row strength other than 1 adds a right-hand axis in
  strength. Presets gain **dip** (1 with a short dip to −1).
- **Bulk edits.** Shift+click and Ctrl+drag (box) select several points; a drag, the arrows and Delete act on all of them.
  **× level**, **+ level**, **flip** and **stretch time** act on the selection, or on every point when nothing is
  selected. Each is one undo step.

## Mouse and keys (keyframe mode)
| action | result |
|---|---|
| click empty canvas | add a point there (snapped) and keep dragging it until release |
| drag a point | move it; Shift: fine (5x slower, no snap); Alt: no snap |
| click a point | select only it: time / level fields, keys act on it |
| Shift+click a point | add it to the selection, or drop it |
| Ctrl+drag (Ctrl+Shift+drag) | box select (add to the selection); a plain drag on empty canvas still adds a point |
| drag a selected point | move the whole selection, clamped so the order and the 1/6 s gaps stay valid |
| click a selected point without moving | select only it |
| double-click or right-click a point | delete it |
| hover | the point under the cursor grows; readout of time, level and strength (or where a click would add) |
| arrows · Delete · Esc | nudge · delete · deselect the selection |
| wheel · Shift+wheel or middle-drag · **fit** | zoom the time axis around the cursor · pan · whole clip |

Points are drawn 11-14 px wide and grabbed within 10 px of their centre. Pointer capture keeps a drag when the cursor
leaves the canvas. Box select is on Ctrl so that click-and-drag keeps adding a point and dragging it, as before.
Zoom is view state on the open editor (at least 0.5 s shown; Done or another row resets it); the seconds grid goes down
to 0.1 s labels and the latent-frame ticks, hit tests, snapping and the box all use the zoomed axis.

## Rules (what the backend accepts, and what keeps editing predictable)
- `check_spec` needs at least one finite point with strictly increasing times; it does not pin the first time to 0 or
  limit levels, and the curve holds its first and last levels out to the clip edges. So: every point can move in time
  and level; a drag stops 1/6 s (one latent frame) before a neighbour; a click within 1/6 s of a point selects it
  instead of adding. A curve keeps at least two points; any other point can be deleted (the end points too: the curve
  then holds the new end's level, which is what the canvas shows).
- Mouse levels run from **bottom** (0 by default; lower it for reversed sections) to **top** (1 by default; raise it
  for overshoot kicks, like the block strip). Whole and half levels pull the cursor from 3 px so 0, ±0.5 and ±1 stay
  easy to hit on a tall range. Times outside the clip can still be typed in the JSON; the canvas widens to show points
  past the clip end and shades that part.
- Group moves: the selection moves rigidly; time stops at the first unselected neighbour (1/6 s) or the clip edges,
  level at bottom / top. **stretch time** scales the times from the first to the last selected point (unselected points
  between them included, so the order holds) about the first, with the factor held so neighbours keep 1/6 s; the
  message says when it was held. Delete refuses a selection that would leave fewer than two points.
- The axes stay fixed during a drag, so the curve does not rescale under the cursor.
- Keys go through a hidden read-only input that the canvas focuses: ComfyUI's workflow undo listens for Ctrl+Z on
  `window` in the capture phase and only leaves inputs alone, so a focused canvas would undo the whole workflow
  (and reload the node) along with the curve.

## Not built, and why
- **Bezier / smooth handles:** per-point handles are not built; one **rate smoothing** slider (`smooth` 0..1, linear
  only) rounds every corner instead: the slope ramps across each key, still through the key and never past it
  (`dials/envelopes.py` `keyframes`; the editor's `keyframes` in `web/dial_rack.js` mirrors it, checked by
  `tests/test_dial_timecurve.py`). The blue curve and the amber per-frame bars both show the smoothed curve.
- **Live scale fields:** the scale tools apply on a button press with the number beside it, so a half-typed number
  never rewrites the curve; undo covers each press.
- **Invert of the whole curve (1 − M):** flip (−M) covers the reversal Dylan needed.
- **Zoom of the level axis:** bottom / top and Taller cover it.
- **Per-modality curves (video vs audio):** the schema has one curve plus follow / protect.
- **Undo across editor sessions:** the history lives while the editor is open on that row; Reset covers the rest.
- **Mouse editing of audio-driven curves:** they are numbers (gain, threshold, ...); convert to keyframes to draw.
