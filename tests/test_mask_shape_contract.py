#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""A8 mask-shape contract: what current ComfyUI core does to an H3 nested
noise_mask before MiniMaxH3Model ever sees it.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_mask_shape_contract.py

VERDICT (measured below, ComfyUI 7d2640b3 / branch h3-fc-vsa-0829, 2026-09-04):

    H3 wants form (b): a SINGLE-CHANNEL [1, 1, T, H, W] mask at LATENT
    resolution, binary, and aligned to the DiT's 2x2 spatial patch.

    Why not (a) channel-expanded ones_like(video) [1, 24, T, H, W]: accepted,
    and for a channel-uniform mask it is exactly equivalent - but the model
    cond is built from CHANNEL 0 ALONE (model_base.py:2240
    `masks[0][:1, :1]`) while the SAMPLER blends with all 24 channels
    (samplers.py:638-642). A mask that varies across channels therefore
    freezes latents in the sampler while telling the model every row is fully
    live. Section 4 measures that divergence. 23 of the 24 channels are dead
    weight in the best case and a silent trap in the worst.

    Why not (c) [1, 1, 1, H, W]: accepted, but comfy.utils.reshape_mask
    trilinear-interpolates the single frame across all T (utils.py:1358-1363),
    so it can only ever express a TIME-STATIC mask. Handing it a mask whose
    first frame is frozen silently freezes the whole clip (section 3).
    Legitimate for Stage-S spatial tiling (static over latent time by design),
    wrong for anything temporal.

    Two further contract facts every mask builder has to respect:
      - the model-side mask is quantised to the 2x2 patch by amax pooling
        (model_base.py:2215-2228 + ldm/minimax/model.py:77-85): a seam through
        an odd latent column makes the whole patch live. Measured widening in
        section 5: 1040 -> 1120 live latent cells.
      - a pixel-resolution mask is RESAMPLED, not snapped. A binary pixel mask
        whose boundary is not on a 16-px (VAE space_down) grid comes out of
        reshape_mask with FRACTIONAL values, and those fractional values live
        on in the sampler blend even though the model-side token grid rounds
        them up to 1.0 (section 6). Hard model mask is never the soft output
        feather.

METHOD, and what is NOT exercised here (house rule: never mock anything).
Everything below calls real core functions on real tensors:
  comfy.sampler_helpers.prepare_mask -> comfy.utils.reshape_mask,
  comfy.utils.pack_latents, comfy.model_base.MiniMaxH3._denoise_mask_values ->
  _token_grid_masks -> _pool_masks_to_token_grid, and
  comfy.ldm.minimax.model.mask_row_values.
The MiniMaxH3 instance is a REAL comfy.model_base.MiniMaxH3 built on the
`meta` device from the real comfy.supported_models.MiniMaxH3 config: real
class, real patch_size (1, 2, 2), no weights allocated. Nothing is stubbed.
The unbind/prepare/pack sequence in `pipeline()` is the literal code of
comfy/samplers.py:1297-1314 (CFGGuider.sample), re-executed here rather than
called, because reaching CFGGuider.sample requires a loaded checkpoint and a
sampler run. That is the ONE place this test reproduces core control flow
instead of invoking it; if samplers.py:1297-1314 changes, this test goes stale
and section 1 is the tripwire (it asserts the shapes that sequence produces).
NOT exercised without a model, and NOT asserted here: the actual forward pass,
MiniMaxH3.scale_latent_inpaint's x_blend_weight (needs model_sampling and a
live x), and the mod_segments LongTensor construction in _forward.
"""
import sys
import traceback

sys.path.insert(0, "/mnt/work/ai/apps/ComfyUI")

ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


try:
    import torch
    import comfy.options
    comfy.options.enable_args_parsing()
    import comfy.model_base as model_base
    import comfy.supported_models as supported_models
    import comfy.sampler_helpers as sampler_helpers
    import comfy.utils as comfy_utils
    import comfy.nested_tensor as nested_tensor
    from comfy.ldm.minimax.model import mask_row_values
except Exception as e:  # noqa: BLE001
    print("CANNOT RUN: comfy is not importable from /mnt/work/ai/apps/ComfyUI")
    print("   %s: %s" % (type(e).__name__, e))
    traceback.print_exc()
    sys.exit(1)

torch.set_grad_enabled(False)

# ---------------------------------------------------------------- fixtures
T, H, W, TA = 5, 16, 24, 20
V_SHAPE = (1, 24, T, H, W)
A_SHAPE = (1, 32, 2, TA)

torch.manual_seed(0)
video = torch.randn(V_SHAPE)
audio = torch.randn(A_SHAPE)
latent = nested_tensor.NestedTensor((video, audio))
latent_shapes = [tuple(x.shape) for x in latent.unbind()]
check("fixture: nested latent unbinds to the H3 pair",
      latent_shapes == [V_SHAPE, A_SHAPE], str(latent_shapes))

config = supported_models.MiniMaxH3({"image_model": "minimax_h3"})
with torch.device("meta"):
    h3 = model_base.MiniMaxH3(config, device=torch.device("meta"))
check("fixture: real MiniMaxH3 on meta, patch_size (1, 2, 2)",
      tuple(h3.diffusion_model.patch_size) == (1, 2, 2),
      str(tuple(h3.diffusion_model.patch_size)))


def pipeline(video_mask, audio_mask=None):
    """comfy/samplers.py:1297-1314, on a nested noise_mask, then the H3
    extra_conds mask path (model_base.py:2201-2246). Returns
    (prepared_video_mask, packed_mask, denoise_mask_values dict)."""
    if audio_mask is None:
        audio_mask = torch.ones(A_SHAPE)
    masks = list(nested_tensor.NestedTensor((video_mask, audio_mask)).unbind())
    masks = masks[:len(latent_shapes)]
    for i in range(len(masks), len(latent_shapes)):
        masks.append(torch.ones(latent_shapes[i]))
    for i in range(len(masks)):
        masks[i] = sampler_helpers.prepare_mask(masks[i], latent_shapes[i], "cpu")
    packed, _ = comfy_utils.pack_latents(masks)
    packed = packed.float()
    values = model_base.MiniMaxH3._denoise_mask_values(h3, packed, latent_shapes)
    return masks[0], packed, values


def rows_of(values):
    """The per-2x2-patch row values MiniMaxH3Model._forward would build
    (ldm/minimax/model.py:626)."""
    dm = values.get("denoise_mask")
    if dm is None:
        return None
    return mask_row_values(dm[0, 0].to(torch.float32), T, H, W)


def describe(t):
    if t is None:
        return "None"
    u = sorted(set(t.unique().tolist()))
    return "shape %s dtype %s uniq %d %s" % (
        tuple(t.shape), t.dtype, len(u), u[:6] if len(u) <= 6 else str(u[:6]) + "...")


# right half live, left half frozen; static in time, boundary on a 2x2 patch edge
base = torch.zeros(T, H, W)
base[..., W // 2:] = 1.0

FORMS = {
    "a_channel_expanded": base.reshape(1, 1, T, H, W).expand(1, 24, T, H, W).contiguous(),
    "b_single_channel": base.reshape(1, 1, T, H, W).clone(),
    "c_broadcast_1frame": base[0].reshape(1, 1, 1, H, W).clone(),
}

print("\n--- 1. the three candidate forms, before and after core's preparation")
prepared, results, row_values = {}, {}, {}
for name, m in FORMS.items():
    print("  %-20s BEFORE %s" % (name, describe(m)))
    pv, packed, values = pipeline(m)
    prepared[name], results[name] = pv, values
    row_values[name] = rows_of(values)
    print("  %-20s AFTER  prepare_mask %s" % ("", describe(pv)))
    print("  %-20s AFTER  packed %s -> cond keys %s" % ("", tuple(packed.shape), list(values.keys())))
    print("  %-20s AFTER  model-side denoise_mask %s" % ("", describe(values.get("denoise_mask"))))
    print("  %-20s AFTER  mask_row_values %s" % ("", describe(row_values[name])))

for name in FORMS:
    check("1.%s survives: prepare_mask yields the video latent shape, float32" % name,
          tuple(prepared[name].shape) == V_SHAPE and prepared[name].dtype == torch.float32,
          describe(prepared[name]))

check("1.a channel-expanded is the ONLY form returned UNCHANGED by prepare_mask",
      torch.equal(prepared["a_channel_expanded"], FORMS["a_channel_expanded"])
      and prepared["b_single_channel"].shape != FORMS["b_single_channel"].shape
      and prepared["c_broadcast_1frame"].shape != FORMS["c_broadcast_1frame"].shape,
      "b is channel-repeated (utils.py:1364-1365), c is also time-interpolated (utils.py:1358-1363)")

check("1.model-side cond is single-channel [1,1,T,H,W] for every form",
      all(tuple(results[n]["denoise_mask"].shape) == (1, 1, T, H, W) for n in FORMS),
      str({n: tuple(results[n]["denoise_mask"].shape) for n in FORMS}))

print("\n--- 2. on a time-static, patch-aligned, binary mask the three forms agree")
check("2. all three forms give the same model-side denoise_mask",
      torch.equal(results["a_channel_expanded"]["denoise_mask"], results["b_single_channel"]["denoise_mask"])
      and torch.equal(results["b_single_channel"]["denoise_mask"], results["c_broadcast_1frame"]["denoise_mask"]))
check("2. all three forms give the same %d patch rows" % row_values["b_single_channel"].numel(),
      torch.equal(row_values["a_channel_expanded"], row_values["b_single_channel"])
      and torch.equal(row_values["b_single_channel"], row_values["c_broadcast_1frame"]),
      describe(row_values["b_single_channel"]))

print("\n--- 3. form (c) cannot carry time: frame 0 is replicated over all T")
tv = torch.zeros(1, 1, T, H, W)
tv[:, :, 2:] = 1.0                       # frames 0-1 frozen, 2-4 live
_, _, v_b = pipeline(tv)
_, _, v_c = pipeline(tv[:, :, :1].clone())
rows_b, rows_c = rows_of(v_b), rows_of(v_c)
print("   form b rows: %s" % describe(rows_b))
print("   form c rows: %s" % describe(rows_c))
check("3. form (b) preserves the two time levels",
      rows_b is not None and rows_b.unique().numel() == 2, describe(rows_b))
check("3. form (c) collapses to frame 0's single level (SILENT loss)",
      rows_c is not None and rows_c.unique().numel() == 1
      and float(rows_c.unique()[0]) == 0.0, describe(rows_c))

print("\n--- 4. form (a) with per-channel variation: sampler and model disagree")
ca = torch.ones(1, 24, T, H, W)
ca[:, 3:] = 0.0                          # channels 3..23 frozen, channel 0 live
pv_ca, packed_ca, v_ca = pipeline(ca)
rows_ca = rows_of(v_ca)
print("   sampler-side prepared mask: ch0 mean %.3f, ch5 mean %.3f, packed min %.3f"
      % (pv_ca[0, 0].mean(), pv_ca[0, 5].mean(), packed_ca.min()))
print("   model-side denoise_mask: %s" % describe(v_ca.get("denoise_mask")))
print("   model-side rows: %s  (None == 'every row fully generates')" % describe(rows_ca))
check("4. sampler-side mask really is partly frozen (min 0.0)",
      float(packed_ca.min()) == 0.0)
check("4. model-side cond is built from channel 0 alone and reads ALL-LIVE",
      rows_ca is None and float(v_ca["denoise_mask"].min()) == 1.0,
      "model_base.py:2240 masks[0][:1, :1]; the freeze happens only in the sampler blend")

print("\n--- 5. the model-side mask is quantised to the 2x2 patch (amax)")
odd = torch.zeros(1, 1, T, H, W)
odd[..., 11:] = 1.0                      # boundary through the middle of patch column 5
_, _, v_odd = pipeline(odd)
pooled = v_odd["denoise_mask"]
live_in, live_out = int(odd.sum()), int(pooled.sum())
print("   live latent cells: input %d -> pooled %d (widened by %d)"
      % (live_in, live_out, live_out - live_in))
check("5. an odd-column seam widens the live region by one latent column",
      live_out > live_in and not torch.equal(pooled, odd),
      "%d -> %d cells, +%d" % (live_in, live_out, live_out - live_in))

print("\n--- 6. a pixel-resolution mask is RESAMPLED, not snapped")
px = torch.zeros(1, 1, T, H * 16, W * 16)
px[..., 200:] = 1.0                      # 200 is not a multiple of 16 (VAE space_down)
pv_px, packed_px, v_px = pipeline(px)
u_prep = sorted(set(pv_px.unique().tolist()))
u_tok = sorted(set(v_px["denoise_mask"].unique().tolist()))
print("   sampler-side after reshape_mask: uniq %s" % u_prep)
print("   model-side token grid:           uniq %s" % u_tok)
check("6. a binary pixel mask off the 16-px grid becomes FRACTIONAL in the sampler mask",
      len(u_prep) == 3 and 0.5 in u_prep, str(u_prep))
check("6. the model-side token grid rounds that straddled patch back up to 1.0",
      u_tok == [0.0, 1.0], str(u_tok))

print("\n--- 7. a uniform fractional mask stays one level (core collapses it to a scalar row)")
half = torch.full((1, 1, T, H, W), 0.5)
_, _, v_half = pipeline(half)
rows_half = rows_of(v_half)
print("   rows: %s" % describe(rows_half))
check("7. uniform 0.5 gives one row level, so model.py:629-630 sets a scalar segment timestep "
      "(no LongTensor mod rows) and #15988's error is uniform over the clip",
      rows_half is not None and rows_half.unique().numel() == 1
      and abs(float(rows_half.unique()[0]) - 0.5) < 1e-6, describe(rows_half))

print("\n--- 8. the audio member")
am = torch.ones(A_SHAPE)
am[..., :5] = 0.0
_, _, v_aud = pipeline(torch.ones(1, 1, T, H, W), am)
print("   cond keys with an all-live video mask: %s" % list(v_aud.keys()))
print("   audio_denoise_mask: %s" % describe(v_aud.get("audio_denoise_mask")))
check("8. an all-live video mask emits NO denoise_mask cond",
      "denoise_mask" not in v_aud, str(list(v_aud.keys())))
check("8. the audio cond is amax-pooled over channels to [1,1,2,TA]",
      tuple(v_aud["audio_denoise_mask"].shape) == (1, 1, 2, TA),
      describe(v_aud["audio_denoise_mask"]))

print("\nVERDICT: H3 wants form (b), single-channel [1, 1, T, H, W] at latent "
      "resolution, binary, 2x2-patch aligned.")
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
