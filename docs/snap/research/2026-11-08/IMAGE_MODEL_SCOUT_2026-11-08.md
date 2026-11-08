# Image model scout — 2026-11-08

Read-only follow-up to the bird's-eye-map experiment. No generation, model loading, browser/page ownership change, download or install performed.

## The two existing H3 image routes

The current Snap view registry contains exactly two methods: `ph3_view` and `fizgig_still`. These are different generation paths, not two presets of the same P-H3 image model.

| Method | Actual implementation | Native settings | Picture contract |
|---|---|---|---|
| `ph3_view` | Dedicated P-H3-Image model: `h3/p-h3-image_int8_convrot.safetensors`, matching P-H3 image text encoder and VAE | Eight steps, Euler, the method's manual sigma grid, no CFG/negative; shifts 1/1 | Picture 1 is the image being edited; remaining pictures are references. Words can change the camera. Explicit output width/height avoid inheriting a small crop's size. |
| `fizgig_still` | Stock H3 `h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors` with Fizgig one-frame latent/decode and `h3/minimax_h3_turbo_v4_step600_ema.safetensors` at 0.38 | Twenty steps, ER-SDE/simple; H3 Qwen3VL 32B encoder and H3 video VAE | Every picture is a reference. Words set the camera. This is the pack's measured still recipe; do not replace its FL2VA checkpoint with Ref2VA just because video cuts use Ref2VA. |

Both methods accept up to nine context pictures through existing `edit_from_context`. The live server registers `PH3ImageConditioning`, `FizgigH3StillLatent` and `FizgigH3StillDecode`. The exact weights above are visible to its loaders and exist locally. No third H3-specific still/edit method was found in the current Snap view registry.

The canonical `snap-model-choice` skill picks P-H3 for sets/wides/targeted edits, Fizgig for character shots and two-shots, and explicitly says to compare models at the same size. It records Fizgig softness below roughly 2–3 MP. The table is a measured default, not grounds to skip the other route when a new task fails. The present task is a different capability: reading a symbolic overhead map, preserving layout, and updating annotations/damage.

## Next comparison: try Fizgig before Qwen

Use the failed or uncertain P-H3 task's **same original input files, same ordering, same full prompt, same seed and same requested output dimensions**. Do not use P-H3's failed output as Fizgig's starting picture: that would compare a new input as well as a new model. Pass `method: "fizgig_still"` explicitly so `purpose: "edit"` does not route back to P-H3.

```json
{
  "pictures": [
    {"file": "<same input image>", "label": "<same label>"}
  ],
  "prompt": "<same full prompt, with the same picture numbers>",
  "method": "fizgig_still",
  "purpose": "edit",
  "seeds": ["<same numeric seed>"],
  "width": 1920,
  "height": 1088,
  "land": {"scene": "<experiment scene>", "shot": "<comparison shot>"}
}
```

This is a binding template, not literal runnable JSON: replace the seed with the original integer and include all original context pictures. 1920×1088 is about 2.09 MP. If the current test already uses another size at roughly 2 MP, preserve its exact size in both arms instead. If the original P-H3 attempt used lower resolution, render one matched P-H3 baseline at the comparison size rather than attributing all improvement to Fizgig. Output size being equal does not make the samplers/steps equivalent: keep each method's native measured recipe and report the difference.

For this first model-switch comparison, one seed per model is enough to reveal a decisive capability difference. If ambiguous, use one second matched seed in each, then change the approach rather than extending best-of-N selection.

Score the same facts before choosing:

- Fixed terrace boundary, engraved-circle centre/size and landmark relationships survive.
- Exactly two actor marks/people, correct ground positions and facing; red arrows remain distinct from movement paths.
- A map edit preserves overhead projection and unchanged items; a camera-view edit follows the requested camera rather than copying the map.
- Accepted terrain changes persist in the correct map location.
- No unintended duplicate circles, actor markers, labels or arrow fragments.
- For clean board output, annotations are absent and Cast appearance holds.

Record queue time separately from GPU time; quote first seed versus additional seed. Registry costs are historical, not a promise for today's load: P-H3 roughly 7–10 s per 1280×704 still after load; Fizgig about 24 s at 1280×704 / 38 s at 2112×1184 after load. Do not compare one model warm against another's first load without saying so.

## Exact Qwen Image 2.1 is available locally

The live `:8193` loader metadata and files confirm these exact artifacts:

- Diffusion model: `qwen21/qwen_image_2.1_int8_convrot.safetensors` (7,256,783,064 bytes).
- Edit text encoder: `qwen21/qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors` (9,471,072,252 bytes).
- Also installed: `qwen21/qwen3vl_8b_int8_convrot.safetensors` (9,350,798,360 bytes).
- Matching VAE: `qwen21/qwen_image_2.1_vae_bf16.safetensors` (675,509,688 bytes).

This is evidence of exact local Qwen 2.1 availability, not a successful load or edit run. Do not silently substitute Qwen Image Edit 2511, Edit Plus or a hosted API.

The live native node `TextEncodeQwenImage21` is registered, along with `QwenImage21Cache`. Local core code confirms the 2.1 encoder:

- Accepts prompt/negative prompt, optional VAE, reference-image Autogrow inputs and a reference resolution setting.
- Supplies the references to the vision encoder and, with a VAE, encodes them as `reference_latents` for both positive and negative conditioning.
- Returns positive conditioning, negative conditioning, and an empty latent matching the **first reference's processed size**. This is important: arbitrarily using another latent size shifts the edit.
- `resolution: 0` keeps each reference at its own size rounded to multiples of 32. At a nonzero resolution the inputs are rescaled to approximately that square pixel area while retaining aspect.

No Qwen 2.1 reference was found in current Snap `snap_cards` or `web/snap`: **the native model/node path exists, but Snap has no registered Qwen 2.1 `view` method yet.** If both H3 image routes fail and the coordinator moves to Qwen 2.1, the smallest integration belongs in Snap's existing view-method adapter and registry. Follow the project's “update Snap, do not route around it with an outside graph” rule. Verify the exact encoder/loader wiring and sampling recipe from a local working 2.1 workflow or native integration before implementing it; this scout did not establish those sampling defaults.

Keep Qwen 2.1's cache at its default lossless behaviour in an initial correctness comparison. Changing cache quantization at the same time would add a separate accuracy variable.

## Inspection and limits

Read the complete canonical `snap-model-choice` skill and both current H3 view-method entries. Inspected relevant local filenames and live loader choices; live node class metadata; native `TextEncodeQwenImage21` implementation; and searched only Snap's current method/adapter sources for Qwen 2.1 registration. An initially overbroad workflow search included unrelated saved web assets and was discarded; the task-relevant search was repeated in focused sources without relying on that oversized result.

No external product/model facts were needed, so no web search was performed. No performance or output-quality result is claimed. The immediate next action is the matched Fizgig trial; Qwen 2.1 is the verified local next option after that, with a small Snap integration still needed.
