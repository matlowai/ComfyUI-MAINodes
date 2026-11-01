# Dial Rack

Stacks **dials** (steering sliders made by Make Dial, Make Dial from Pictures or Combine Dials) on a MiniMax H3,
MOSS-Image or Krea 2 model. Each row is one dial file from `models/loras/dials/`; a dial wired into a `dial_` socket
gets its own row.

## A row
- **checkbox**: on / off. **slider and number**: strength. Negative moves toward the dial's A side, positive toward B.
  +0.5 to +1 is the everyday range; past about 1.5 side effects appear.
- **constant / early / late / bell / manual**: strength over the denoising steps.
- **blocks**: how much of the dial each model block reads (all ones = the plain dial).
- **time**: the dial's strength over the clip (MiniMax H3; see below).
- **⚙**: the dial's info (what − and + give, useful and overcook strengths, evidence), saved into the dial file.
- **✎**: the dial editor (below).
- **S** solo, **H** hold (removes this direction from the other rows instead of adding it), **✕** remove.

**Save preset / Load preset** store the rows by file name and hash, never the dial weights. **Map** opens a 2D pad: two
rows on X and Y, the dot is your prompt; switch it to the **wheel** to see every live row on the probe axes. Under it,
the interaction grid shows which rows reinforce (warm) or cancel (blue) each other. This is vector math on the files,
not a render test.

## Time curve (time)
Makes a dial come in, go out, swell or reverse during the clip, e.g. dark only after 3 s. Pick **keyframes** and draw
the level over the clip on the canvas: 0 = dial off, 1 = the row's strength, above 1 = stronger, below 0 = the dial
reversed (a motion row at strength 1 with level −2 runs motion at −2). **bottom** and **top** set the level range you
can reach with the mouse; both widen by themselves when a typed or pasted curve goes past them. The solid line is 0.
The amber steps are what the model actually gets: one value per latent frame, about 1/6 s.

- **Strength readout:** level × row strength is the dial strength the model gets. The readout next to the cursor and
  the selected point both show it (`2.40 s · level -2.00 · strength -2.00`), and when the row strength is not 1 a
  second axis on the right is labelled in strength.
- **Click** empty canvas: add a point (hold the button to keep dragging it). **Drag** a point to move it; **Shift**
  moves it slowly and freely, **Alt** turns snapping off. **Double-click** or **right-click** a point: delete it.
- **Click a point** to select it: type its exact **time (s)** and **level**. **Shift+click** adds points to the
  selection (or drops them), **Ctrl+drag** draws a box that selects the points inside (Ctrl+Shift adds to the
  selection). Dragging any selected point moves them all; the **arrow keys** nudge them (Shift: 10x), **Delete** removes
  them (a curve keeps at least two points), **Esc** deselects. **Ctrl+Z / Ctrl+Shift+Z** undo and redo; **Reset** goes
  back to the curve you opened.
- **× level**, **+ level**, **flip** and **stretch time** act on the selected points, or on all of them when none is
  selected: multiply the levels, add to them, negate them, or scale the times from the first selected point to the last
  (points keep 1/6 s apart and stop before the next point).
- **Zoom:** the mouse wheel zooms the time axis around the cursor, **Shift+wheel** or a **middle-drag** pans, **fit**
  shows the whole clip again. Handy for placing a short dip; the zoom is not saved.
- **snap** places points on 0.1 s, 0.5 s or 1 s, on latent frames, or (after a run with music on `curve_audio`) on the
  music's onsets, which are drawn with the waveform behind the curve. Levels snap to 0.05.
- **times**: `0..1 of the clip` stretches with the clip length, `seconds` stays put (use it to match "(1-6 s)" in a
  prompt). Switching converts the points without moving them. **clip s** is the length the editor draws; a run sets it.
- Presets: **off → on**, **on → off**, **ramp up**, **ramp down**, and **dip** (1 with a short dip to −1 in the middle).
- The text box under the canvas holds the points as `[[time, level], ...]`: type there for exact numbers.
- **Copy / Paste** move a curve to another row or another rack (for de-rope, copy it to the stage-2 rack).
- Points stay at least 1/6 s apart. Changes sharper than a latent frame are averaged, and renders ramp over about
  1.5 s, so draw sections and swells rather than single beats.
- **audio-driven** curves follow a feature of the music; **→ keyframes** turns one into points you can edit.

## Dial editor (✎)
Opens a dial to see it in the vector space and nudge it into a new dial. It works on post-refiner dials of a model that
has a probe bank (MiniMax H3 so far); otherwise it says why not.

- **probe bars**: how much of each probe direction (still↔moving, warm↔cold, calm↔intense, …) the dial contains. The
  dashed outline is the original, the filled bar the edited dial. **fit** is the same switch as the wheel: `direct`
  is easy to read, `joint` shares credit between overlapping probes.
- **Drag a bar** to add or take away that probe direction. Drag it to 0 (or double-click it) to remove that flavour,
  e.g. take "cold" out of a villain dial whose prompt pairs happened to say "icy". Under `joint` the re-measured bar
  lands near 0 rather than exactly on it.
- Probes overlap: light, expression and mood are largely one "intensity" direction, so moving one bar moves the
  others (marked ∿). "Unexplained" is the part of the dial the probes don't describe; about half is normal.
- **library map**: every saved dial of the same model as a dot, with the nearest ones labelled. Axes are two probes
  of your choice or the library's two main directions (PC1 / PC2). Dragging your dial moves it along those two
  directions only.
- **Readouts**: the dial's size, its cosine with the original (1 = unchanged direction), the nearest saved dials and
  how each probe changed. **Undo** and **Reset** work inside the editor.
- **Export new dial**: pick a name (`folder/name` saves into a sub-folder; folders starting with `_` stay out of the
  rack's list). An existing file is never replaced. The new file keeps the original's labels, records its parent and
  every edit, and starts with useful/overcook strengths and evidence **unknown**: an edited dial hasn't been rendered
  yet, so try it before trusting it. **add as row** puts it in the rack; nothing else in the rack changes.

The editor does exact math on the vectors. Whether an edit shows up in a video is only known once you render it.
