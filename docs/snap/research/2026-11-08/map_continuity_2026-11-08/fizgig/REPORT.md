# Fizgig H3 overhead-map comparison — 2026-11-08

**The map improves the damage site and some actor alignment, but this Fizgig recipe does not provide exact blocking.** Both W candidates miss the side camera and put feet on the engraved ring. S keeps the set and viewing direction much better; adding the map moves Corvin toward the centre and puts branching damage at the north rim, but Liora stays left of the shared centreline and Corvin is not clearly beyond the circle.

Side-by-side images (local evidence: `index.html`). Native 1920×1088 PNGs are in `images/`; all four were inspected whole at native resolution and in critique tiles. All requests, whole responses, compiled ComfyUI history, critique packets and notes are retained here, including failures. No rerolls, video, installs, downloads, service changes, production-record edits, board picks or active-take replacements. Four candidate stills landed only in the existing separate lab scene/shot. Page released after critique notes were written.

## Controlled comparison

The four saved argument sets from `../trial/` are identical except `method: fizgig_still`. Prompt, reference order, location/Cast versions, dimensions, purpose, land target, question and seed are preserved. Within each camera pair the guided arm adds only Picture 4, the same M1 damage map (`take-a997689e-d40b-4415-83a3-094759a051bf`). Seed 880101 is paired W; 880102 is paired S. `verification.json` contains equality assertions, hashes, actual timing and compiled reference paths.

| Cell | Take | Reading | Graph wall |
|---|---|---|---:|
| control_W | `take-3b80818b-8d09-4eb3-86d0-1a0726b94b3c` | End-on terrace rather than east-to-west side camera; both feet on broad circle band; central/near-side cracks. | 54.885 s |
| guided_W | `take-0e82d4a2-b9fe-41cd-8ea7-544adb5f069e` | Same camera/feet failure; damage moves toward Corvin/right rim with a more map-like branching silhouette. | 77.046 s |
| control_S | `take-1386dbb2-63cf-4df3-81fc-a39c5c1c0683` | S camera and stone-pedestal armillary hold; Liora near-left and Corvin far-right; central damage and Corvin on circle. | 46.879 s |
| guided_S | `take-e2406e08-963d-4a76-bc5c-c5fcd25fee42` | S camera/set hold; Corvin nearer centre, cracks at north rim; Liora still left of centreline, Corvin at/on far rim with no clear gap. | 65.703 s |

## Fixed checks

- **Circle:** one principal engraved floor circle in each image, but neither W candidate keeps both actors outside it. S guided retains the visible source circle bands better; exact metric size/position is not established. The W control also invents a ring around the orrery base.
- **People and facing:** exactly one recognisable Liora and Corvin in each, one lowered wand each. W has the requested screen left/right and mutual facing but the world camera is wrong. S has near/far order and broadly opposing facing; the map does not recover the exact common world centreline.
- **Persistent damage:** map-guided W moves the crack to Corvin's side but puts its origin at the rim, with a changed footprint. Guided S carries north-edge branching cracks much better than the central starburst in the control. This is useful coarse state transfer, not exact crack geometry.
- **Camera and whole set:** W fails in both arms, drawing long converging terrace rails and a central end armillary instead of the supplied straight side rail. W control invents a large academy building/garden backdrop; both W armillaries replace the stone pedestal with brass stands. S retains the armillary on stone, pale repeated balusters, open mountainous dusk and source composition much more closely. Changing the map therefore changes more than blocking in W.
- **Identity:** the copper-haired woman in green/brown and white-haired older man in charcoal/silver remain identifiable. Fine eye colour is not established in the small/full-back faces. This is a visual comparison, not a measured identity benchmark.
- **Leakage:** no labels, arrows, actor dots or accidental overhead camera in any clean candidate. The black branching terrain mark is the requested damage; its recognisable transfer should not be mistaken for text leakage.

## Actual configured and compiled path

Live `list_methods` says ready; all four actual history graphs confirm the following, rather than inferring the family from the source pictures:

- UNET `h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors`;
- CLIP `h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`, type minimax;
- VAE `h3/minimax_h3_video_vae_fp16.safetensors`;
- `h3/minimax_h3_turbo_v4_step600_ema.safetensors`, model strength 0.38;
- `MiniMaxH3ReferenceToVideo`, every picture a reference, reference size match; its conditioning node length is 5, while `FizgigH3StillLatent` and `FizgigH3StillDecode` produce one saved frame;
- `BasicGuider`, er_sde, simple scheduler, 20 steps, denoise 1.0; 1920×1088 latent, batch 1.

W compiled Picture 1 is `snap/take-6af5bc8e-e50e-41bb-a9d7-74e5f3040faf_f0.png`, the actual side plate. S compiled Picture 1 is `snap/take-1af2ec3b-44eb-4e01-a9b4-951b6dd40900_f0.png`. Both use identical saved Cast pictures; guided arms add the existing M1 take image. Each compiled prompt equals its request.

Graph execution wall sum **244.513 s**; first graph start to final graph end **256.839 s**. This includes execution/load and encoding, not GPU-kernel-only time. First control paid model loading; later cells reuse cached components, so these are observed costs, not a clean throughput benchmark.

## Limits and recommendation

One seed per camera cell, no rerolls. Both H3 methods now show useful partial map guidance in S and repeated camera/blocking failure in W under the same wording. The W prompt names offscreen end landmarks, a plausible camera confound already identified by the first trial; this comparison intentionally preserves it and does not isolate that cause. The test does not show that all H3 prompting or every map recipe fails, and does not establish six-view, temporal or metric reliability.

For exact blocking, both tested recipes are insufficient. Proceed to the separately scoped Qwen 2.1 fallback comparison with the preserved sources and matched cells. No Qwen implementation or generation was performed by this worker. Keep the map a planning/state aid until a clean board passes the fixed camera, landmark, feet and damage checks.
