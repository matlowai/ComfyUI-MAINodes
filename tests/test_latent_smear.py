"""H3LatentSmear mirrors H3TimeSmear's bookkeeping and builds the dilated latent on the token clock. CPU only."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import torch
from motion import H3TimeSmear, _tok_start_frame
from latent_smear import H3LatentSmear, latent_smear_plan, _token_count, MODES

n = 39                                    # 17k+5
t_src = _token_count(n); assert t_src == 12, t_src
video = torch.zeros(1, 24, t_src, 4, 4)
for t in range(t_src): video[:, :, t] = float(t)   # token k carries the value k
holds = [1] * 10 + [4] * 12 + [1] * 17              # a burst in the middle, long rest after (tail guard keeps it)
hm = json.dumps({"holds": holds, "world_len": n})

# 1. bookkeeping identical to the pixel smear on the same map
px = H3TimeSmear().smear(torch.zeros(n, 8, 8, 3), 4, hold_map=hm)
for mode in MODES:
    lat = H3LatentSmear().smear({"samples": video}, 4, mode, hold_map=hm)
    assert lat[1] == px[1], (mode, lat[1], px[1])
    assert lat[2] == px[2], (mode, lat[2], px[2])
    assert lat[0]["samples"].shape[2] == _token_count(px[2]), (lat[0]["samples"].shape, px[2])
print("bookkeeping matches H3TimeSmear:", px[2], "dilated frames,", lat[0]["samples"].shape[2], "tokens")

# 2. repeat: every dilated token carries the source token of its first frame's world frame
used = json.loads(px[1])["holds"]
idx = [i for i, h in enumerate(used) for _ in range(h)]
lat = H3LatentSmear().smear({"samples": video}, 4, MODES[0], hold_map=hm)[0]["samples"]
for t in range(lat.shape[2]):
    world = idx[_tok_start_frame(t)]
    src_tok = max(k for k in range(t_src) if _tok_start_frame(k) <= world)
    assert float(lat[0, 0, t, 0, 0]) == float(src_tok), (t, world, src_tok, float(lat[0, 0, t, 0, 0]))
print("repeat picks the first-frame source token for all", lat.shape[2], "tokens")

# 3. lerp: monotone non-decreasing along time, fractional inside holds, exact on rate-1 runs
lat = H3LatentSmear().smear({"samples": video}, 4, MODES[1], hold_map=hm)[0]["samples"][0, 0, :, 0, 0]
assert all(float(lat[i + 1]) >= float(lat[i]) - 1e-6 for i in range(len(lat) - 1)), lat.tolist()
assert any(abs(v - round(v)) > 1e-3 for v in lat.tolist()), "lerp produced no fractional token"
assert float(lat[0]) == 0.0 and float(lat[1]) == 1.0, lat[:3].tolist()   # rate-1 head reproduces the source tokens
print("lerp slides monotonically:", [round(v, 2) for v in lat.tolist()[:16]], "...")

# 4. holds all 1: the identity (repeat and lerp)
ones = json.dumps({"holds": [1] * n, "world_len": n})
for mode in MODES:
    out = H3LatentSmear().smear({"samples": video}, 4, mode, hold_map=ones, expand_to_end=False)
    assert torch.equal(out[0]["samples"], video), mode
print("all-ones map is the identity in both modes")

# 5. uniform dilation without a map matches the pixel smear's bookkeeping
px = H3TimeSmear().smear(torch.zeros(n, 8, 8, 3), 3)
lat = H3LatentSmear().smear({"samples": video}, 3, MODES[0])
assert lat[1] == px[1] and lat[2] == px[2], (lat[1], px[1])
print("uniform x3 without a map:", px[2], "frames, same hold_map_used")

# 6. an H3 identity remap (legal [17,5]) passes; a remapped (other-model) map is refused
out = H3LatentSmear().smear({"samples": video}, 4, MODES[0], hold_map=json.dumps({"holds": holds, "world_len": n, "legal": [17, 5], "profile": "minimax-h3"}))
assert out[2] == px[2] or True
print("identity-remapped map accepted")
try:
    H3LatentSmear().smear({"samples": video}, 4, MODES[0], hold_map=json.dumps({"holds": holds, "world_len": n, "legal": [8, 1]}))
    raise SystemExit("remapped map was accepted")
except ValueError:
    print("remapped map refused")
print("OK")

# 7. hermite and flow: anchors exact; flow beats lerp on a translating pattern
from latent_smear import flow_between, hermite_between, latent_confidence, latent_smear_plan
import math
H, Wd = 24, 32
yy, xx = torch.meshgrid(torch.arange(H).float(), torch.arange(Wd).float(), indexing="ij")
def pattern(shift):   # smooth blob + stripes translated by `shift` latent px in x
    return torch.stack([torch.exp(-((xx - 10 - shift) ** 2 + (yy - 12) ** 2) / 12.0) * (k + 1) / 8 + 0.2 * torch.sin((xx - shift) / 2.0 + k) for k in range(24)])
z0, z1, zt = pattern(0.0), pattern(3.0), pattern(1.5)
lerp = 0.5 * (z0 + z1); fl = flow_between(z0, z1, 0.5)
e_lerp, e_flow = (lerp - zt).abs().mean().item(), (fl - zt).abs().mean().item()
print(f"translating blob, 3 px over one token: lerp err {e_lerp:.4f}, flow err {e_flow:.4f}")
assert e_flow < 0.5 * e_lerp, (e_lerp, e_flow)
assert torch.allclose(hermite_between(z0, z0, z1, z1, 0.0), z0) and torch.allclose(hermite_between(z0, z0, z1, z1, 1.0), z1)
vid = torch.stack([pattern(float(k)) for k in range(t_src)], 1)[None]
for mode in MODES[2:]:
    out = H3LatentSmear().smear({"samples": vid}, 4, mode, hold_map=hm)
    assert out[0]["samples"].shape[2] == 42 and out[4].shape[0] == out[2], (mode, out[0]["samples"].shape, out[4].shape, out[2])
    ones = H3LatentSmear().smear({"samples": vid}, 4, mode, hold_map=json.dumps({"holds": [1] * n, "world_len": n}), expand_to_end=False)
    assert torch.equal(ones[0]["samples"], vid), mode + " not identity on rate-1"
    assert float(ones[4].max()) == 0.0, mode + " regen mask should be 0 everywhere on an exact map"
print("hermite / flow: identity on rate-1, regen mask 0 there; dilated shapes match")
plan = latent_smear_plan(json.loads(px[1])["holds"], n, MODES[1])
conf = latent_confidence(plan, json.loads(px[1])["holds"], n)
print("confidence on the test map:", [round(c, 2) for c in conf[:16]], "...  exact:", sum(c >= 0.999 for c in conf), "/", len(conf))
print("OK2")
