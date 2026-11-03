"""H3TimeSmear pads to the grid carried in a remapped hold map, and H3ExactRecover inverts it."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import torch
import motion as M
import derope_any


def test_smear_pads_to_ltx_grid_and_recovers_exactly():
    n = 20
    frames = torch.arange(n, dtype=torch.float32).view(n, 1, 1, 1).expand(n, 4, 4, 3).contiguous()
    hm = json.dumps({"holds": [1] * 4 + [4] * 10 + [1] * 6, "world_len": n})
    remapped, length, _, _ = derope_any.H3ClockRemap().remap(hm, "ltx-2.5")
    imgs, used, total, report = M.H3TimeSmear().smear(frames, 4, hold_map=remapped, expand_to_end=False, fps=25)
    assert total == length and (total - 1) % 8 == 0 and imgs.shape[0] == total
    u = json.loads(used)
    assert u["legal"] == [8, 1] and sum(u["holds"]) == total
    rec = M.H3ExactRecover().recover(imgs, used)[0]
    assert rec.shape[0] == n and torch.equal(rec[:, 0, 0, 0], torch.arange(n, dtype=torch.float32))


def test_plain_map_still_pads_to_h3_grid():
    n = 12
    frames = torch.zeros(n, 2, 2, 3)
    hm = json.dumps({"holds": [1] * 4 + [4] * 8, "world_len": n})
    _, used, total, _ = M.H3TimeSmear().smear(frames, 4, hold_map=hm, expand_to_end=False)
    assert (total - 5) % 17 == 0 and "legal" not in json.loads(used)


def test_camera_compensated_mode_ignores_a_pure_pan():
    # a texture that only translates frame to frame: the plain |d3| profile sees
    # motion everywhere, the compensated one sees (almost) nothing
    torch.manual_seed(0)
    base = torch.rand(1, 24, 1, 16, 16)
    frames = [torch.roll(base, shifts=(0, t), dims=(3, 4)) for t in range(12)]
    z = torch.cat(frames, dim=2)
    plain = M._jerk_profile(z, "value |d3| (default)", phase_norm=False)
    comp = M._jerk_profile(z, "value |d3| camera-compensated", phase_norm=False)
    assert comp.mean() < 0.05 * plain.mean()


def test_oracle_reads_an_ltx_latent_through_the_profile():
    # 97 frames on LTX's 1+8k clock = 13 latent positions; a burst in the middle
    torch.manual_seed(1)
    z = torch.zeros(1, 128, 13, 8, 8)
    z[:, :, 5:8] = torch.randn(1, 128, 3, 8, 8) * 5        # tokens 5-7 jerk
    z += torch.randn_like(z) * 0.01
    hm, segs, w0, wlen, prof, rep = M.H3JerkOracle().read({"samples": z}, 97, 0.75, 4, True,
                                                            model_profile="ltx-2.5")
    d = json.loads(hm)
    assert d["world_len"] == 97 and len(d["holds"]) == 97 and d["oracle_latent"] == "ltx-2.5"
    holds = d["holds"]
    # holds are per SOURCE frame and follow the 1+8k clock: frame 0 alone, then 8-frame blocks
    assert max(holds) == 4 and holds[0] == 1
    for t in range(1, 13):
        blk = holds[1 + (t - 1) * 8: 1 + t * 8]
        assert len(set(blk)) == 1, (t, blk)                  # one hold per latent token
    assert (wlen - 1) % 8 == 0 and w0 >= 0
    # the wrong frame count is refused loudly, never silently misaligned
    try:
        M.H3JerkOracle().read({"samples": z}, 124, 0.75, 4, True, model_profile="ltx-2.5")
    except ValueError as e:
        assert "latent time positions" in str(e)
    else:
        raise AssertionError("expected a length mismatch error")


def test_h3_oracle_path_is_unchanged_by_default():
    torch.manual_seed(2)
    z = torch.randn(1, 24, 32, 4, 4)                          # 107 frames -> 32 tokens
    a = M.H3JerkOracle().read({"samples": z}, 107, 0.75, 4, True)
    b = M.H3JerkOracle().read({"samples": z}, 107, 0.75, 4, True, model_profile="minimax-h3")
    assert a[0] == b[0] and "oracle_latent" not in json.loads(a[0])


def test_manual_hold_map_passes_the_oracle_through_when_nothing_is_typed():
    torch.manual_seed(3)
    z = torch.zeros(1, 24, 32, 4, 4)
    z[:, :, 10:16] = torch.randn(1, 24, 6, 4, 4) * 5
    z += torch.randn_like(z) * 0.01
    oracle_map = M.H3JerkOracle().read({"samples": z}, 107, 0.75, 4, True)[0]
    node = M.H3ManualHoldMap()
    through, segs, rep = node.build(107, 24, "", 4, True, 8, oracle_hold_map=oracle_map)
    assert json.loads(through)["holds"] == json.loads(oracle_map)["holds"] and "passed through" in rep
    gated, _, _ = node.build(107, 24, "0-20", 4, True, 8, oracle_hold_map=oracle_map)
    g = json.loads(gated)["holds"]
    assert max(g[40:]) == 1                     # outside the range the oracle is gated off
    try:
        node.build(107, 24, "", 4, True, 8)      # no oracle, nothing typed: still an error
    except AssertionError as e:
        assert "wire the oracle" in str(e)
    else:
        raise AssertionError("expected an assertion")


def test_oracle_routes_unknown_profile_to_h3():
    torch.manual_seed(4)
    z = torch.randn(1, 24, 32, 4, 4)
    a = M.H3JerkOracle().read({"samples": z}, 107, 0.75, 4, True)
    for bad in (0, "0", "", "no-such-model"):
        b = M.H3JerkOracle().read({"samples": z}, 107, 0.75, 4, True, model_profile=bad)
        assert b[0] == a[0], bad
    assert M.H3JerkOracle.VALIDATE_INPUTS(model_profile=0) is True


if __name__ == "__main__":          # house style: python tests/<file>.py
    import inspect
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and inspect.isfunction(v)]
    for fn in fns:
        if "tmp_path" in inspect.signature(fn).parameters:
            import tempfile, pathlib
            fn(pathlib.Path(tempfile.mkdtemp()))
        else:
            fn()
        print("ok ", fn.__name__)
    print(f"{len(fns)} passed")
