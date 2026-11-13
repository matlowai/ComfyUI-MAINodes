"""MAI video output: the file plus everything the next step wants beside it.

  MAIVideoOut        frames (+audio) -> mp4 via ComfyUI's own encoder, with
                     sidecars: <prefix>.holdmap.json (the clock, when wired),
                     <prefix>.meta.json (seeds, models, steps, wall time read out
                     of the graph that ran), and an OPTIONAL draft preview
                     decoded from the LATENT through the tiny VAE (taeh3 in
                     models/vae_approx), loaded only when the toggle is on and
                     released right after. Nothing is loaded or computed unless
                     asked: the default is exactly Create Video + Save Video.
  MAILoadVideoPath   a video by path (absolute, or relative to input/) -> VIDEO.
  MAISelectEveryNth  every n-th frame from an offset -> IMAGE (exact recovery's
                     uniform cousin), replacing the last VHS node in our graphs.

Why our own: the encode is core's already; what was missing is the record
beside the render (the scorer, the deck and the clock remap all want it) and a
preview that costs nothing unless you ask for it.
"""
import json
import os
import time
from fractions import Fraction

import torch


def _graph_summary(prompt):
    """What ran, read out of the executing graph: seeds, models, LoRAs, steps.
    Best-effort; any shape of graph is fine, unknown nodes are skipped."""
    out = {"seeds": [], "models": [], "loras": [], "text_encoders": [], "vaes": [],
           "steps": [], "samplers": [], "schedulers": [], "inject": [], "hold_maps": 0}
    if not isinstance(prompt, dict):
        return out
    for nid, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ct, ins = node.get("class_type", ""), node.get("inputs", {})
        def lit(k):
            v = ins.get(k)
            return None if isinstance(v, list) else v
        if "noise_seed" in ins and lit("noise_seed") is not None:
            out["seeds"].append(lit("noise_seed"))
        if "seed" in ins and lit("seed") is not None:
            out["seeds"].append(lit("seed"))
        if ct == "UNETLoader":
            out["models"].append(lit("unet_name"))
        if ct in ("LoraLoaderModelOnly", "LoraLoader"):
            out["loras"].append({"name": lit("lora_name"), "strength": lit("strength_model")})
        if ct == "CLIPLoader":
            out["text_encoders"].append(lit("clip_name"))
        if ct == "VAELoader":
            out["vaes"].append(lit("vae_name"))
        if ct in ("BasicScheduler", "KSampler", "KSamplerAdvanced") and lit("steps") is not None:
            out["steps"].append({"node": nid, "class": ct, "steps": lit("steps"),
                                 "scheduler": lit("scheduler"), "denoise": lit("denoise")})
        if ct == "KSamplerSelect":
            out["samplers"].append(lit("sampler_name"))
        if ct == "H3InjectSchedule":
            out["inject"].append({"total_steps": lit("total_steps"), "inject": lit("inject"),
                                  "preset": lit("preset"), "scheduler": lit("scheduler")})
        if ct in ("H3JerkOracle", "H3ManualHoldMap", "H3ClockRemap", "H3DrawnPlan"):
            out["hold_maps"] += 1
    return out


def _unique(base, ext):
    path, k = f"{base}{ext}", 1
    while os.path.exists(path):
        k += 1
        path = f"{base}_{k:05d}{ext}"
    return path


class MAIVideoOut:
    DESCRIPTION = (
        "Save Video with the record beside it. Frames (+ audio) are encoded with "
        "ComfyUI's own encoder, same as Create Video + Save Video. Optional "
        "extras, each off unless wired or toggled:\n"
        "- hold_map: the clock that produced these frames, written as "
        "<prefix>.holdmap.json (H3 Load Hold Map and the deck's staircase read it)\n"
        "- meta: <prefix>.meta.json with seeds, models, LoRAs, steps and the "
        "encode time, read out of the graph that ran (plus your notes)\n"
        "- draft preview: decode the LATENT through the tiny VAE in "
        "models/vae_approx (taeh3 for H3) into <prefix>_draft.mp4. The tiny "
        "VAE is loaded when this runs and released after; with the toggle off "
        "nothing is loaded. Measured: 8-42 ms per latent frame by canvas.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 0.001}),
            "filename_prefix": ("STRING", {"default": "video/mai"}),
            "codec": (["h264", "av1"], {"default": "h264"}),
            "crf": ("INT", {"default": 18, "min": 0, "max": 51,
                    "tooltip": "constant quality; lower is better and bigger (18 is near-lossless for review)"}),
        }, "optional": {
            "audio": ("AUDIO",),
            "hold_map": ("STRING", {"default": "", "forceInput": True,
                         "tooltip": "the clock that produced these frames (H3 Time Smear hold_map_used), saved beside the file"}),
            "notes": ("STRING", {"default": "", "multiline": True,
                      "tooltip": "free text into the meta sidecar (what this arm is)"}),
            "write_meta": ("BOOLEAN", {"default": True}),
            "draft_preview": ("BOOLEAN", {"default": False,
                              "tooltip": "also decode `latent` through the tiny VAE into <prefix>_draft.mp4"}),
            "latent": ("LATENT", {"tooltip": "the sampled latent, for the draft preview only"}),
            "draft_vae_name": ("STRING", {"default": "taeh3",
                               "tooltip": "file stem under models/vae_approx used for the draft"}),
        }, "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"}}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("path", "meta_json")
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "image/minimax/video"

    def save(self, images, fps, filename_prefix, codec="h264", crf=18, audio=None, hold_map="",
             notes="", write_meta=True, draft_preview=False, latent=None, draft_vae_name="taeh3",
             prompt=None, extra_pnginfo=None):
        import folder_paths
        from comfy_api.latest import InputImpl, Types
        t0 = time.time()
        w, h = int(images.shape[2]), int(images.shape[1])
        full, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), w, h)
        file = f"{filename}_{counter:05}_.mp4"
        path = os.path.join(full, file)
        video = InputImpl.VideoFromComponents(
            Types.VideoComponents(images=images, audio=audio, frame_rate=Fraction(fps)))
        metadata = {}
        if extra_pnginfo:
            metadata.update(extra_pnginfo)
        if prompt is not None:
            metadata["prompt"] = prompt
        video.save_to(path, format=Types.VideoContainer("mp4"), codec=Types.VideoCodec(codec),
                      metadata=metadata or None, crf=crf)
        results = [{"filename": file, "subfolder": subfolder, "type": "output"}]
        base = os.path.join(full, f"{filename}_{counter:05}_")
        sidecars = {}
        if hold_map.strip():
            hp = _unique(base[:-1] + ".holdmap", ".json")   # <prefix>_00001.holdmap.json
            with open(hp, "w", encoding="utf-8") as f:
                json.dump(json.loads(hold_map), f)
            sidecars["holdmap"] = os.path.basename(hp)
        draft = None
        if draft_preview and latent is not None:
            try:
                td = time.time()
                draft = self._draft(latent, draft_vae_name, fps, base[:-1] + "_draft", full, subfolder)
                draft["seconds"] = round(time.time() - td, 2)
                results.append(draft)
            except Exception as e:                      # a preview must never cost the render
                print(f"[MAINodes] MAIVideoOut draft preview skipped: {type(e).__name__}: {e}")
        meta = {}
        if write_meta:                                  # written last, so it can name the draft
            meta = {"file": file, "frames": int(images.shape[0]), "width": w, "height": h,
                    "fps": fps, "codec": codec, "crf": crf, "audio": audio is not None,
                    "notes": notes, "encode_s": round(time.time() - t0, 2),
                    "graph": _graph_summary(prompt), "sidecars": sidecars,
                    "draft": (draft["filename"] if draft else None),
                    "draft_s": (draft["seconds"] if draft else None),
                    "written": time.strftime("%Y-%m-%dT%H:%M:%S")}
            mp = _unique(base[:-1] + ".meta", ".json")
            with open(mp, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=1)
        print(f"[MAINodes] MAIVideoOut -> {path}" + (f" (+{', '.join(sidecars.values())})" if sidecars else ""))
        return {"ui": {"images": results, "animated": (True,)},
                "result": (path, json.dumps(meta))}

    @staticmethod
    def _draft(latent, vae_stem, fps, draft_base, full, subfolder):
        """Decode through the tiny VAE in models/vae_approx, loaded for this call only."""
        import folder_paths
        import comfy.utils
        import comfy.model_management as mm
        from comfy.sd import VAE
        from comfy_api.latest import InputImpl, Types
        name = next((f for f in folder_paths.get_filename_list("vae_approx") if f.startswith(vae_stem)), None)
        if name is None:
            raise FileNotFoundError(f"no {vae_stem}* in models/vae_approx")
        t0 = time.time()
        tae = VAE(comfy.utils.load_torch_file(folder_paths.get_full_path("vae_approx", name)))
        try:
            if hasattr(tae.first_stage_model, "show_progress_bar"):
                tae.first_stage_model.show_progress_bar = False
            z = latent["samples"]
            if hasattr(z, "is_nested") and z.is_nested:
                z = z.tensors[0]
            frames = tae.decode(z)                       # (T, H, W, 3) in [0, 1]
            if frames.ndim == 5:
                frames = frames.reshape(-1, *frames.shape[-3:])
            frames = frames.clamp(0, 1).cpu()
        finally:
            del tae
            mm.soft_empty_cache()
        video = InputImpl.VideoFromComponents(
            Types.VideoComponents(images=frames, audio=None, frame_rate=Fraction(fps)))
        out = _unique(draft_base, ".mp4")
        video.save_to(out, format=Types.VideoContainer("mp4"), codec=Types.VideoCodec("h264"), crf=23)
        print(f"[MAINodes] MAIVideoOut draft: {frames.shape[0]} frames through {name} in {time.time() - t0:.1f} s -> {out}")
        return {"filename": os.path.basename(out), "subfolder": subfolder, "type": "output"}


class MAILoadVideoPath:
    DESCRIPTION = ("A video by path: absolute, or relative to the input directory. "
                   "Outputs ComfyUI's VIDEO type (feed Get Video Components for frames "
                   "and audio), plus the frame count and fps it reports.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"path": ("STRING", {"default": "clip.mp4"})}}

    RETURN_TYPES = ("VIDEO", "INT", "FLOAT")
    RETURN_NAMES = ("video", "frames", "fps")
    FUNCTION = "load"
    CATEGORY = "image/minimax/video"

    @classmethod
    def IS_CHANGED(cls, path):
        p = cls._resolve(path)
        return f"{p}:{os.path.getmtime(p) if os.path.exists(p) else 0}"

    @staticmethod
    def _resolve(path):
        import folder_paths
        return path if os.path.isabs(path) else os.path.join(folder_paths.get_input_directory(), path)

    def load(self, path):
        from comfy_api.latest import InputImpl
        p = self._resolve(path)
        if not os.path.exists(p):
            raise FileNotFoundError(p)
        v = InputImpl.VideoFromFile(p)
        comp = v.get_components()
        return (v, int(comp.images.shape[0]), float(comp.frame_rate))


class MAISelectEveryNth:
    DESCRIPTION = ("Every n-th frame starting at an offset (the uniform recover). For a "
                   "smear with a hold map use H3 Exact Recover instead: it is exact.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "every": ("INT", {"default": 4, "min": 1, "max": 256}),
            "offset": ("INT", {"default": 0, "min": 0, "max": 100000}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "select"
    CATEGORY = "image/minimax/video"

    def select(self, images, every, offset):
        return (images[offset::every].cpu(),)


NODE_CLASS_MAPPINGS = {"MAIVideoOut": MAIVideoOut, "MAILoadVideoPath": MAILoadVideoPath,
                       "MAISelectEveryNth": MAISelectEveryNth}
NODE_DISPLAY_NAME_MAPPINGS = {"MAIVideoOut": "MAI Video Out (file + sidecars + draft preview)",
                              "MAILoadVideoPath": "MAI Load Video (path)",
                              "MAISelectEveryNth": "MAI Select Every Nth"}
