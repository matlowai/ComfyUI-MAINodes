---
name: snap-set-design
description: Review a Snap location across its existing views before planning shots, assessing staging, visual design and camera coverage while distinguishing design advice from evidenced geometry or continuity flaws. Use for a set-design review or when a location needs a whole-place assessment; use snap-critic for landed-picture docket verdicts.
---

SNAP-R269 whole-location design review · SNAP-R268 fixed landmarks and accepted state · SNAP-R271 scene reference minimum · see docs/snap/SNAP_RULES.md.

Read `snap-core` first. If reachable, `read_skill {"name": "snap-set-design"}` returns the person's version.
Use `snap-location` for location construction and `snap-critic` for due critiques. This is a design review workflow;
it does not replace or modify the measured critic prompt or establish its fixture floor.

# Look around the set before choosing the shots

Read the location's exact version, notes, plan, scale anchors, camera map and provenance (`nearby` for unfamiliar
pictures), plus the relevant beats and accepted state. Inspect every available distinct view WHOLE at native size
before details. A master and three crops of it do not show four sides. Name unseen areas and contradictory sources;
do not claim a complete survey when the pictures cannot establish it. The scene packet must include at least one
textured top/bird's-eye and one genuine side/elevation; prefer two distinct informative sides (SNAP-R271). The top
shows layout; sides show height, proportions, architecture and occlusion. Label camera, role and source version;
resolve conflicting geometry against authoritative originals rather than merging it. Obtain missing views within
existing authorized scene work, otherwise report the coverage gap without calling the packet complete. This adds
no approval gate. A side geometry reference need not be the intended output camera or a composition to copy.

Describe the place in one shared coordinate frame: entrances and paths, central and edge staging zones, level changes,
fixed floor marks, terrain and landmarks. Separate what the record intends, what each picture shows, and changes the
production has accepted. For a patterned floor, place actors and cameras relative to its centre and bands; do not
let a new shot redefine the floor around its actors. Unaccepted generated damage or drift stays an observation.

Review what matters for this story:

- **Use of the space:** can entrances, movement and action connect through visible usable ground? Which zones support
  confrontation, retreat, rest or a reveal? Name actual obstructions and level changes; an unseen route is unknown.
- **Design:** do architecture, materials and props form a coherent place and support the story? Identify useful
  silhouettes, focal landmarks and competing detail. A preferred palette, emptier stage or more distinctive prop is
  advice, unless it contradicts an established design requirement.
- **Scale and light:** compare anchors across views using the critic's scale/horizon guidance; distinguish typed
  camera height from measured image evidence. Do not derive exact dimensions from a perspective impression. Track
  the intended time and world-side light; reverse cameras change screen-side light, exposure and visible sky.
- **Coverage:** test likely wides, singles and reverses against landmarks, foreground obstructions, eyelines and the
  action's 180-degree line. A changed camera can swap screen sides and hide an end landmark. Locate camera and actor
  marks before calling a relocation or reversal wrong; do not invent geometry behind an occlusion.

Compare features across views only where visible. Describe the evidence that rules out camera angle, crop, depth,
lighting or an accepted state change before asserting a factual inconsistency. When no explanation is ruled out,
record the uncertainty and the smallest missing observation that would resolve it.

# Return a useful review

Give a brief account of the set's strengths and usable staging, then the few findings that affect planned shots.
For each, name **fact / advisory / unresolved**, the exact source version and view or frame, observation, story or
coverage consequence, confidence, source owner and smallest useful response. Own a flaw to the earliest evidenced
source (notes/plan, master, named plate, board, take or export); do not blame the whole location for a take-only error.
Keep taste suggestions separate from critic severity. Report no factual flaws when none are established.

End with the coverage limits and any decision the person actually needs to make. A review does not accept damage,
rewrite canon, pick candidates or regenerate. Follow the existing production's authorization and proposal policy
for those actions; do not introduce a separate set-review approval gate. Write actual docket flaws through
`snap-critic` when that work is in scope, preserving its measured prompt and source ownership.
