"""Classic ComfyUI nodes for the native LightX2V RelayVSR runtime.

The native VIDEO API is imported lazily. No ComfyUI-level monkeypatches, no weight parsing,
no inline LightX2V installation at Comfy startup.
"""
from __future__ import annotations

from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import time
from typing import Any

from .bridge import QUANT_WAN, Settings, VARIANTS, MODES, comfy_root, find_root, find_weights, output_dir, temp_dir, process_video, make_preview
from .relay_looping.spec import LoopSpec, StageSpec


def _video_from_file(filename: Path):
    try:
        from comfy_api.latest import InputImpl
        return InputImpl.VideoFromFile(str(filename))
    except ImportError:
        try:
            from comfy_api.input_impl import VideoFromFile
            return VideoFromFile(str(filename))
        except ImportError as exc:
            raise RuntimeError("ComfyUI VIDEO API is required for RelayVSR's VIDEO output. Update ComfyUI or use the returned file path directly.") from exc


def _video_input_to_path(video: Any) -> tuple[Path, Path | None]:
    if isinstance(video, dict) and "input_path" in video:
        p = Path(str(video["input_path"])).expanduser().resolve()
        return p, None
    if isinstance(video, (str, os.PathLike)):
        p = Path(video).expanduser()
        if not p.is_absolute():
            p = comfy_root() / p
        return p.resolve(), None
    if not hasattr(video, "get_stream_source"):
        raise TypeError("Expected native VIDEO (from ComfyUI Load Video) or use RelayVSR Upscale File Path")
    source = video.get_stream_source()
    start, duration = 0.0, 0.0
    if hasattr(video, "get_active_trim_window"):
        start, duration = video.get_active_trim_window()
    # Avoid recompressing untrimmed videos. Preserve original temporal sequence and audio.
    # VIDEO is not simply a filename: it can be trimmed or cropped.
    # Pass a source through without re-encoding only for an untouched VideoFromFile.
    fast_path = (
        isinstance(source, (str, os.PathLike))
        and type(video).__name__ == "VideoFromFile"
        and not (float(start or 0) or float(duration or 0))
    )
    if fast_path:
        try:
            import av
            with av.open(str(source), mode="r") as container:
                frame_stream = container.streams.video[0]
                raw_size = (int(frame_stream.width), int(frame_stream.height))
            fast_path = tuple(video.get_dimensions()) == raw_size
        except (ImportError, AttributeError, IndexError):
            fast_path = False
    if fast_path:
        return Path(source).expanduser().resolve(), None
    if not hasattr(video, "save_to"):
        raise TypeError("VIDEO has no save_to method for trimming or in-memory content")
    tmp = temp_dir()
    tmp.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="relayvsr_input_", suffix=".mp4", dir=tmp, delete=False) as f:
        path = Path(f.name)
    try:
        video.save_to(str(path))
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError("VIDEO.save_to did not produce a valid input file")
        return path, path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _interrupt():
    # This is the *check* API. nodes.interrupt_processing is not a check!
    try:
        import comfy.model_management as mm
        mm.throw_exception_if_processing_interrupted()
    except ImportError:
        pass


def _prepare_gpu(unload: bool):
    if not unload:
        return
    try:
        import comfy.model_management as mm
        mm.unload_all_models()
        mm.soft_empty_cache()
    except ImportError:
        pass


def _run_video(path: Path, config: dict, output_subfolder: str, filename_prefix: str, seed: int):
    s = Settings(**config)
    _prepare_gpu(s.unload_comfy_models)
    dst, stats = process_video(path, s, output_subfolder=output_subfolder,
                               filename_prefix=filename_prefix, seed=seed,
                               check_interrupt=_interrupt)
    return dst, stats


class RelayVSRBlockLoopLab:
    """Advanced experimental controls. This node does not load the model itself."""
    CATEGORY = "RelayVSR/Research"
    FUNCTION = "configuration"
    RETURN_TYPES = ("RELAYVSR_LOOP_SETTINGS",)
    RETURN_NAMES = ("loop_experiment",)
    DESCRIPTION = ("OFF is identical to normal RelayVSR. DISCOVER logs actual torch ModuleList block containers. "
                   "EXPERIMENT repeats selected blocks inside an isolated LightX2V worker. "
                   "For real models this is experimental and can alter temporal caches.")

    @classmethod
    def INPUT_TYPES(cls):
        presets = ["custom", *sorted(p.stem for p in (Path(__file__).parent / "presets").glob("*.json"))]
        return {"required": {
            "preset": (presets, {"default": "custom", "tooltip": "A named preset overrides the custom controls below; presets are hypotheses, NOT verified improvements."}),
            "mode": (["off", "discover", "experiment"], {"default": "discover"}),
            "wan_indices": ("STRING", {"default": "first:4", "tooltip": "0-based: 4-9, 1,3,7-9, first:4, middle:6, last:4, all"}),
            "wan_passes": ("INT", {"default": 1, "min": 1, "max": 4}),
            "wan_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
            "wan_mixing": (["final_blend", "damped_steps"], {"default": "final_blend"}),
            "wan_loop_style": (["group", "per_block"], {"default": "group"}),
            "wan_owner_regex": ("STRING", {"default": "", "tooltip": "Leave blank for automatic 'wan' match; set from DISCOVER report if needed"}),
            "flash_indices": ("STRING", {"default": "middle:4"}),
            "flash_passes": ("INT", {"default": 1, "min": 1, "max": 4}),
            "flash_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
            "flash_mixing": (["final_blend", "damped_steps"], {"default": "final_blend"}),
            "flash_loop_style": (["group", "per_block"], {"default": "group"}),
            "flash_owner_regex": ("STRING", {"default": "", "tooltip": "Leave blank for automatic 'flash' match; set from DISCOVER report if needed"}),
            "allow_stateful_repeats": ("BOOLEAN", {"default": False, "tooltip": "Risk acknowledgment: repeated forward may mutate persistent KV cache; benchmark for artifacts."}),
            "allow_advanced_modes": ("BOOLEAN", {"default": False, "tooltip": "Experimental: only enable offload / two-GPU after separately verifying worker hooks."}),
            "advanced_json": ("STRING", {"default": "{}", "multiline": True,
                "tooltip": "JSON overrides applied AFTER presets or custom controls, e.g. {\"wan\":{\"strength\":0.5,\"every_nth_call\":2}}"}),
        }}

    def configuration(self, preset, mode, wan_indices, wan_passes, wan_strength, wan_mixing, wan_loop_style, wan_owner_regex,
                      flash_indices, flash_passes, flash_strength, flash_mixing, flash_loop_style, flash_owner_regex,
                      allow_stateful_repeats, allow_advanced_modes, advanced_json):
        if preset != "custom":
            path = Path(__file__).parent / "presets" / (preset + ".json")
            if not path.is_file() or not path.resolve().is_relative_to((Path(__file__).parent / "presets").resolve()):
                raise FileNotFoundError("Unknown bundled loop preset: " + preset)
            spec = json.loads(path.read_text(encoding="utf8"))
        else:
            spec = {"mode": mode, "wan": {"indices": wan_indices, "passes": wan_passes,
                    "strength": wan_strength, "mixing": wan_mixing, "loop_style": wan_loop_style, "owner_regex": wan_owner_regex},
                    "flash": {"indices": flash_indices, "passes": flash_passes,
                    "strength": flash_strength, "mixing": flash_mixing, "loop_style": flash_loop_style, "owner_regex": flash_owner_regex},
                    "allow_stateful_repeats": allow_stateful_repeats,
                    "allow_advanced_modes": allow_advanced_modes}
        # Advanced JSON intentionally applies to EITHER a built-in preset or
        # custom slider settings. Agents can tune presets without editing them.
        additional = json.loads(advanced_json or "{}")
        if not isinstance(additional, dict):
            raise ValueError("advanced_json must be a JSON object")
        for key, value in additional.items():
            if key in ("wan", "flash") and isinstance(value, dict):
                spec[key] = {**spec.get(key, {}), **value}
            else:
                spec[key] = value
        return (LoopSpec.from_value(spec).as_dict(),)


# Measured on five 3 s H3 clips, X4 model at 2x output (study 2026-11-02-relayvsr): back-projection 1.0 was the biggest
# single gain (+2.6 dB PSNR, -20 % flicker, seed-checked); residual gain and the bilinear resize trade texture for calm.
FLASH_LATE_HALF = {"indices": "last:4", "passes": 2, "strength": 0.5}
QUALITY_PRESETS = {
    "faithful: back-projection + residual 0.85": {"back_projection": 1.0, "residual_gain": 0.85},
    "faithful + Flash loop": {"back_projection": 1.0, "flash": FLASH_LATE_HALF},
    "smooth: every knob (calmest, least texture)": {"back_projection": 1.0, "residual_gain": 0.85, "downscale": "bilinear",
                                                    "flash": FLASH_LATE_HALF},
    "stock (the model as shipped)": {},
    "custom (use the knobs below)": None,
}


# Measured at 1280x704 -> 2560x1408 (X4, faithful), one RTX 5090 with a PyTorch memory cap: the 16 GB tiers ran
# under 13.5 / 13.0 GiB with no offload; drift vs the bf16 output 53 dB (24 GB), 47 dB (W6A8), 44 dB (W4A8).
VRAM_TIERS = {
    "auto (pick by GPU memory)": None,
    "24 GB+: int8 ConvRot weights + int8 KV (fastest)": {"weights": "int8_convrot", "kv_cache": "int8_rot"},
    "16 GB: W6A8 weights + int4 KV": {"weights": "w6a8", "kv_cache": "int4_rot"},
    "16 GB, most headroom: W4A8 weights + int4 KV": {"weights": "w4a8", "kv_cache": "int4_rot"},
    "full precision: bf16 weights + bf16 KV": {},
}


def gpu_memory_gib(gpu_ids):
    """Total memory of the first physical GPU in gpu_ids, or None when nvidia-smi can't tell."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits", "-i", gpu_ids.split(",")[0].strip()],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        return float(out.split()[0]) / 1024
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def present_quants(lightx2v_root, model_dir, variant):
    """Weight modes whose pre-quantized wan_<mode>.safetensors sits next to flash.safetensors."""
    try:
        root = find_root(lightx2v_root)
    except FileNotFoundError:
        root = Path(".")
    found = set()
    for mode in QUANT_WAN:
        try:
            find_weights(root, model_dir, variant, f"wan_{mode}.safetensors")
            found.add(mode)
        except FileNotFoundError:
            pass
    return found


def vram_knobs(tier, execution_mode, gpu_ids, present=()):
    """The weights / kv_cache knobs for a VRAM tier. auto takes the best tier the card fits whose quantized Wan file is
    present (`present`), else the card's tier (quantized on load). Quantized weights stay resident, so they apply on a
    single GPU only; with Wan block offload only the KV cache is quantized; two GPUs (SP) stay bf16 (not measured)."""
    knobs = VRAM_TIERS[tier]
    if knobs is None:  # unknown memory -> the 16 GB tiers, which also run on bigger cards
        total = gpu_memory_gib(gpu_ids)
        fitting = ["16 GB: W6A8 weights + int4 KV", "16 GB, most headroom: W4A8 weights + int4 KV"]
        if total is not None and total >= 22:
            fitting.insert(0, "24 GB+: int8 ConvRot weights + int8 KV (fastest)")
        elif total is not None and total < 15:
            fitting = fitting[1:]
        knobs = VRAM_TIERS[next((name for name in fitting if VRAM_TIERS[name]["weights"] in present), fitting[0])]
    if execution_mode == "Wan block offload":
        return {k: v for k, v in knobs.items() if k == "kv_cache"}
    return dict(knobs) if execution_mode == "single GPU" else {}


def quality_spec(loop_experiment, preset, back_projection, residual_gain, downscale, extra=None):
    """The worker's loop spec: a connected Lab node's spec with the quality preset's (or the custom knobs') values
    and the VRAM tier's knobs (`extra`) on top."""
    knobs = QUALITY_PRESETS[preset]
    if knobs is None:
        knobs = {"back_projection": back_projection, "residual_gain": residual_gain, "downscale": downscale}
    knobs = {**knobs, **(extra or {})}
    spec = LoopSpec.from_value(loop_experiment).as_dict() if loop_experiment is not None else LoopSpec().as_dict()
    stock = LoopSpec()
    changed = {k: v for k, v in knobs.items() if k == "flash" or v != getattr(stock, k)}
    if not changed:
        return LoopSpec.from_value(spec).as_dict() if loop_experiment is not None else None
    for key, value in changed.items():
        spec[key] = {**spec[key], **value} if key == "flash" else value
    spec["mode"] = "experiment"
    return LoopSpec.from_value(spec).as_dict()


class RelayVSRModelSettings:
    """Lightweight settings token; actual checkpoints load in the isolated worker."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "variant": (list(VARIANTS), {"default": "X4 original (recommended, also for 2x)"}),
            "lightx2v_root": ("STRING", {"default": "auto", "tooltip": "Path to ModelTC/LightX2V checkout, or auto"}),
            "model_dir": ("STRING", {"default": "auto", "tooltip": "Folder containing BOTH variant checkpoints"}),
            "python_executable": ("STRING", {"default": "auto", "tooltip": "LightX2V venv Python; auto picks its .venv/bin/python"}),
            "execution_mode": (list(MODES), {"default": "single GPU"}),
            "gpu_ids": ("STRING", {"default": "0", "tooltip": "Single GPU 0 or, for SP, 0,1. Physical GPU indexes (CUDA_VISIBLE_DEVICES)."}),
            "output_scale": (["2", "4"], {"default": "2"}),
            "compile_model": ("BOOLEAN", {"default": False}),
            "warmup": ("BOOLEAN", {"default": False}),
            "clip_len": ("INT", {"default": 16, "min": 4, "max": 128, "step": 4}),
            "queue_size": ("INT", {"default": 4, "min": 1, "max": 64, "step": 1}),
            "codec": (["libx264", "libx265"], {"default": "libx264"}),
            "crf": ("INT", {"default": 17, "min": 0, "max": 51}),
            "preserve_audio": ("BOOLEAN", {"default": True}),
            "unload_comfy_models": ("BOOLEAN", {"default": True}),
            "quality": (list(QUALITY_PRESETS), {"default": "faithful: back-projection + residual 0.85",
                "tooltip": "Named presets set the three knobs below (and, for the Flash ones, a Flash loop on its last 4 blocks at half "
                           "strength). 'custom' uses the knobs as set. Measured with the X4 model at 2x output; 'smooth' was "
                           "measured with clip_len 32."}),
            "back_projection": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                "tooltip": "custom only. Shrinks each output frame back to the input size and adds this much of the difference "
                           "back, so shapes, thickness and brightness match the input while the added texture stays. 0 = off."}),
            "residual_gain": ("FLOAT", {"default": 0.85, "min": 0.0, "max": 3.0, "step": 0.05,
                "tooltip": "custom only. How much of the detail RelayVSR adds on top of a plain bicubic upscale: below 1 is more "
                           "faithful and calmer, above 1 crisper with more invented texture. 1 = stock."}),
            "downscale": (["bicubic", "bilinear", "area"], {"default": "bicubic",
                "tooltip": "custom only. Filter for the X4 model's 4x result when the output is 2x. bilinear is calmer and "
                           "softer; bicubic is stock."}),
            "vram": (list(VRAM_TIERS), {"default": "auto (pick by GPU memory)",
                "tooltip": "Memory/speed tier (single GPU). 24 GB+: int8 weights + int8 KV cache, ~23 % faster than bf16 with "
                           "offload. 16 GB: W6A8 weights + int4 KV, fits a 16 GB card at 1280x704 in. Uses the matching "
                           "wan_<mode>.safetensors next to flash.safetensors when present, else quantizes wan.safetensors "
                           "on load. Drift vs full precision is invisible (44-53 dB). With Wan block offload only the KV "
                           "cache is quantized; two GPUs stay full precision."}),
        }, "optional": {"loop_experiment": ("RELAYVSR_LOOP_SETTINGS",)}}

    RETURN_TYPES = ("RELAYVSR_SETTINGS",)
    RETURN_NAMES = ("settings",)
    FUNCTION = "get_settings"
    CATEGORY = "RelayVSR"

    def get_settings(self, variant, lightx2v_root, model_dir, python_executable,
                     execution_mode, gpu_ids, output_scale, compile_model, warmup,
                     clip_len, queue_size, codec, crf, preserve_audio, unload_comfy_models,
                     quality="stock (the model as shipped)", back_projection=0.0, residual_gain=1.0, downscale="bicubic",
                     vram="full precision: bf16 weights + bf16 KV", loop_experiment=None):
        s = Settings(lightx2v_root=lightx2v_root, model_dir=model_dir,
                     python_executable=python_executable, variant=variant,
                     output_scale=int(output_scale), mode=execution_mode, gpu_ids=gpu_ids,
                     compile_model=bool(compile_model), warmup=bool(warmup),
                     clip_len=int(clip_len), queue_size=int(queue_size), codec=codec,
                     crf=int(crf), preserve_audio=bool(preserve_audio),
                     unload_comfy_models=bool(unload_comfy_models),
                     loop_experiment=quality_spec(loop_experiment, quality, back_projection, residual_gain, downscale,
                                                  vram_knobs(vram, execution_mode, gpu_ids,
                                                             present_quants(lightx2v_root, model_dir, variant) if vram.startswith("auto") else ())))
        s.validate()
        return (s.__dict__.copy(),)


class RelayVSRUpscaleVideo:
    """Native VIDEO socket variant; supports ComfyUI's file-backed/trimmed inputs."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "settings": ("RELAYVSR_SETTINGS",),
            "video": ("VIDEO",),
            "output_subfolder": ("STRING", {"default": "relayvsr"}),
            "filename_prefix": ("STRING", {"default": "relayvsr_x2"}),
            "seed": ("INT", {"default": 42, "min": 0, "max": 2**31-1}),
        }}

    RETURN_TYPES = ("VIDEO", "STRING", "STRING")
    RETURN_NAMES = ("video", "output_path", "stats_json")
    FUNCTION = "upscale"
    CATEGORY = "RelayVSR"
    OUTPUT_NODE = True

    def upscale(self, settings, video, output_subfolder, filename_prefix, seed):
        source, transient = _video_input_to_path(video)
        try:
            dst, stats = _run_video(source, settings, output_subfolder, filename_prefix, seed)
            return {"ui": make_preview(dst, stats),
                    "result": (_video_from_file(dst), str(dst), json.dumps(stats, indent=2))}
        finally:
            if transient is not None:
                transient.unlink(missing_ok=True)


class RelayVSRUpscalePath:
    """Path-based front door: doesn't require an input VIDEO node or extra conversion."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "settings": ("RELAYVSR_SETTINGS",),
            "input_path": ("STRING", {"default": "", "tooltip": "Absolute or ComfyUI-root-relative video path"}),
            "output_subfolder": ("STRING", {"default": "relayvsr"}),
            "filename_prefix": ("STRING", {"default": "relayvsr_x2"}),
            "seed": ("INT", {"default": 42, "min": 0, "max": 2**31-1}),
        }}

    RETURN_TYPES = ("VIDEO", "STRING", "STRING")
    RETURN_NAMES = ("video", "output_path", "stats_json")
    FUNCTION = "upscale"
    CATEGORY = "RelayVSR"
    OUTPUT_NODE = True

    def upscale(self, settings, input_path, output_subfolder, filename_prefix, seed):
        path = Path(os.path.expandvars(input_path)).expanduser()
        if not path.is_absolute():
            path = comfy_root() / path
        dst, stats = _run_video(path.resolve(), settings, output_subfolder, filename_prefix, seed)
        return {"ui": make_preview(dst, stats),
                "result": (_video_from_file(dst), str(dst), json.dumps(stats, indent=2))}


def _encode_images_to_video(images, fps: float, path: Path) -> None:
    import numpy as np
    if images.ndim != 4 or images.shape[0] < 2 or images.shape[-1] not in (3, 4):
        raise ValueError("Expect at least two frames in a ComfyUI IMAGE batch with 3/4 RGB(A) channels")
    if fps <= 0 or fps > 240:
        raise ValueError("FPS must be in (0, 240]")
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is required to serialize IMAGE batches for RelayVSR")
    height, width = int(images.shape[1]), int(images.shape[2])
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s:v", f"{width}x{height}",
            "-r", f"{fps:.8f}", "-i", "pipe:0", "-an", "-c:v", "libx264rgb",
            "-preset", "ultrafast", "-crf", "0", str(path)]
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                               stderr=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for frame in images:
            img = frame.detach().cpu().clamp(0, 1)[..., :3]
            data = (img.numpy() * 255.0).round().astype(np.uint8)
            process.stdin.write(data.tobytes())
            _interrupt()
        process.stdin.close()
        assert process.stderr is not None
        error = process.stderr.read().decode("utf8", "replace")
        rc = process.wait()
        if rc != 0:
            raise RuntimeError(f"ffmpeg failed encoding input IMAGE batch: {error[-2500:]}")
    except BaseException:
        if process.poll() is None:
            process.kill()
            process.wait()
        raise
    finally:
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if process.stderr:
            process.stderr.close()


class RelayVSRUpscaleFrames:
    """Frame batches are a VIDEO sequence, *not* independent image upscales."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "settings": ("RELAYVSR_SETTINGS",),
            "images": ("IMAGE",),
            "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.01}),
            "output_subfolder": ("STRING", {"default": "relayvsr"}),
            "filename_prefix": ("STRING", {"default": "relayvsr_frames"}),
            "seed": ("INT", {"default": 42, "min": 0, "max": 2**31-1}),
        }}

    RETURN_TYPES = ("VIDEO", "STRING", "STRING")
    RETURN_NAMES = ("video", "output_path", "stats_json")
    FUNCTION = "upscale"
    CATEGORY = "RelayVSR"
    OUTPUT_NODE = True

    def upscale(self, settings, images, fps, output_subfolder, filename_prefix, seed):
        base = temp_dir()
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="relayvsr_frames_", dir=base) as tmp:
            input_video = Path(tmp) / "frames_lossless_rgb.mp4"
            _encode_images_to_video(images, fps, input_video)
            dst, stats = _run_video(input_video, settings, output_subfolder, filename_prefix, seed)
            stats["frames_supplied"] = int(images.shape[0])
            stats["input_from_image_batch"] = True
            # The temporary input is removed; stats must not pretend this path persists.
            stats["input"] = "ComfyUI IMAGE batch (lossless RGB intermediate removed)"
            dst.with_suffix(".json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf8")
            return {"ui": make_preview(dst, stats),
                    "result": (_video_from_file(dst), str(dst), json.dumps(stats, indent=2))}


class RelayVSRVideoToFrames:
    """Explicit opt-in decode. Guard against allocating gigabytes of 4K image tensors."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "input_path": ("STRING", {"default": ""}),
            "max_frames": ("INT", {"default": 64, "min": 1, "max": 10000}),
            "max_total_megapixels": ("INT", {"default": 128, "min": 1, "max": 5000}),
        }}

    RETURN_TYPES = ("IMAGE", "FLOAT")
    RETURN_NAMES = ("images", "fps")
    FUNCTION = "decode"
    CATEGORY = "RelayVSR/Utilities"

    def decode(self, input_path, max_frames, max_total_megapixels):
        import numpy as np
        import torch
        src = Path(input_path).expanduser()
        if not src.is_absolute():
            src = comfy_root() / src
        src = src.resolve()
        ffprobe, ffmpeg = shutil.which("ffprobe"), shutil.which("ffmpeg")
        if not src.is_file() or not ffprobe or not ffmpeg:
            raise RuntimeError("RelayVSR Video To Frames needs an existing input video plus ffmpeg and ffprobe on PATH")
        args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height,avg_frame_rate,nb_frames", "-of", "json", str(src)]
        data = json.loads(subprocess.check_output(args, text=True))
        if not data.get("streams"):
            raise ValueError("No video stream in output file")
        stream = data["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
        numerator, denominator = (stream.get("avg_frame_rate") or "24/1").split("/")
        fps = (float(numerator) / float(denominator)) if float(denominator) else 24.0
        if fps <= 0:
            fps = 24.0
        frame_bytes = width * height * 3
        max_pixels = int(max_total_megapixels) * 1_000_000
        if width * height > max_pixels:
            raise ValueError("One frame already exceeds max_total_megapixels")
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(src),
               "-map", "0:v:0", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        frames = []
        count = 0
        try:
            assert p.stdout is not None
            while True:
                # Check for *another* frame before rejecting an exact-limit video.
                if count >= max_frames or (count + 1) * width * height > max_pixels:
                    if p.stdout.read(1):
                        raise MemoryError("Video has more frames than selected RAM limits permit. Raise the limits or use the file-backed VIDEO output.")
                    break
                buffer = bytearray()
                while len(buffer) < frame_bytes:
                    part = p.stdout.read(frame_bytes - len(buffer))
                    if not part:
                        break
                    buffer.extend(part)
                if not buffer:
                    break
                if len(buffer) != frame_bytes:
                    raise RuntimeError("Truncated decoded frame")
                frames.append(torch.from_numpy(np.frombuffer(buffer, dtype=np.uint8).reshape(height, width, 3).copy()))
                count += 1
                _interrupt()
            p.wait()
            if p.returncode != 0 or not frames:
                raise RuntimeError("FFmpeg failed to decode video or produced no frames")
            return (torch.stack(frames).to(dtype=torch.float32) / 255.0, fps)
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
            if p.stdout:
                p.stdout.close()


NODE_CLASS_MAPPINGS = {
    "RelayVSRModelSettings": RelayVSRModelSettings,
    "RelayVSRBlockLoopLab": RelayVSRBlockLoopLab,
    "RelayVSRUpscaleVideo": RelayVSRUpscaleVideo,
    "RelayVSRUpscalePath": RelayVSRUpscalePath,
    "RelayVSRUpscaleFrames": RelayVSRUpscaleFrames,
    "RelayVSRVideoToFrames": RelayVSRVideoToFrames,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "RelayVSRModelSettings": "RelayVSR • X2 / X4 Settings",
    "RelayVSRBlockLoopLab": "RelayVSR • Block Loop Lab (Experimental)",
    "RelayVSRUpscaleVideo": "RelayVSR • Upscale VIDEO",
    "RelayVSRUpscalePath": "RelayVSR • Upscale Video File",
    "RelayVSRUpscaleFrames": "RelayVSR • Upscale IMAGE Sequence",
    "RelayVSRVideoToFrames": "RelayVSR • Decode Video to IMAGE Batch",
}
