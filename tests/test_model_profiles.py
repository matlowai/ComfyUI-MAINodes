"""model_profiles + H3ClockRemap: the grid law as data. Pure python."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import model_profiles as mp
import derope_any


def test_h3_profile_is_identity():
    p = mp.load_profiles()["minimax-h3"]
    holds = [1, 1, 2, 3, 4, 4, 3, 2, 1]
    assert mp.remap_holds(holds, p) == holds
    out, total, pad = mp.pad_to_legal(holds, p["legal"])
    assert (total - 5) % 17 == 0 and total >= sum(holds) and out[-1] == holds[-1] + pad


def test_ltx_scaling_fills_whole_blocks():
    p = mp.load_profiles()["ltx-2.5"]
    assert mp.remap_holds([1, 2, 3, 4], p) == [1, 8, 16, 16]   # 3*4=12 -> 2 blocks
    out, total, pad = mp.pad_to_legal(mp.remap_holds([1] * 10 + [4] * 40 + [1] * 7, p), p["legal"])
    assert (total - 1) % 8 == 0 and pad < 8
    assert mp.windows_needed(total, p) == 1               # 657 frames < 960 (20 s at 48 fps)
    assert mp.windows_needed(2000, p) == 3


def test_legal_ceil_rules():
    assert mp.legal_ceil(124, (17, 5)) == 124 and mp.legal_ceil(125, (17, 5)) == 141
    assert mp.legal_ceil(912, (8, 1)) == 913
    assert mp.legal_ceil(913, (8, 1)) == 913
    assert mp.legal_ceil(50, (4, 1)) == 53


def test_user_registry_overrides_and_adds(tmp_path):
    reg = tmp_path / "mainodes_models.json"
    reg.write_text(json.dumps({
        "ltx-2.5": {"name": "LTX-2.5 (mine)", "block": 8, "hold_scale": 2, "legal": [8, 1], "fps": 25, "measured": True},
        "my-model": {"block": 4, "hold_scale": 3, "legal": [4, 1], "fps": 16},
    }))
    profiles = mp.load_profiles(str(reg))
    assert profiles["ltx-2.5"]["hold_scale"] == 2 and profiles["ltx-2.5"]["name"] == "LTX-2.5 (mine)"
    assert profiles["my-model"]["measured"] is False and profiles["my-model"]["fps"] == 16.0
    assert "minimax-h3" in profiles


def test_broken_registry_does_not_raise(tmp_path):
    reg = tmp_path / "mainodes_models.json"
    reg.write_text("{not json")
    assert "ltx-2.5" in mp.load_profiles(str(reg))


def test_clock_remap_node_carries_grid_and_reports_unmeasured():
    node = derope_any.H3ClockRemap()
    hm = json.dumps({"holds": [1, 1, 4, 4, 4, 2, 1], "world_len": 7})
    out, length, rep, prof = node.remap(hm, "ltx-2.5")
    o = json.loads(out)
    assert o["legal"] == [8, 1] and o["profile"] == "ltx-2.5" and o["source_holds"][2] == 4
    ident = json.loads(node.remap(hm, "minimax-h3")[0])
    assert ident["holds"] == json.loads(hm)["holds"]                  # exact identity, no pad
    assert sum(o["holds"]) <= length and (length - 1) % 8 == 0 and length - sum(o["holds"]) < 8
    assert "UNMEASURED" not in rep
    out2, length2, rep2, _ = node.remap(hm, derope_any.CUSTOM, custom_block=4, custom_hold_scale=2,
                                        custom_legal_step=4, custom_legal_offset=1, custom_fps=16.0)
    assert "UNMEASURED" in rep2 and (length2 - 1) % 4 == 0
    _, _, rep3, _ = node.remap(hm, "wan-2.2 (unmeasured)")
    assert "UNMEASURED" in rep3


def test_unknown_profile_is_loud():
    node = derope_any.H3ClockRemap()
    try:
        node.remap(json.dumps({"holds": [1, 4], "world_len": 2}), "no-such-model")
    except ValueError as e:
        assert "no-such-model" in str(e)
    else:
        raise AssertionError("expected ValueError")



def test_sidecar_round_trip(tmp_path):
    # folder_paths is ComfyUI's; stub just the output directory for the two nodes
    import types
    fp = types.ModuleType("folder_paths")
    fp.get_output_directory = lambda: str(tmp_path)
    sys.modules["folder_paths"] = fp
    try:
        src = json.dumps({"holds": [1, 1, 4, 4, 2, 1], "world_len": 6})
        remapped, _, _, _ = derope_any.H3ClockRemap().remap(src, "ltx-2.5")
        res = derope_any.H3SaveHoldMap().save(remapped, "video/arm")
        path = res["result"][0]
        assert os.path.exists(path) and path.endswith("arm.holdmap.json")
        res2 = derope_any.H3SaveHoldMap().save(remapped, "video/arm")       # never overwrites
        assert res2["result"][0] != path
        hm, n, used = derope_any.H3LoadHoldMap().load("video/arm")
        assert used == res2["result"][0]                                     # newest wins
        got = json.loads(hm)
        assert got["holds"] == [1, 1, 4, 4, 2, 1] and n == 6 and "legal" not in got   # the ORIGINAL clock travels
        hm2, _, _ = derope_any.H3LoadHoldMap().load(path)
        assert json.loads(hm2)["holds"] == [1, 1, 4, 4, 2, 1]
        hm3, n3, _ = derope_any.H3LoadHoldMap().load(path, start=2, length=3)
        assert json.loads(hm3)["holds"] == [4, 4, 2] and n3 == 3 and json.loads(hm3)["window"] == [2, 5]
    finally:
        del sys.modules["folder_paths"]


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
