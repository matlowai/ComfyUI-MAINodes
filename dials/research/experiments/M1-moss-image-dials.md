# M1: a first batch of MOSS-Image dials, across three MOSS models (2026-11-06)

**Question** (Dylan: "make more moss dials, try some image contrast dials, do some weird stuff and some normal stuff and
play around with moss dials on moss base and moss sft deband and kromoss"). Which kinds of prompt-pair dials work on
MOSS-Image, and does a dial made on one MOSS model steer the others?

**Setup.** 11 new dials made with Make Dial (post-refiner hook on MOSS's `text_embedder`, debias on) on **MOSS SFT
DeBand**: 3 parallel templates × 6 varied scenes per dial (18 pairs). Rendered on a held-out prompt (a lighthouse keeper on
a rocky coast; no pair mentions it), **one seed (7)**, 1024×1024, ER-SDE 25 steps, simple scheduler, cfg 3, at −4 / control
/ +4. Then the six best on **MOSS Base** and **KroMoss** with the same settings (each model its own control). Clips are on
the [MOSS-Image Dials page](https://matlowai.github.io/ComfyUI-Dials/moss.html).

## Results (seed 7; by eye)

| dial | DeBand −4 / +4 | Base and KroMoss |
|---|---|---|
| ukiyo-e ↔ cyberpunk | an aged woodblock print on torn paper / a neon lighthouse with light-trail paths | both sides on both; −4 becomes a proper figure drawing |
| contrast: flat ↔ punchy | hazy, pale / deep blacks, fiery sky | −4 goes to a near-white fog: about twice the effect |
| detail: minimal ↔ ornate | a bare headland / gear, a satchel, flowers, perched gulls | KroMoss +4: a filigreed, flower-covered lighthouse |
| calm ↔ chaos | a quiet path / the keeper scrambling over the rail | +4 piles clutter on the cliff |
| film: digital ↔ 70s | crisp / warm, faded | +4 warm and faded on all; KroMoss adds a print border |
| tiny ↔ colossal | (no tiny) / monumental waves | the tiny side appears on Base and KroMoss: a toy-like lighthouse |
| solid ↔ melting, glass ↔ fur | partial and odd (mist, wet stone, a shaggy coat) | not tried |
| deep ↔ shallow focus, wide ↔ tele | mostly reframing | not tried |
| cat ↔ owl | nothing: no animal in the scene | not tried |

- **A dial made on DeBand steers Base and KroMoss**, at roughly **twice the effect** at the same strength: start near ±2
  there, ±4 on DeBand (cfg 3 also halves a hook dial, see LESSONS).
- Words for a medium or era arrive as such on MOSS (woodblock print, 70s film), unlike on H3 where style words often
  arrive as an era or a place first.

## Disney ↔ anime: a big style change to the extremes

A 12th dial (classic Disney-style animated film ↔ Japanese anime), swept on DeBand (−12…+12) and KroMoss (−8…+8), on the
lighthouse prompt and on an already-animated prompt (a young woman walking on a beach). One seed.

| | from a photo (lighthouse) | from an animated prompt (beach) |
|---|---|---|
| Disney side, DeBand | painterly from −4; storybook (the keeper becomes a child in a bonnet) at −6; fairy tale at −8; **breaks at −12** into a framed storybook card of cartoon animals | princess-style at −2/−4; sidekick animals at −6/−8; the framed card at −12 |
| Disney side, KroMoss | already a luminous storybook painting at **−1**, coherent to −8 | a framed storybook illustration by −6 |
| anime side, DeBand | photo to +4; a Japanese setting at +6 (still photoreal); **anime at +8**; **breaks at +12** into shattered-glass shards | anime already at **+1/+2**; shattered glass at +8; abstract shards at +12 |
| anime side, KroMoss | anime at +6; a loose sketch at +8 | anime from +1; shards at +8 |

- **Where a style arrives depends on the starting point; where it breaks depends on the strength.** From a photo the
  anime look needs +6 to +8; from an animated prompt it is there at +1 to +2; both break near +8 (KroMoss) or +12 (DeBand).
- KroMoss leans painterly/Disney very easily (−1) but not anime (+6).
- **Watch:** past about +4 on the anime side the outfit gets shorter and darker. Screen for drift before sharing such a dial.
- At **4096×4096** (with a high-resolution LoRA) the same dial breaks at the same strengths: −4 gives a pastel storybook
  look with a castle on the far headland, ±8 breaks down.

**What it changes.** MOSS is a good dial host: one dial file works across the MOSS family, medium and era words come
through as such, and the breakdown point is a property of strength, not of resolution or prompt. Next: a second seed and
a held-out scene for the six best; MOSS word dials from the encoder's own output head (the exact lens on MOSS, which reads
its last layer); picture-pair dials for MOSS (being built for the high-resolution LoRA work).

## Replication: a second seed and a held-out scene (2026-11-07)

The six best dials on MOSS SFT DeBand (same settings: ER-SDE 25 steps, cfg 3, the default negative), at −4 / control / +4,
on the **lighthouse at seed 8** and a **held-out scene at seed 7** (an old man reading a newspaper on a park bench in autumn;
no pair mentions it). One render per arm.

| dial | lighthouse, seed 8 (−4 / +4) | park bench, held out (−4 / +4) |
|---|---|---|
| ukiyo-e ↔ cyberpunk | a woodblock painting with calligraphy and a seal / a neon lighthouse, glowing light-trail path | an ink painting of the man reading on a mat / a neon city at night, leather jacket |
| contrast: flat ↔ punchy | pale and hazy / dark, dramatic, a wave crashing | softer and flatter / darker, a wilder beard (mild) |
| detail: minimal ↔ ornate | a bare headland / gear on the keeper, crowds, many gulls | a plain sweater / an ornate scarf, an iron bench, a busier park |
| calm ↔ chaos | a quiet path / the keeper scrambling, other people, gulls | calm / newspapers scattered, a slouched, windblown reader (mild) |
| film: digital ↔ 70s | crisp / faded, muted, grainy dusk | crisp / warmer, muted (mild) |
| tiny ↔ colossal | a smaller, nearer lighthouse / a monumental rock, huge waves | no visible scale change either way |

- **Five of six replicate on the second seed, and the same five carry to the held-out scene** (contrast, calm/chaos and film
  more mildly there). Tiny ↔ colossal needs something with a scale to change; a man on a bench has none.
- Ukiyo-e ↔ cyberpunk is the strongest dial: a full change of medium on both scenes, both sides.
- **Identity drift:** on the park bench the control draws an East Asian man; most ±4 arms draw a different, European-looking
  man (the ukiyo-e side keeps an East Asian man). At ±4 these dials restage the person, so they are not identity-safe.

## KroMoss at its designed settings (2026-11-08)

The KroMoss rows above used 25 steps at cfg 3, which turned out to be the wrong setup for KroMoss (it ships with an 8-step
DMD2 LoRA and is meant for CFG 1; at 25 steps / cfg 3 renders look burnt). Re-run: the same six DeBand-made dials on
**KroMoss + DMD2 LoRA, 8 steps, CFG 1, euler / simple**, lighthouse prompt, seed 7, at −4 / −2 / control / +2 / +4.

| dial | −4 | −2 | +2 | +4 |
|---|---|---|---|---|
| ukiyo-e ↔ cyberpunk | a woodblock print on paper, calligraphy, a seal | a painted illustration | blue light, red rails | full neon: red and blue light trails |
| contrast | pale, hazy | softer | punchier | night, dramatic, glowing lights |
| detail | a bare headland, a lone lighthouse | plainer | more buildings, greenery | a castle-like mansion on the rock |
| calm ↔ chaos | a flat, quiet headland | calm | waves breaking | the keeper scrambling over rocks |
| film | crisp, cool | crisp | warm, golden | a red-magenta faded print (close to overcooked) |
| tiny ↔ colossal | **a toy-like cottage lighthouse, shallow focus** | smaller | a taller rock | a monumental rock spire |

- **All six work on KroMoss at its designed settings, on both sides**, with a visible effect already at ±2 and a strong one
  at ±4 (film +4 is at the edge). The tiny side, absent on DeBand, is clear here.
- So for these **pair dials** the CFG 1 rule of thumb holds: about twice DeBand's effect, start near ±2. For the M2 **word
  dials** it did not (they needed +8 on both). One seed.
