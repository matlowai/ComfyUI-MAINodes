// Snap bricks for the Dials + Pika Simple recipe (phase 1: our own bricks, pack-shipped rules).
// A brick is one or more graph nodes with a clean face. `provides` maps port roles to output slot names, `needs` maps
// port roles to input names; rules say which role feeds which, so binding never guesses for our own bricks.
// SNAP-R1 pack bricks only choose which values show · SNAP-R4 outcome faces · SNAP-R12 LoRA roles · SNAP-R14 method
// slots · see docs/SNAP_RULES.md

export const RENDER_BLUEPRINT = "Dials - H3 + De-rope";
export const IMAGE_BLUEPRINT = "Dials - Image";
// a LoRA stack brick: core LoadLoraModel rows (file, strength, on); it starts with its one row off at 0 (the node keeps
// at least one row). The role says which LoRAs belong in it (SNAP-R12): core rows travel with the setup, style rows with
// the shot or recipe, identity rows with the cast
const stack = (role, title, hue, blurb) => ({
  title, icon: "≡", hue, blurb, optional: role !== "core",
  nodes: [{ key: "loras", type: "LoadLoraModel", title, values: { "loras.0.enabled": false, "loras.0.strength": 0 } }],
  needs: { base_model: ["loras", "model"] }, provides: { base_model: ["loras", "MODEL"] },
  stack: { node: "loras", group: "loras", role }, face: [],
});

const PACK = {
  models: {
    kit: "video", title: "Models", icon: "◇", hue: 210,
    blurb: "text encoder and the two H3 VAEs",
    nodes: [
      { key: "clip", type: "CLIPLoader", title: "Text encoder", values: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax" } },
      { key: "video_vae", type: "VAELoader", title: "Video VAE", values: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
      { key: "audio_vae", type: "VAELoader", title: "Audio VAE", values: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    ],
    provides: { clip: ["clip", "CLIP"], video_vae: ["video_vae", "VAE"], audio_vae: ["audio_vae", "VAE"] },
    face: [["clip", "clip_name", "encoder"], ["video_vae", "vae_name", "video VAE"], ["audio_vae", "vae_name", "audio VAE"]],
  },
  preset: {
    kit: "video", title: "Render Preset", icon: "◎", hue: 265,
    blurb: "model, LoRA, sampler and de-rope schedule",
    nodes: [{ key: "preset", type: "MAIRenderPreset", title: "Render Preset" }],
    provides: {
      base_model: ["preset", "MODEL"], sampler: ["preset", "SAMPLER"], sigmas: ["preset", "sigmas"],
      derope_steps: ["preset", "derope_steps"], conditioning: ["preset", "conditioning"], cfg: ["preset", "cfg"],
    },
    face: [["preset", "model", "model"], ["preset", "lora", "LoRA"], ["preset", "lora_strength", "LoRA strength"], ["preset", "steps", "steps"]],
  },
  rack: {
    title: "Dial Rack", icon: "◐", hue: 35,
    blurb: "dials on both passes",
    nodes: [{ key: "rack", type: "MAIDialRack", title: "Dial Rack (both passes)" }],
    needs: { base_model: ["rack", "model"] },
    provides: { model: ["rack", "MODEL"] },
    face: [],
  },
  first_frame: {
    kit: "video", title: "First frame", icon: "▣", hue: 150, optional: true,
    blurb: "FL2V start picture",
    // off (bypassed) until it is given a picture: a fresh recipe renders from the prompt alone, as the H3 Render's
    // first_frame is optional (text to video), and an empty input folder no longer fails LoadImage's validation
    off: "the Render starts from the prompt alone (text to video)",
    nodes: [{ key: "image", type: "LoadImage", title: "first frame (FL2V)" }],
    provides: { first_frame: ["image", "IMAGE"] },
    face: [["image", "image", "picture"]],
  },
  refs: {
    kit: "video", title: "References", icon: "❖", hue: 185, optional: true,
    blurb: "pictures, clips and sound for Ref2V",
    nodes: [{ key: "refs", type: "H3References", title: "H3 References" }],
    provides: { refs: ["refs", "refs"] },
    face: [],
  },
  render: {
    kit: "video", title: "Render", icon: "▶", hue: 330,
    blurb: "H3 + Pika + de-rope, gives the video with its sound",
    blueprint: RENDER_BLUEPRINT,
    needs: {
      clip: ["render", "clip"], video_vae: ["render", "vae"], audio_vae: ["render", "vae_1"], model: ["render", "model"],
      sampler: ["render", "sampler"], sigmas: ["render", "sigmas"], derope_steps: ["render", "steps"],
      conditioning: ["render", "branch"], cfg: ["render", "cfg"], first_frame: ["render", "first_frame"], refs: ["render", "refs"],
    },
    provides: { video: ["render", "VIDEO"] },
    face: [["render", "prompt", "prompt"], ["render", "length", "frames"], ["render", "noise_seed", "seed"], ["render", "choice", "de-rope"]],
  },
  // image families (MOSS-Image, Krea 2): loaders, the LoRA stacks, then the Dial Rack and any model patches, into the image
  // Render blueprint (prompt expander, sampler; it gives IMAGE), then the upscale slot and Save
  image_models: {
    kit: "image", title: "Models", icon: "◇", hue: 210,
    blurb: "diffusion model, text encoder and VAE",
    nodes: [
      { key: "unet", type: "UNETLoader", title: "Diffusion model" },
      { key: "clip", type: "CLIPLoader", title: "Text encoder" },
      { key: "vae", type: "VAELoader", title: "VAE" },
    ],
    provides: { base_model: ["unet", "MODEL"], clip: ["clip", "CLIP"], vae: ["vae", "VAE"] },
    face: [["unet", "unet_name", "model"], ["clip", "clip_name", "encoder"], ["vae", "vae_name", "VAE"]],
  },
  loras: stack("core", "Core LoRAs", 290, "turbo, fix and task LoRAs that belong to the setup"),
  style: stack("style", "Style LoRAs", 50, "looks, grades and media for this shot or recipe"),
  cast: stack("identity", "Cast LoRAs", 15, "character and person LoRAs (private: never in saved or shared cards)"),
  image: {
    kit: "image", title: "Render", icon: "▶", hue: 330,
    blurb: "text to image, saves the picture",
    blueprint: IMAGE_BLUEPRINT,
    turbo: true,
    needs: { model: ["image", "model"], clip: ["image", "clip"], vae: ["image", "vae"] },
    provides: { image: ["image", "IMAGE"] },
    face: [["image", "prompt", "prompt"], ["image", "switch", "✨ Enhance prompt (LLM)", { inline: [{ label: "off", value: false }, { label: "on", value: true }],
        line: "the text encoder rewrites your prompt into a long caption first: richer from a short idea, but it can drop details" }],
      ["image", "steps", "steps"], ["image", "cfg", "cfg"], ["image", "noise_seed", "seed"]],
  },
  // the upscale slot between the image Render and Save (SNAP-R14): one brick per wired method, all IMAGE in and IMAGE out;
  // the method chip swaps them in place, Off bypasses the brick and keeps its settings. Which method each brick runs and
  // how it reaches the asked factor is in the method registry (snap_cards/methods.json)
  image_upscale: {
    kit: "image", slot: "upscale", title: "Upscale", icon: "⤢", hue: 95,
    blurb: "an ESRGAN-family model, resized to the asked factor",
    nodes: [{ key: "loader", type: "UpscaleModelLoader", title: "Upscale model" }, { key: "model", type: "ImageUpscaleWithModel", title: "Upscale with model" },
      { key: "resize", type: "ImageScaleBy", title: "Resize to the asked factor", values: { upscale_method: "lanczos" } }],
    links: [["loader", "UPSCALE_MODEL", "model", "upscale_model"], ["model", "IMAGE", "resize", "image"]],
    needs: { image: ["model", "image"] }, provides: { image: ["resize", "IMAGE"] },
    face: [["loader", "model_name", "model"]],
  },
  image_resize: {
    kit: "image", slot: "upscale", title: "Upscale", icon: "⤢", hue: 95,
    blurb: "a plain resize (lanczos)",
    nodes: [{ key: "resize", type: "ImageScaleBy", title: "Resize", values: { upscale_method: "lanczos", scale_by: 2 } }],
    needs: { image: ["resize", "image"] }, provides: { image: ["resize", "IMAGE"] },
    face: [["resize", "upscale_method", "filter"]],
  },
  save_image: {
    kit: "image", title: "Save", icon: "⬇", hue: 170,
    blurb: "saves the picture to output/",
    nodes: [{ key: "save", type: "SaveImage", title: "Save image", values: { filename_prefix: "image/dials_image" } }],
    needs: { image: ["save", "images"] },
    face: [["save", "filename_prefix", "saves as"]],
  },
  // the upscale slot between the H3 Render and Save (SNAP-R14): RelayVSR takes the clip and gives it back larger, sound
  // included. As a slot brick its face is the outcome (slots.js): the size the clip ends up, one Off / 2× / 4× control
  // (Off bypasses both nodes and keeps their settings), and the quality preset's short name; `check` asks the server
  // whether a run would find LightX2V and the weights for these settings
  upscale: {
    kit: "video", slot: "upscale", title: "Upscale", icon: "⤢", hue: 95, optional: true,
    blurb: "RelayVSR after the render",
    nodes: [{ key: "settings", type: "RelayVSRModelSettings", title: "RelayVSR Settings" }, { key: "upscale", type: "RelayVSRUpscaleVideo", title: "RelayVSR", values: { seed: 42, control_after_generate: "fixed" } }],
    links: [["settings", "settings", "upscale", "settings"]],
    needs: { video: ["upscale", "video"] }, provides: { video: ["upscale", "video"] },
    check: ["settings", "/mainodes/relayvsr/check"],
    face: [["settings", "quality", "quality", { short: true }]],
    explain: { variant: ["Model", "The X4 model is used for 2× too; it looked best in our tests."] },
  },
  save_video: {
    kit: "video", title: "Save", icon: "⬇", hue: 170,
    blurb: "saves the video to output/",
    nodes: [{ key: "save", type: "SaveVideo", title: "Save video", values: { filename_prefix: "video/dials_simple" } }],
    needs: { video: ["save", "video"] },
    face: [["save", "filename_prefix", "saves as"]],
  },
};

// any installed node as a brick ("node:<Type>#<n>"), built on demand from its node definition, so workflows that use
// such bricks reopen without extra state: link inputs are its needs (role = input name), outputs what it provides
// (role = output name, lowercased), the first few widgets its face
const WIDGET = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);
function nodeBrick(key) {
  const type = key.slice(5).split("#")[0], nd = LiteGraph.registered_node_types[type]?.nodeData;
  // a saved brick whose node pack is gone: a plain stub, so the recipe still shows and the brick can be removed
  if (!nd) return { title: `${type} (not installed)`, icon: "◻", hue: 0, blurb: "missing node", node: type, missing: true, nodes: [{ key: "node", type }], needs: {}, provides: {}, face: [] };
  const inputs = Object.entries({ ...nd.input?.required, ...nd.input?.optional });
  const isWidget = ([, spec]) => (Array.isArray(spec[0]) || WIDGET.has(spec[0])) && !spec[1]?.forceInput; // forceInput: a socket
  const hue = [...type].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return {
    title: nd.display_name || type, icon: "◻", hue, blurb: nd.category || "node", node: type,
    nodes: [{ key: "node", type }],
    needs: Object.fromEntries(inputs.filter((i) => !isWidget(i)).map(([name]) => [name, ["node", name]])),
    provides: Object.fromEntries((nd.output ?? []).map((t, i) => { const name = nd.output_name?.[i] || t; return [name.toLowerCase(), ["node", name]]; })),
    face: inputs.filter(isWidget).slice(0, 3).map(([name]) => ["node", name, name.replaceAll("_", " ")]),
  };
}

// own keys only: agent text must not reach inherited names like "constructor"
export const BRICKS = new Proxy(PACK, { get: (t, k) => (Object.hasOwn(t, k) ? t[k] : typeof k === "string" && k.startsWith("node:") ? (t[k] = nodeBrick(k)) : undefined) });
export const PACK_BRICKS = Object.keys(PACK);
// the slot brick to put the rail's tile on: the first pack brick of the slot for the recipe's kit
export const slotDefault = (slot, k) => Object.keys(PACK).find((key) => PACK[key].slot === slot && PACK[key].kit === k);
// which bricks fit a recipe: H3 video bricks and image bricks don't mix (`kit`); the Dial Rack and LoRA stacks fit both
export const kit = (keys) => keys.map((k) => PACK[k]?.kit).find(Boolean) ?? null;
export const fits = (key, keys) => (!PACK[key]?.kit || !kit(keys) || PACK[key].kit === kit(keys)) && (!PACK[key]?.slot || slotDefault(PACK[key].slot, PACK[key].kit) === key);

// every installed node type a person can add as a brick, for the palette
export function nodeTypes() {
  return Object.entries(LiteGraph.registered_node_types).filter(([, c]) => c.nodeData && !c.nodeData.deprecated && !c.nodeData.experimental)
    .map(([type, c]) => ({ type, title: c.nodeData.display_name || type, category: c.nodeData.category || "" }));
}

// the Setup brick (SNAP-R9): in Snap the model set and how it samples read as one brick, the first of these the recipe
// has; the graph keeps each brick's own nodes and the engine its own bricks (SNAP-R2), so setups, the Turbo chip and the
// agent tools work on them as before
export const SETUP = { title: "Setup", icon: "◇", hue: 210, blurb: "the model set and how it samples: family, model, turbo", members: ["models", "preset", "image_models", "loras"] };

// the Simple recipe in reading order
export const SIMPLE_RECIPE = ["models", "preset", "rack", "first_frame", "refs", "render", "upscale", "save_video"];
