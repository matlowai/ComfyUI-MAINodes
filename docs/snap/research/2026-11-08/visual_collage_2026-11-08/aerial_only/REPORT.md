# Aerial plus characters only

COMPLETED (four stills; no more queued): root confirmed user choice of native candidate2 aerial; no authored rectangle, ring rescale, actor paste or camera-view image is used. Exactly three inputs, copied and hashed in inputs.json: empty aerial, clean Liora, clean Corvin. Actor placement is verbal rather than depicted in the empty aerial. Camera is verbal E long edge looking W at standing eye height. New isolated scene/shot; no production records changed.

No exact source-set dimensions are established; this tests general reference-to-camera feasibility. All failures will be retained.

## Findings

All four outputs show exactly two full figures in inward-facing profiles and broadly retain original appearance and lowered wands. No overhead reversion occurred. All four fail the requested E long edge looking W camera/set mapping: long rails recede to a centred end landmark behind the ring. P-H3 both and Fizgig seed887102 bring the opposite-end armillary and stairs together; Fizgig seed887101 shows a centred stairhouse/doorway with no armillary visible. On the aerial, the two structures are at opposite north/south ends. This end-on background cannot establish the requested side-on map, despite the actors themselves being in profile. Both figures stand within the ring footprint instead of outside it. Source geometry continuity is therefore not validated.

The requested west light would be roughly behind the figures when looking W. All four put the sun at upper right and shadows to left; materials and warm light are coherent but fixed compass lighting is not established. No exact metres or ring dimensions were inferred. There are no unexpected extra people.

## Native contracts

P-H3: p-h3-image_int8_convrot; matching int8 text encoder/VAE; shift1/1; Euler, BasicGuider; eight updates with full native manual sigmas 1,.984753,.967905,.951688,.925372,.881923,.810083,.528718,0; PH3ImageConditioning receives three images, output latent is native full-generation latent. No denoise override.

Fizgig: installed native method uses minimax_h3_fl2va_pruned_int8_convrot + turbo_v4_step600_ema at .38; qwen3vl_32b_minimax_h3_nvfp4_awq text encoder and video_vae_fp16; MiniMaxH3ReferenceToVideo with three images, length5, ref_image_size=match; FizgigH3StillLatent; er_sde/simple20, denoise1, BasicGuider. This is the live method's native contract, not a substituted setup.

Exact executed histories for each output contain ONLY three LoadImage inputs, in aerial/Liora/Corvin order. No generated output, original camera plate, location/master reference or hidden template image is present. Inputs and hashes are in inputs.json; full executed nodes/status in each history and results.json.

| method | seed | execution seconds | result |
|---|---:|---:|---|
| ph3 | 887101 | 22.734 | camera/set mapping and ring-relative placement fail |
| ph3 | 887102 | 11.892 | camera/set mapping and ring-relative placement fail |
| fizgig | 887101 | 76.454 | camera/set mapping and ring-relative placement fail |
| fizgig | 887102 | 45.853 | camera/set mapping and ring-relative placement fail |

First-seed times include model/prompt/reference loading; these execution intervals exclude Snap inspection and report work. Two seeds per model are a small feasibility sample, not a reliability estimate. No matched no-aerial control was run, so no causal benefit claim follows. No active choice, canon, original production record, code, server, model installation or downloads were changed. No commits, pushes or deletions.

Formal docket: four landed-picture rows claimed and written as flaws after whole native-frame, tile, context and board-checklist review. Exact responses retained. Queue empty at finish; codex-aerial-only released page. No output recommended for fixed-set continuity; next experiment requires a changed guidance approach, not more seeds of this recipe.
