# Dial Rack

Stacks **dials** (steering sliders made by Make Dial, Make Dial from Pictures or Combine Dials) on a MiniMax H3,
MOSS-Image or Krea 2 model. Each row is one dial file from `models/loras/dials/`; a dial wired into a `dial_` socket
gets its own row.

## A row
- **checkbox**: on / off. **slider and number**: strength. Negative moves toward the dial's A side, positive toward B.
  +0.5 to +1 is the everyday range; past about 1.5 side effects appear.
- **constant / early / late / bell / manual**: strength over the denoising steps.
- **blocks**: how much of the dial each model block reads (all ones = the plain dial).
- **⚙**: the dial's info (what − and + give, useful and overcook strengths, evidence), saved into the dial file.
- **✎**: the dial editor (below).
- **S** solo, **H** hold (removes this direction from the other rows instead of adding it), **✕** remove.

**Save preset / Load preset** store the rows by file name and hash, never the dial weights. **Map** opens a 2D pad: two
rows on X and Y, the dot is your prompt; switch it to the **wheel** to see every live row on the probe axes. Under it,
the interaction grid shows which rows reinforce (warm) or cancel (blue) each other. This is vector math on the files,
not a render test.

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
