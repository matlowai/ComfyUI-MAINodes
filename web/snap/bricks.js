// Snap bricks for the Dials + Pika Simple recipe (phase 1: our own bricks, pack-shipped rules).
// A brick is one or more graph nodes with a clean face. `provides` maps port roles to output slot names, `needs` maps
// port roles to input names; rules say which role feeds which, so binding never guesses for our own bricks.

export const RENDER_BLUEPRINT = "Dials - H3 + De-rope";

const PACK = {
  models: {
    title: "Models", icon: "◇", hue: 210,
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
    title: "Render Preset", icon: "◎", hue: 265,
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
    title: "First frame", icon: "▣", hue: 150, optional: true,
    blurb: "FL2V start picture",
    nodes: [{ key: "image", type: "LoadImage", title: "first frame (FL2V)" }],
    provides: { first_frame: ["image", "IMAGE"] },
    face: [["image", "image", "picture"]],
  },
  refs: {
    title: "References", icon: "❖", hue: 185, optional: true,
    blurb: "pictures, clips and sound for Ref2V",
    nodes: [{ key: "refs", type: "H3References", title: "H3 References" }],
    provides: { refs: ["refs", "refs"] },
    face: [],
  },
  render: {
    title: "Render", icon: "▶", hue: 330,
    blurb: "H3 + Pika + de-rope, saves the video",
    blueprint: RENDER_BLUEPRINT,
    needs: {
      clip: ["render", "clip"], video_vae: ["render", "vae"], audio_vae: ["render", "vae_1"], model: ["render", "model"],
      sampler: ["render", "sampler"], sigmas: ["render", "sigmas"], derope_steps: ["render", "steps"],
      conditioning: ["render", "branch"], cfg: ["render", "cfg"], first_frame: ["render", "first_frame"], refs: ["render", "refs"],
    },
    face: [["render", "prompt", "prompt"], ["render", "length", "frames"], ["render", "noise_seed", "seed"], ["render", "choice", "de-rope"]],
  },
  // attaches to Render's own setting: the blueprint has no VIDEO output yet, so Upscale is a switch, not a link. Its
  // settings are the RelayVSR Settings node inside the Render blueprint; `check` asks the server whether a run would find
  // LightX2V and the weights for those settings. The face is the outcome: the size the clip ends up, one Off / 2× / 4×
  // control (Off keeps the brick and its settings), and the quality preset's short name
  upscale: {
    title: "Upscale", icon: "⤢", hue: 95, optional: true,
    blurb: "RelayVSR after the render",
    attach: { brick: "render", widget: "upscale", on: "RelayVSR 2x", off: "off", inner: { settings: "RelayVSRModelSettings" } },
    check: ["settings", "/mainodes/relayvsr/check"],
    headline: (get, on) => {
      const w = get("render", "render", "width"), ht = get("render", "render", "height"), k = Number(get("upscale", "settings", "output_scale"));
      return on ? `${w}×${ht} → ${w * k}×${ht * k}` : `${w}×${ht} (not upscaled)`;
    },
    face: [["settings", "output_scale", "upscale", { inline: [{ label: "Off", attach: false }, { label: "2×", value: "2" }, { label: "4×", value: "4" }] }],
      ["settings", "quality", "quality", { short: true }]],
    explain: { variant: ["Model", "The X4 model is used for 2× too; it looked best in our tests."] },
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

// every installed node type a person can add as a brick, for the palette
export function nodeTypes() {
  return Object.entries(LiteGraph.registered_node_types).filter(([, c]) => c.nodeData && !c.nodeData.deprecated && !c.nodeData.experimental)
    .map(([type, c]) => ({ type, title: c.nodeData.display_name || type, category: c.nodeData.category || "" }));
}

// the Simple recipe in reading order; Save lives inside the Render blueprint (video/dials_simple)
export const SIMPLE_RECIPE = ["models", "preset", "rack", "first_frame", "refs", "render", "upscale"];
