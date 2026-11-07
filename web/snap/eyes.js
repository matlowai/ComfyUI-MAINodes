// Keep eye colour (G3, the operator's decision 5, 2026-11-06): a stage 2 redraw re-makes iris colour from the model's
// own prior (d0.30 greyed Hiyori's brown eyes and Liesl's amber, u102b/IRIS_COLOUR), so a reference redrawn by stage 2
// carries a static line: compare the eyes with the Cast picture. The optional step re-tints the irises of the redrawn
// take toward the Cast front's: SAM 3.1 (the detector the identity notes use) finds the eyes on every frame and on the
// Cast picture with the same words, no hand seeding; MAISnapEyeColour moves Lab a/b inside the iris only, lightness never,
// and passes a frame with no iris (a profile, a back) through untouched. It lands as a new take beside the redraw, made
// only when asked (a GPU step: a proposal unless the person lets agents run).
// SNAP-R134 optional, after stage 2, SAM-located, never the default · SNAP-R203 on any take, saying what it ran on · SNAP-R85 references are redrawn · SNAP-R16 GPU work
// waits for the person · SNAP-R60 the new take keeps the redraw's pins · see docs/snap/SNAP_RULES.md
import * as ED from "./edits.js";
import * as K from "./checks.js";
import * as N from "./nearby.js";
import * as T from "./takes.js";
import * as W from "./world.js";

// what SAM is asked for, on the frames and on the Cast picture alike (measured on Hiyori and Liesl: u102b/IRIS_SAM):
// "eye:2" says where the eyes are (it alone tells eyes from a gold hair bell by score), ANDed with the iris pixels ("pupil"
// hugs one character's iris, "iris of the eye" fills another's)
export const FIND = { eye: { text: "eye:2", threshold: 0.6 }, iris: { text: "pupil:2, iris of the eye:2", threshold: 0.3 }, refine: 0 };

const redrawn = (t) => t?.parent?.method === "upscale/stage2";
// the Casts the take pins that have a picture, each with its front (the picture whose role says front, else its first)
export function castsOf(t) {
  return Object.entries(t?.world ?? {}).filter(([ref]) => ref.startsWith("cast:")).map(([ref, p]) => {
    const got = W.get(W.refOf("cast", W.parse(ref).id, p.n)), refs = got?.version.body.refs ?? [];
    const i = Math.max(0, refs.findIndex((x) => /front/i.test(x.role ?? "")));
    return refs.length ? { ref: W.refOf("cast", W.parse(ref).id, got.version.n), name: got.version.body.name, front: { ...refs[i], index: i } } : null;
  }).filter(Boolean);
}
// the static line on a reference made with stage 2: null on any other take
export function note(t) {
  if (!redrawn(t) || !(ED.purposeOf(t)?.reference || castsOf(t).length)) return null;
  const casts = castsOf(t), who = casts.map((c) => c.name).join(", ");
  return { said: `Eye colour can shift in the redraw: compare the eyes with ${who ? `${who}'s Cast picture` : "the Cast picture"}.${casts.length ? " Keep eye colour (optional) re-tints only the irises toward it." : ""}`, casts: casts.map((c) => ({ cast: c.ref, name: c.name, picture: c.front.file })) };
}

// the new take: the take's frames (or its still), SAM on them and on the Cast front, the re-tint, saved beside it.
// F-Y07 (SNAP-R203): any still or video take, not only a stage 2 redraw: a redraw made another way (a whole-picture P-H3
// redraw, then a region edit) darkened Kuroe's irises and was refused. The Cast is the one the take pins, or the one
// given (a still made from takes pins none); the node itself skips a Cast whose iris is grey
export function need(t) { if (!t.media.some((m) => m.kind === "video" || m.kind === "image")) throw new Error(`Take ${t.number} has no picture or video for keep eye colour to re-tint`); }
// the Cast asked for (cast:<id>[@n], pinned or not), else the one Cast the take pins
export function castFor(t, cast) {
  const casts = castsOf(t);
  if (cast) {
    const pinned = W.parse(cast).n == null && casts.find((c) => W.parse(c.ref).id === W.parse(cast).id); // the version the take pins
    if (pinned) return pinned;
    const got = W.get(cast), refs = got?.version.body.refs ?? [], i = Math.max(0, refs.findIndex((x) => /front/i.test(x.role ?? "")));
    if (!refs.length) throw new Error(`No Cast ${cast} with a picture (list_cast shows them)`);
    return { ref: W.refOf("cast", W.parse(cast).id, got.version.n), name: got.version.body.name, front: { ...refs[i], index: i } };
  }
  if (casts.length !== 1) throw new Error(casts.length ? `Take ${t.number} pins ${casts.length} Casts: name one (cast: ${casts.map((c) => c.ref).join(" or ")})` : `Take ${t.number} pins no Cast with a picture: give cast (cast:<id>)`);
  return casts[0];
}
export async function start(t, { cast, ref, strength = 1, by = "person" } = {}) {
  need(t);
  if (!(strength >= 0 && strength <= 1)) throw new Error(`strength is how far toward the Cast's colour, 0 to 1 (1: all the way); not ${strength}`);
  const pick = castFor(t, cast);
  const refs = W.get(pick.ref).version.body.refs, front = ref != null ? refs[ref] : pick.front;
  if (!front) throw new Error(`${pick.name} has no picture ${ref}; it has ${refs.length} (0 to ${refs.length - 1})`);
  const { detector } = await K.needs();
  if (!detector) throw new Error("Keep eye colour finds the eyes with SAM 3.1 (models/checkpoints/sam3.1_multiplex_fp16.safetensors), which isn't in the model graph here");
  const video = t.media.find((m) => m.kind === "video"), still = !video && t.media.find((m) => m.kind === "image");
  if (!video && !still) throw new Error(`Take ${t.number} has no picture or video`);
  const find = (key, image, { text, threshold }) => ({ [`${key}t`]: { class_type: "CLIPTextEncode", inputs: { clip: ["sam", 1], text } },
    [key]: { class_type: "SAM3_Detect", inputs: { model: ["sam", 0], image, conditioning: [`${key}t`, 0], threshold, refine_iterations: FIND.refine, individual_masks: false } } });
  const sam = (key, image) => ({ ...find(`${key}e`, image, FIND.eye), ...find(`${key}i`, image, FIND.iris),
    [key]: { class_type: "MaskComposite", inputs: { destination: [`${key}e`, 0], source: [`${key}i`, 0], x: 0, y: 0, operation: "and" } } });
  const g = {
    sam: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: detector } },
    cf: { class_type: "LoadImage", inputs: { image: front.file } },
    ...sam("cfm", ["cf", 0]),
    ...(video ? { v: { class_type: "LoadVideo", inputs: { file: K.annotated(video) } }, vc: { class_type: "GetVideoComponents", inputs: { video: ["v", 0] } } } : { v: { class_type: "LoadImage", inputs: { image: K.annotated(still) } } }),
  };
  const frames = video ? ["vc", 0] : ["v", 0];
  Object.assign(g, sam("fm", frames), { e: { class_type: "MAISnapEyeColour", inputs: { images: frames, masks: ["fm", 0], reference: ["cf", 0], reference_mask: ["cfm", 0], strength } } });
  if (video) Object.assign(g, {
    out: { class_type: "CreateVideo", inputs: { images: ["e", 0], audio: ["vc", 1], fps: ["vc", 2], bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none" } },
    save: { class_type: "SaveVideo", inputs: { video: ["out", 0], filename_prefix: `video/snap_eyes/${t.id}`, format: "auto", "format.codec": "auto", codec: "auto" } },
  });
  else g.save = { class_type: "SaveImage", inputs: { images: ["e", 0], filename_prefix: `snap_eyes/${t.id}` } };
  const options = { cast: pick.ref, picture: front.file, strength, find: `${FIND.eye.text} and ${FIND.iris.text}` };
  const job = { kind: "eyes", title: `Keep eye colour on take ${t.number}: its irises toward ${pick.name}'s (${front.role ?? "picture"})${strength < 1 ? `, strength ${strength}` : ""}`, about: { take: t.id, group: t.group }, by, eta_s: null };
  const id = await K.queue(g, { group: t.group, world: t.graph?.extra?.snap?.world, job, extra: { snap_parent: { take: t.id, method: "eyecolour", options: { ...options, label: "eye colour" }, by } } });
  await N.load();
  const on = N.what(t.id).line;
  return { prompt_id: id, take: `take-${id}`, ...options, ran_on: on, said: `Keep eye colour is running on take ${t.number} (${on.replace(/\.$/, "")}): a new take beside it (take ${t.number} stays); look at the eyes at 100 % against ${pick.name}'s picture before keeping it` };
}
