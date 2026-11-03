"""MAIVideoOut: the file, the sidecars, the meta, the every-nth. No GPU; encode via av."""
import json, os, sys, types
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.environ.get("COMFYUI_DIR", "/mnt/work/ai/apps/ComfyUI"))
import torch


def _stub_folder_paths(tmp):
    fp = types.ModuleType("folder_paths")
    fp.get_output_directory = lambda: tmp
    fp.get_input_directory = lambda: tmp
    fp.get_filename_list = lambda kind: []
    def gsip(prefix, out, w, h):
        sub, name = os.path.split(prefix)
        full = os.path.join(out, sub)
        os.makedirs(full, exist_ok=True)
        return full, name, 1, sub, prefix
    fp.get_save_image_path = gsip
    sys.modules["folder_paths"] = fp


def test_video_out_writes_file_and_sidecars(tmp_path):
    _stub_folder_paths(str(tmp_path))
    try:
        import video_out
        n = 6
        frames = torch.rand(n, 16, 16, 3)
        hm = json.dumps({"holds": [1, 2, 2, 1, 1, 1], "world_len": n})
        prompt = {"9": {"class_type": "RandomNoise", "inputs": {"noise_seed": 7}},
                  "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "m.safetensors"}},
                  "8": {"class_type": "BasicScheduler", "inputs": {"steps": 12, "scheduler": "simple", "denoise": 1.0}}}
        res = video_out.MAIVideoOut().save(frames, 24.0, "video/arm", hold_map=hm, notes="hello",
                                           prompt=prompt)
        path, meta_json = res["result"]
        assert os.path.exists(path) and path.endswith("arm_00001_.mp4")
        meta = json.loads(meta_json)
        assert meta["frames"] == n and meta["graph"]["seeds"] == [7] and meta["graph"]["steps"][0]["steps"] == 12
        assert meta["notes"] == "hello" and "holdmap" in meta["sidecars"]
        side = os.path.join(os.path.dirname(path), meta["sidecars"]["holdmap"])
        assert json.load(open(side))["holds"] == [1, 2, 2, 1, 1, 1]
        assert os.path.exists(path[:-4] + ".meta.json") or any(f.endswith(".meta.json") for f in os.listdir(os.path.dirname(path)))
        assert res["ui"]["images"][0]["filename"].endswith(".mp4")
        # draft preview with no tiny VAE on disk must not break the save
        res2 = video_out.MAIVideoOut().save(frames, 24.0, "video/arm2", draft_preview=True, latent={"samples": torch.zeros(1, 24, 2, 1, 1)})
        assert os.path.exists(res2["result"][0])
        sel = video_out.MAISelectEveryNth().select(frames, 2, 1)[0]
        assert sel.shape[0] == 3 and torch.equal(sel[0], frames[1])
    finally:
        sys.modules.pop("folder_paths", None)
        sys.modules.pop("video_out", None)


if __name__ == "__main__":
    import tempfile, pathlib
    test_video_out_writes_file_and_sidecars(pathlib.Path(tempfile.mkdtemp()))
    print("ok  test_video_out_writes_file_and_sidecars\n1 passed")
