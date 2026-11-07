# T5: do dials get weaker in image-to-video, and does leaving the picture rows alone help? (2026-11-06)

**Question.** People report dials feel stronger in text-to-video than in image-to-video. Today's hook adds the dial to
every row of the prompt, including the vision rows of a first-frame or reference picture. If shifting those rows is what
weakens the dial, applying it to text rows only should restore its strength.

**Setup.** A private test node applies one dial with a row mask: *all* (every row, as the Dial Rack does) or *text only*
(vision rows, tag 0, unshifted). Its *all* mode renders **bit-identical** to the Dial Rack (sinister +1, text-to-video,
seed 42: 0/141 frames and 0 audio samples differ), so any difference comes from the mask. Image-to-video: Pika H3 Flex
6-step with the first frame of the text-to-video control as the first frame; sinister +1 and datamosh +2.25; seeds 42 and
43; each against its own image-to-video control. 11 renders.

**Results** (mean pixel distance from the image-to-video control, 0-255; Δdark = −luma change):

| seed | dial | all rows | text only |
|---|---|---|---|
| 42 | sinister +1 | 8.8 (Δdark −0.4) | 8.3 (−0.6) |
| 43 | sinister +1 | 8.8 (+0.1) | 9.3 (+0.1) |
| 42 | datamosh +2.25 | 26.7 | 29.9 |
| 43 | datamosh +2.25 | 33.2 | 32.7 |

For comparison, sinister +1 in **text-to-video** (seed 42): distance **32.7**, Δdark **+18.0**.

The mask does act (all vs text-only differ by a mean 6.6-18 per frame), but it doesn't change how strong the dial is.
Contact sheets: in image-to-video, sinister +1 leaves the dusk platform almost untouched (in text-to-video it went cold
blue); datamosh still glitches (on seed 42 the woman herself turns into a glitched red figure) with either mask.

**What it shows.**
- The report is right, and the gap is large: a lighting/mood dial like sinister is about **4× weaker** in image-to-video,
  and its darkening disappears entirely. The first frame fixes the lighting.
- It is **not** the vision rows (this test) and **not** the model family (T6). It is the first-frame anchor itself.
- Content dials still act in image-to-video (datamosh moshes the subject); look dials are the ones a first frame pins.

**What it changes.** Vision-row masking is not adopted for strength (it may still matter for keeping a reference's
identity; untested). New node **T5b**: how much strength does a look dial need in image-to-video? The dialogue-row half of
T5 is deprioritized: on Pika every evil dial already kept the dialogue intact.
