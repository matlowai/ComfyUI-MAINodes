// A fake model shelf for CPU tests (the CPU server has only dial files): object_info gets these file names as loader
// choices and /experiment/models lists them with sizes. `gone` names are choices with no file (moved away); `extra` adds
// files per folder for one test (the same shape as SHELF). SHELF is read per request, so a test can add a file later.
const GB = 1e9;
const SHELF = {
  diffusion_models: [["moss_image_base_int8_convrot.safetensors", 5.41], ["moss_image_sft_deband_int8_convrot.safetensors", 5.41], ["moss_image_sft_int8_convrot.safetensors", 5.41],
    ["moss_image_sft_deband_fast_dmd035_int8_convrot.safetensors", 5.41], ["kromoss_int8_convrot.safetensors", 5.41], ["krea2/krea-2-raw.safetensors", 26.28],
    ["krea2/krea-2-raw-int8-convrot.safetensors", 16.17], ["krea2/krea2_turbo_fp8_scaled.safetensors", 13.14], ["h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", 21.0],
    ["h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", 21.0]],
  text_encoders: [["qwen3.5_9b_int8_convrot.safetensors", 9.75], ["krea2/qwen3vl_4b_fp8_scaled.safetensors", 5.24], ["h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15.7]],
  vae: [["flux2-vae.safetensors", 0.34], ["krea2/qwen_image_vae.safetensors", 0.25], ["h3/minimax_h3_video_vae_fp16.safetensors", 5.2], ["h3/minimax_h3_audio_vae_fp32.safetensors", 0.6]],
  loras: [["lodestones_kromoss_8step_dmd2_lora.safetensors", 1.19], ["lodestones_moss_sft_8step_dmd_lora_latest.safetensors", 1.19], ["darask0_moss_sft_4step_dmad_lora.safetensors", 1.19],
    ["comfy_moss_hires_lora_test_v0.7.safetensors", 0.18], ["mystery_style_v2.safetensors", 0.2], ["odd_thing_v3.safetensors", 0.1], ["h3/pika_h3_flex_fl2va_v1_bf16.safetensors", 2.0],
    ["h3/pika_h3_flex_ref2va_comfy_bf16.safetensors", 2.0], ["h3/minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", 0.4]],
  upscale_models: [["4x-UltraSharp.safetensors", 0.07], ["RealESRGAN_x2plus.safetensors", 0.07]],
};
const EXT = [".bin", ".ckpt", ".pkl", ".pt", ".pt2", ".pth", ".safetensors", ".sft"]; // what core's folder list says
// node type -> its model-file inputs (top-level combos, or a dynamic group's template field)
const INPUTS = { UNETLoader: { unet_name: "diffusion_models" }, CLIPLoader: { clip_name: "text_encoders" }, VAELoader: { vae_name: "vae" },
  MAIRenderPreset: { model: "diffusion_models", lora: "loras" }, LoadLoraModel: { "loras.lora_name": "loras" }, UpscaleModelLoader: { model_name: "upscale_models" } };
async function useShelf(page, { gone = [], extra = {}, noPictures = false } = {}) {
  for (const [folder, list] of Object.entries(extra)) SHELF[folder].push(...list);
  await page.route(/\/api\/object_info$/, async (r) => {
    const res = await r.fetch(), info = await res.json();
    for (const [type, inputs] of Object.entries(INPUTS)) for (const [name, folder] of Object.entries(inputs)) {
      const [group, field] = name.split(".");
      const spec = field ? info[type].input.required[group][1].template.required[field] : info[type].input.required[name];
      const names = [...SHELF[folder].map(([n]) => n), ...gone.filter((g) => g.folder === folder).map((g) => g.name)];
      if (Array.isArray(spec[0])) spec[0] = [...names, ...spec[0].filter((x) => x !== "pixel_space" && !names.includes(x))];
      else spec[1].options = [...names, ...(spec[1].options ?? []).filter((x) => !names.includes(x))];
    }
    if (noPictures) info.LoadImage.input.required.image[0] = []; // an empty input folder
    r.fulfill({ response: res, json: info });
  });
  await page.route(/\/api\/experiment\/models(\/[^/]+)?$/, async (r) => {
    const folder = r.request().url().match(/experiment\/models\/([^/?]+)/)?.[1];
    if (!folder) return r.fulfill({ json: Object.keys(SHELF).map((name) => ({ name, folders: [], extensions: EXT })) });
    const real = folder === "loras" ? await (await r.fetch()).json() : []; // the dial files the CPU server really has
    r.fulfill({ json: [...(SHELF[folder] ?? []).map(([name, gb]) => ({ name, size: gb * GB, modified: 1, pathIndex: 0 })), ...real] });
  });
}
module.exports = { SHELF, useShelf };
