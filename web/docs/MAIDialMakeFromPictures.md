# Make Dial from Pictures

Turns the difference between two groups of pictures into a **dial**: a slider you can add to any MiniMax H3 prompt.
Show it lizards in group A and squirrels in group B, and the dial pushes a video toward lizards at negative strength
and toward squirrels at positive strength. No training, about a minute to build.

## Quick start
1. Put the "before" pictures in **group A** and the "after" pictures in **group B**: a Load Image node into the `a0`
   socket and another into `b0`. Each time you connect one, the next socket (`a1`, `b1`, ...) appears.
2. Leave **framing** on `content` and give the dial a **name**.
3. Run. The dial is saved to `models/loras/dials/<name>` and also flows straight out of the `dial` output, so you can
   wire it into a **Dial Rack** row and render in the same run.
4. In the rack, start at **−4 or +4**: picture dials are weaker than dials made from text.

Example workflows: `dials_two_pictures_pika_derope` (one pair) and `dials_picture_groups_pika_derope` (three pairs).

## Picking pictures (the part that matters most)
- **Change one thing only.** Same framing, camera angle, light and background on both sides; only the quality you want
  to steer differs. If the background also changes, the dial learns the background too.
- **Pair them up.** Picture 1 in A should match picture 1 in B, and so on. With equal counts the node pairs them by
  position and reports a **pair agreement** score: above about 0.85 is good; under 0.4 it warns you that the pairs
  differ in more than one way.
- **More pairs = cleaner dial.** One pair works but carries that photo's quirks; 3 to 12 matched pairs average them out.
  Unequal counts are allowed (it then compares the two group averages, with no agreement score).
- **Any size is fine** on the `a` / `b` sockets: each picture keeps its own shape. The `pictures_a` / `pictures_b`
  sockets take a ready-made image batch (all one size); both kinds add up.
- Generated pictures work well: render the same prompt and seed twice, changing only one word.

## Which framing?
Each picture is read through a short sentence; the framing picks the sentence, and that decides what the dial learns.

| framing | reads | use it for |
|---|---|---|
| `content` (default) | what is in the picture | swapping or changing a subject: animal, object, character, outfit |
| `look` | colours, light and look | colour grade, lighting, time of day, film look |
| `bare` | the picture with no hint | trying what the model picks up on its own |
| `all averaged` | all of the above, averaged | when you're not sure; a solid all-rounder |
| `picture prompt` | your own sentence (advanced) | full control, and the original wording |

Tested on lizard vs squirrel pairs: `content` and `all averaged` reached a lizard at −4; the old wording gave a
lizard-squirrel hybrid. Naming the kind of subject in your own picture prompt ("A video of the animal in
<Picture 1>.") was the strongest. `<Picture 1>` stands for the picture; keep it in your sentence.

## If it doesn't do what you want
- **Half-way hybrid** (a squirrel with lizard feet): use `content`, add more pairs, or push to −6 / +6.
- **The whole scene changes**, not just the subject: the pictures differ in more than one way; match them more closely.
- **Nothing happens:** picture dials need about twice a text dial's strength; check the row is on and the strength is
  not 0.
- **Only one side works:** common (the lizard side worked, the squirrel side didn't). Note it in the info fields so the
  rack's map draws that side as unknown.

## The other fields
- **name:** the file name. Empty = don't save, just pass the dial on.
- **description, labels, useful / overcook, evidence, pipeline:** notes saved into the dial file. The rack shows them
  as the tooltip, the map's axis labels and its rings. Set useful / overcook once you've tried the dial (0 = unknown,
  drawn as "uncalibrated"); the negative ones at 0 mean "same as positive".
- **debias** (advanced): removes generic wording effects. Leave it on.

Works with MiniMax H3 (including Pika H3 Flex). Picture dials are alpha.
