// Snap bricks for the Dials + Pika Simple recipe (phase 1: our own bricks, pack-shipped rules).
// A brick is one or more graph nodes with a clean face. `provides` maps port roles to output slot names, `needs` maps
// port roles to input names; rules say which role feeds which, so binding never guesses for our own bricks.

export const RENDER_BLUEPRINT = "Dials - H3 + De-rope";

export const BRICKS = {
  models: {
    title: "Models", icon: "◇", hue: 210,
    blurb: "text encoder and the two H3 VAEs",
    nodes: [
      { key: "clip", type: "CLIPLoader", title: "Text encoder" },
      { key: "video_vae", type: "VAELoader", title: "Video VAE", values: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
      { key: "audio_vae", type: "VAELoader", title: "Audio VAE", values: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    ],
    provides: { clip: ["clip", "CLIP"], video_vae: ["video_vae", "VAE"], audio_vae: ["audio_vae", "VAE"] },
    face: [["clip", "clip_name", "encoder"]],
  },
  preset: {
    title: "Render Preset", icon: "◎", hue: 265,
    blurb: "model, LoRA, sampler and de-rope schedule",
    nodes: [{ key: "preset", type: "MAIRenderPreset", title: "Render Preset" }],
    provides: {
      base_model: ["preset", "MODEL"], sampler: ["preset", "SAMPLER"], sigmas: ["preset", "sigmas"],
      derope_steps: ["preset", "derope_steps"], conditioning: ["preset", "conditioning"], cfg: ["preset", "cfg"],
    },
    face: [["preset", "lora", "LoRA"], ["preset", "conditioning", "mode"], ["preset", "steps", "steps"]],
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
  // attaches to Render's own setting: the blueprint has no VIDEO output yet, so Upscale is a switch, not a link
  upscale: {
    title: "Upscale", icon: "⤢", hue: 95, optional: true,
    blurb: "RelayVSR 2x after the render",
    attach: { brick: "render", widget: "upscale", on: "RelayVSR 2x", off: "off" },
    face: [],
  },
};

// the Simple recipe in reading order; Save lives inside the Render blueprint (video/dials_simple)
export const SIMPLE_RECIPE = ["models", "preset", "rack", "first_frame", "refs", "render", "upscale"];
