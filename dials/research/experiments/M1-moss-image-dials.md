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
