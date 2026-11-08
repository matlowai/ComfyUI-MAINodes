# Top plus original sides — 2026-11-08

COMPLETED: three native Snap stills, no rerolls. New isolated scene `scene-mw880l68vodo`, shot `shot-mw880v8tnn4g`; no active candidate chosen and no production canon/Cast/location versions changed. Original pixels, hashes, prompts, requests, complete executed histories, docket receipts and all failures are preserved here.

## Results

All three retain the desired W-facing horizontal side camera: long horizontal balustrade, blue mountains and dusk, rather than the prior aerial-only end-on reconstruction. Exactly two inward-facing full figures and two lowered held wands appear. Broad character colours and costumes hold. However **none meets the outside-ring staging requirement**: P-H3 top+W offsets the ring left and crops it below, with Liora over its footprint; P-H3 top+W+S puts both figures on the ring bands; Fizgig top+W+S puts Liora inside the ring and Corvin on its right band. No clean first frame is recommended for exact continuity, and no downstream video was run.

The original W side explicitly provides both vertical geometry AND the desired output-camera composition. These are NOT aerial-only renders, new-camera reconstruction tests, or isolated evidence of a top-view benefit. The second S side is distinct cross-side geometry, explicitly not output composition. One same-seed pair gives no reliability estimate or demonstrated benefit from adding S. Relative to historical aerial-only results, references AND wording changed. No matched no-top control was run.

| native method | packet | seed | size | execution seconds | outcome |
|---|---|---:|---|---:|---|
| P-H3 | top + W + actors (4 pictures) | 887101 | 2016×1152 | 31.682 | side camera holds; ring offset/cropped |
| P-H3 | top + W + S + actors (5 pictures) | 887101 | 2016×1152 | 37.184 | side camera holds; both on ring bands |
| Fizgig | top + W + S + actors (5 pictures) | 887101 | 2016×1152 | 129.022 | side camera holds; Liora inside ring |

Execution intervals come from ComfyUI history start/success timestamps, including model/reference loading and excluding inspection/report work. Main local GPU generation was serial. These timings are this installed native recipe, not a throughput benchmark; first-load and five-reference overhead matter.

## Inputs and limits

Picture order is TOP candidate2, original W side, optional original S cross-side, clean Liora, clean Corvin. Exact executed LoadImage nodes confirm only these four/five files; see results.json and full histories. The top is the user's native selected candidate2, not an authored aspect-ratio construction. Originals were copied and SHA256-hashed in inputs.json. No actor paste, blur, denoise substitution, reference cropping or geometric stretching occurred.

The generated top is a general layout reference, not measured geometry: its narrow rectangle, ring proportions and stairhouse depiction do not establish exact source proportions. Original W/S views remain authoritative. The prompt explicitly gives originals precedence where the top differs; it does not rewrite canon or merge incompatible dimensions. The current crops cannot prove exact terrace dimensions, whole-place topology, correct offscreen landmarks, compass illumination or eye height. Horizontal rail and mountain silhouette alone do not fix a unique ground vanishing horizon; no exact height claim is made.

## Native contracts verified

P-H3: p-h3-image_int8_convrot with matching int8 text encoder and VAE; shift1/1; Euler and BasicGuider; full eight updates using manual sigmas 1,.984753,.967905,.951688,.925372,.881923,.810083,.528718,0. PH3ImageConditioning receives all four/five pictures and supplies native full-generation latent. No denoise override.

Fizgig: minimax_h3_fl2va_pruned_int8_convrot + turbo_v4_step600_ema at .38; qwen3vl_32b_minimax_h3_nvfp4_awq text encoder and video_vae_fp16; MiniMaxH3ReferenceToVideo with five pictures, length5, ref_image_size=match; FizgigH3StillLatent; er_sde/simple20, denoise1, BasicGuider. This is the installed native method, not a substituted setup.

## Critic and live instruction

All three landed-picture rows were claimed and written FLAWS after whole native frame, 100% tiles, supplied clean references and board-checklist review. Docket IDs: crit-1a1bc9fd595-9b25; crit-1a1bca0afec-911f; crit-1a1bca32d11-ce33. High beat notes record incorrect ring-relative actor placement, owned by generated take. Formal packet metadata may include provenance-linked location master/plan/other plates for critique context; those additional pictures are NOT hidden generation inputs, as executed histories demonstrate.

At coordinator request, saved a new version of existing global set-design note in place: **instruction:note-mw83pojv9vuc@2**, stack hash f2d5fec965a6. It preserves whole-set review and adds mandatory textured top + at least one genuine side, preferably two, labelled camera/role/source version; originals resolve conflicts; no additional approval/API gate. Full request and receipt: instruction_args.json and update_set_design.response.json. First two stills queued before that live update; third after it. Canonical R271 guidance was already read for every arm.

No code, skills, models, server configuration, production choices, installs or downloads changed. No commits, pushes, deletes or restarts. Three-still cap reached; the next approach must fix visible ring/actor staging rather than repeat seeds of this recipe.
