"""Portable, dependency-light adapter for the upstream LightX2V RelayVSR CLI.

No LightX2V imports at ComfyUI startup, no upstream files patched and no shell=True.
The caller is responsible for feeding a real video and reading the produced output.
"""
from __future__ import annotations

from dataclasses import dataclass
from .relay_looping.spec import LoopSpec
from pathlib import Path
from typing import Callable, Optional
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import queue
import signal
import tempfile
import time
import uuid


VARIANTS = {
    "X4 original (recommended, also for 2x)": ("relayvsr_x4", "RelayVSR", ("wan.safetensors", "flash.safetensors"), 4),
    "X2 native": ("relayvsr_x2", "RelayVSR_X2", ("wan_x2.safetensors", "flash_x2.safetensors"), 2),
}
MODES = {"single GPU": "", "Wan block offload": "_block_offload", "two GPUs (SP)": "_sp"}


def comfy_root() -> Path:
    try:
        import folder_paths
        return Path(folder_paths.base_path).resolve()
    except ImportError:
        return Path.cwd().resolve()


def output_dir() -> Path:
    try:
        import folder_paths
        return Path(folder_paths.get_output_directory()).resolve()
    except ImportError:
        return (comfy_root() / "output").resolve()


def temp_dir() -> Path:
    try:
        import folder_paths
        return Path(folder_paths.get_temp_directory()).resolve()
    except ImportError:
        return Path(tempfile.gettempdir()).resolve()


def _normal_path(value: str, relative_to: Optional[Path] = None) -> Path:
    raw = Path(os.path.expandvars(str(value).strip())).expanduser()
    if not raw.is_absolute():
        raw = (relative_to or comfy_root()) / raw
    return raw.resolve()


def find_root(path: str = "auto") -> Path:
    if str(path).strip().lower() != "auto":
        result = _normal_path(path)
        if not (result / "lightx2v" / "infer.py").is_file():
            raise FileNotFoundError(f"LightX2V source missing lightx2v/infer.py: {result}")
        return result
    root = comfy_root()
    guesses = [os.environ.get("RELAYVSR_LIGHTX2V_ROOT"),
               root / "custom_nodes" / "LightX2V", root / "LightX2V",
               root / "custom_nodes" / "ComfyUI-Lightx2vWrapper" / "lightx2v",
               root.parent / "LightX2V"]
    for guess in guesses:
        if guess and (Path(guess).expanduser() / "lightx2v" / "infer.py").is_file():
            return Path(guess).expanduser().resolve()
    raise FileNotFoundError("Cannot locate LightX2V. Clone https://github.com/ModelTC/LightX2V and set lightx2v_root in the loader node.")


def find_python(root: Path, option: str = "auto") -> Path:
    # No resolve(): a venv's bin/python is a symlink to the base interpreter, and following it drops the venv.
    if option.strip().lower() != "auto":
        executable = Path(os.path.expandvars(option.strip())).expanduser()
        if not executable.is_absolute():
            executable = comfy_root() / executable
        if not executable.is_file():
            raise FileNotFoundError(f"Python executable not found: {executable}")
        return executable
    guesses = (root / ".venv" / "bin" / "python", root / ".venv" / "Scripts" / "python.exe",
               root / "venv" / "bin" / "python", root / "venv" / "Scripts" / "python.exe")
    for path in guesses:
        if path.is_file():
            return path.absolute()
    return Path(sys.executable)


QUANT_WAN = ("int8_convrot", "w6a8", "w4a8")


def find_weights(root: Path, option: str, variant: str, wan_name: str | None = None) -> Path:
    """Checkpoint folder for `variant`; wan_name swaps the Wan file (a pre-quantized X4 Wan from tools/quantize_wan.py)."""
    _, dirname, required, _ = VARIANTS[variant]
    if wan_name:
        required = (wan_name, *required[1:])
    if option.strip().lower() != "auto":
        candidates = [_normal_path(option)]
    else:
        modelroot = comfy_root() / "models"
        try:
            import folder_paths
            modelroot = Path(folder_paths.models_dir)
        except ImportError:
            pass
        candidates = [os.environ.get("RELAYVSR_MODEL_DIR"),
                      modelroot / "relayvsr" / dirname, modelroot / "lightx2v" / dirname,
                      modelroot / "relayvsr", root / "models" / dirname]
    for candidate in candidates:
        if candidate and all((Path(candidate).expanduser() / fname).is_file() for fname in required):
            result = Path(candidate).expanduser().resolve()
            for fname in required:
                if (result / fname).stat().st_size < 128:
                    raise RuntimeError(f"Checkpoint is empty or a Git LFS pointer: {result / fname}")
            return result
    shown = ', '.join(required)
    raise FileNotFoundError(f"Missing {variant} checkpoints ({shown}). Place both together and select their directory. See https://huggingface.co/lightx2v/RelayVSR_X2 (X2) or https://huggingface.co/kopper/RelayVSR (X4).")


def validate_devices(ids: str, mode: str) -> str:
    compact = re.sub(r"\s+", "", str(ids))
    if not re.fullmatch(r"\d+(,\d+)*", compact):
        raise ValueError("gpu_ids must be like '0' or '0,1'.")
    values = compact.split(",")
    if len(set(values)) != len(values):
        raise ValueError("gpu_ids contains duplicate GPU indexes.")
    if mode == "two GPUs (SP)" and len(values) != 2:
        raise ValueError("Two-GPU SP mode requires exactly two GPU IDs, e.g. '0,1'.")
    if mode != "two GPUs (SP)" and len(values) != 1:
        raise ValueError("Single-GPU modes require exactly one GPU ID.")
    return compact


@dataclass(frozen=True)
class Settings:
    lightx2v_root: str = "auto"
    model_dir: str = "auto"
    python_executable: str = "auto"
    variant: str = "X2 native"
    output_scale: int = 2
    mode: str = "single GPU"
    gpu_ids: str = "0"
    compile_model: bool = False
    warmup: bool = False
    clip_len: int = 16
    queue_size: int = 4
    codec: str = "libx264"
    crf: int = 17
    preserve_audio: bool = True
    unload_comfy_models: bool = True
    loop_experiment: dict | None = None

    def validate(self):
        if self.variant not in VARIANTS or self.mode not in MODES:
            raise ValueError("Invalid RelayVSR variant or execution mode")
        if self.variant.startswith("X2") and self.output_scale != 2:
            raise ValueError("Native RelayVSR X2 only supports output_scale=2")
        if self.output_scale not in (2, 4):
            raise ValueError("output_scale must be 2 or 4")
        if self.clip_len < 4 or self.clip_len % 4 != 0:
            raise ValueError("clip_len must be a multiple of four (default 16)")
        if not 1 <= self.queue_size <= 64 or not 0 <= self.crf <= 51:
            raise ValueError("queue_size must be 1..64 and crf must be 0..51")
        if self.codec not in ("libx264", "libx265"):
            raise ValueError("Codec must be libx264 or libx265")
        validate_devices(self.gpu_ids, self.mode)
        lab = LoopSpec.from_value(self.loop_experiment)
        if lab.mode != "off":
            if self.compile_model or self.warmup:
                raise ValueError("Block Loop Lab requires compile_model=false and warmup=false to instrument eager forwards")
            # Checked 2026-11-03: quality knobs and Flash loops on two GPUs (SP) and on Wan block offload, pixel-identical
            # to each other at 1280x704 -> 2560x1408. Wan loops outside single GPU were not run.
            if lab.wan.active and self.mode != "single GPU" and not lab.allow_advanced_modes:
                raise ValueError("Wan loops with SP/offload are unvalidated. Use single GPU, or explicitly allow_advanced_modes after review.")


def resolve_wan(root: Path, settings: Settings) -> tuple[Path, Path | None]:
    """(checkpoint folder, pre-quantized Wan file or None). The quantized file is used when the weights mode asks for one
    and it sits next to flash.safetensors (it may replace wan.safetensors); otherwise the worker quantizes on load."""
    mode = LoopSpec.from_value(settings.loop_experiment).weights if settings.loop_experiment else "bf16"
    if mode in QUANT_WAN and VARIANTS[settings.variant][3] == 4:
        name = f"wan_{mode}.safetensors"
        try:
            folder = find_weights(root, settings.model_dir, settings.variant, name)
            return folder, folder / name
        except FileNotFoundError:
            pass
        try:
            return find_weights(root, settings.model_dir, settings.variant), None
        except FileNotFoundError:
            have = []
            for other in QUANT_WAN:
                try:
                    find_weights(root, settings.model_dir, settings.variant, f"wan_{other}.safetensors")
                    have.append(f"wan_{other}.safetensors")
                except FileNotFoundError:
                    pass
            raise FileNotFoundError(f"This vram tier needs {name} (or wan.safetensors, quantized on load) next to flash.safetensors. "
                                    f"Get it from https://huggingface.co/MATLOWAI/RelayVSR-X4-Quants"
                                    + (f", or pick the tier for the file you have ({', '.join(have)})." if have else ".")) from None
    return find_weights(root, settings.model_dir, settings.variant), None


def make_config(root: Path, settings: Settings, workspace: Path) -> Path:
    settings.validate()
    model_cls, _, _, native_scale = VARIANTS[settings.variant]
    suffix = MODES[settings.mode]
    source = root / "configs" / "relayvsr" / f"{model_cls}{suffix}.json"
    if not source.is_file():
        raise FileNotFoundError(f"Upstream RelayVSR configuration not found: {source}. Update your LightX2V checkout.")
    config = json.loads(source.read_text(encoding="utf8"))
    # Never mutate upstream config files. Do not change checkpoint-dependent fields.
    if int(config.get("native_scale", native_scale)) != native_scale:
        raise ValueError("Selected config native_scale is inconsistent with model weights")
    config.update({"use_compile": settings.compile_model, "warmup": settings.warmup,
                   "clip_len": settings.clip_len, "queue_size": settings.queue_size,
                   "video_codec": settings.codec, "video_crf": settings.crf})
    quantized = resolve_wan(root, settings)[1]
    if quantized is not None:
        config["dit_original_ckpt"] = str(quantized)
    dst = workspace / "relayvsr_runtime.json"
    dst.write_text(json.dumps(config, indent=2) + "\n", encoding="utf8")
    return dst


def build_command(root: Path, settings: Settings, input_path: Path, output_path: Path, config_path: Path, seed: int) -> list[str]:
    python = str(find_python(root, settings.python_executable))
    model_path = str(resolve_wan(root, settings)[0])
    model_cls = VARIANTS[settings.variant][0]
    cmd = [python]
    lab = LoopSpec.from_value(settings.loop_experiment)
    entry = "relay_looping.launch" if lab.mode != "off" else "lightx2v.infer"
    if settings.mode == "two GPUs (SP)":
        cmd += ["-m", "torch.distributed.run", "--standalone", "--nproc_per_node=2", "-m", entry]
    else:
        cmd += ["-m", entry]
    if lab.mode != "off":
        cmd += ["--"]
    cmd += ["--model_cls", model_cls, "--task", "sr", "--model_path", model_path,
            "--config_json", str(config_path), "--video_path", str(input_path),
            "--sr_ratio", str(settings.output_scale), "--save_result_path", str(output_path),
            "--seed", str(int(seed))]
    return cmd


def _environment(root: Path, settings: Settings) -> dict[str, str]:
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = validate_devices(settings.gpu_ids, settings.mode)
    # Make the self-contained research runtime importable inside the *other* venv.
    # Baseline still invokes lightx2v.infer directly; no model code is monkeypatched.
    env["PYTHONPATH"] = os.pathsep.join(x for x in (str(root), str(Path(__file__).resolve().parent), env.get("PYTHONPATH")) if x)
    env["MOONCAKE_CONFIG_PATH"] = str(root / "configs" / "mooncake_config.json")
    env["TOKENIZERS_PARALLELISM"] = "false"
    env["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    env.setdefault("DTYPE", "BF16")
    env.setdefault("SENSITIVE_LAYER_DTYPE", "None")
    env.setdefault("PROFILING_DEBUG_LEVEL", "0")
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _stop_process(process: subprocess.Popen) -> None:
    """Kill the whole launched torchrun family, not just the launcher."""
    if process.poll() is not None:
        return
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    else:
        # taskkill /T is important when torchrun launched worker children.
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process.terminate() if process.poll() is None else None
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=5)


def _run(args: list[str], *, cwd: Optional[Path] = None, env: Optional[dict] = None,
         on_line: Optional[Callable[[str], None]] = None, check_interrupt: Optional[Callable[[], None]] = None) -> None:
    """Run a command with live logs, cancellation even during silent model loading.

    Reader thread solves blocking reads when torch.compile is silent for minutes.
    """
    last_lines: list[str] = []
    kw = {"start_new_session": True} if os.name == "posix" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    process = subprocess.Popen(args, cwd=str(cwd) if cwd else None, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, errors="replace", bufsize=1, **kw)
    events: queue.Queue = queue.Queue()

    def read_lines():
        try:
            assert process.stdout is not None
            for line in process.stdout:
                events.put(line.rstrip("\n"))
        finally:
            events.put(None)

    reader = threading.Thread(target=read_lines, daemon=True)
    reader.start()
    finished = False
    try:
        while not finished:
            if check_interrupt:
                check_interrupt()
            try:
                line = events.get(timeout=0.25)
            except queue.Empty:
                continue
            if line is None:
                finished = True
            else:
                last_lines.append(line)
                if len(last_lines) > 60:
                    del last_lines[:len(last_lines) - 60]
                if on_line:
                    on_line(line)
        rc = process.wait()
        if rc != 0:
            raise RuntimeError(f"Command exited with code {rc}: {' '.join(args[:5])}\n" + "\n".join(last_lines[-25:]))
    except BaseException:
        _stop_process(process)
        raise
    finally:
        if process.stdout:
            process.stdout.close()
        reader.join(timeout=0.5)


def _audio_remux(video: Path, original: Path, remuxed: Path, ffmpeg: str, logger) -> None:
    # Video stays bit-for-bit identical to the super-resolved encode (no second video encode).
    # Optional map lets no-audio sources complete normally. No -shortest: H3 audio ends a hair before the video,
    # and -shortest then cut the last video frame (73 -> 72 frames).
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
           "-i", str(video), "-i", str(original), "-map", "0:v:0", "-map", "1:a:0?",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", str(remuxed)]
    _run(cmd, on_line=logger)


def _preflight_input(input_path: Path) -> None:
    if not input_path.is_file() or input_path.stat().st_size == 0:
        raise FileNotFoundError(f"RelayVSR input video missing/empty: {input_path}")


def process_video(input_file: str | Path, settings: Settings, *, output_subfolder: str = "relayvsr",
                  filename_prefix: str = "relayvsr_x2", seed: int = 42,
                  check_interrupt: Optional[Callable[[], None]] = None,
                  on_line: Optional[Callable[[str], None]] = None) -> tuple[Path, dict]:
    settings.validate()
    root = find_root(settings.lightx2v_root)
    source = Path(input_file).expanduser().resolve()
    _preflight_input(source)
    # Constrain output folders to ComfyUI's served output tree so video preview works.
    base = output_dir()
    subfolder = Path((output_subfolder or "relayvsr").strip())
    if subfolder.is_absolute() or any(x == ".." for x in subfolder.parts):
        raise ValueError("output_subfolder must be relative and cannot contain '..'")
    target_dir = (base / subfolder).resolve()
    if os.path.commonpath([str(base), str(target_dir)]) != str(base):
        raise ValueError("Output escapes ComfyUI output directory")
    target_dir.mkdir(parents=True, exist_ok=True)
    prefix = re.sub(r"[^a-zA-Z0-9_.-]+", "_", (filename_prefix or "relayvsr").strip()).strip("._") or "relayvsr"
    job_id = uuid.uuid4().hex[:10]
    final = target_dir / f"{prefix}_{job_id}.mp4"
    log = on_line or (lambda message: print("[RelayVSR]", message))
    started = time.perf_counter()
    temp_dir().mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="relayvsr_job_", dir=str(temp_dir())) as tmp:
        tmpdir = Path(tmp)
        cfg = make_config(root, settings, tmpdir)
        raw = target_dir / f".{prefix}_{job_id}.inprogress.mp4"
        muxed = target_dir / f".{prefix}_{job_id}.muxing.mp4"
        cmd = build_command(root, settings, source, raw, cfg, seed)
        lab = LoopSpec.from_value(settings.loop_experiment)
        worker_env = _environment(root, settings)
        report_file = tmpdir / "loop_result.json"
        if lab.mode != "off":
            spec_file = tmpdir / "loop_spec.json"
            spec_file.write_text(json.dumps(lab.as_dict(), indent=2) + "\n", encoding="utf8")
            worker_env["RELAYVSR_LOOP_SPEC_PATH"] = str(spec_file)
            worker_env["RELAYVSR_LOOP_REPORT_PATH"] = str(report_file)
            if lab.active:
                worker_env["RELAYVSR_LOOP_RUNTIME_ACK"] = "experimental-stateful-hooks-v1"
        try:
            log(f"Launching {VARIANTS[settings.variant][0]} on GPU(s) {settings.gpu_ids}; mode={settings.mode}")
            _run(cmd, cwd=root, env=worker_env, on_line=log, check_interrupt=check_interrupt)
            loop_result = None
            if lab.mode != "off":
                report_rank = report_file.with_name(report_file.stem + "_rank0" + report_file.suffix)
                if not report_rank.is_file():
                    raise RuntimeError("Loop discovery/experiment requested but the worker did not generate its rank-0 report")
                loop_result = json.loads(report_rank.read_text(encoding="utf8"))
                if loop_result.get("status") != "finished":
                    raise RuntimeError("Loop runtime reported failure: " + str(loop_result.get("error", "unknown")))
                if lab.active:
                    for target in ("wan", "flash"):
                        if getattr(lab, target).active and not loop_result.get("extra_block_calls", {}).get(target, 0):
                            raise RuntimeError(f"Selected {target} stage never executed any extra block calls")
            if not raw.is_file() or raw.stat().st_size == 0:
                raise RuntimeError("LightX2V returned success but the output video was not written. Check your LightX2V version and console output.")
            audio_note = "not requested"
            if settings.preserve_audio:
                ffmpeg = shutil.which("ffmpeg")
                if ffmpeg:
                    _audio_remux(raw, source, muxed, ffmpeg, log)
                    muxed.replace(final)
                    audio_note = "source audio remuxed as AAC where present"
                else:
                    log("ffmpeg not found; output saved without source audio. Install ffmpeg to preserve MiniMax-H3 audio.")
                    raw.replace(final)
                    audio_note = "ffmpeg not installed; audio not preserved"
            else:
                raw.replace(final)
            seconds = time.perf_counter() - started
            stats = {"variant": settings.variant, "scale": settings.output_scale,
                     "mode": settings.mode, "gpu_ids": settings.gpu_ids, "seed": int(seed),
                     "input": str(source), "output": str(final), "elapsed_seconds": round(seconds, 3),
                     "audio": audio_note, "block_loop_mode": lab.mode,
                     "block_loop": {"extra_block_calls": loop_result.get("extra_block_calls"),
                                    "installed": loop_result.get("installed")} if loop_result else None,
                     "config": {"clip_len": settings.clip_len,
                     "queue_size": settings.queue_size, "compile": settings.compile_model, "warmup": settings.warmup,
                     "codec": settings.codec, "crf": settings.crf},
                     "note": "Elapsed includes model load/warmup/encode; not comparable to upstream inference-only FPS."}
            (final.with_suffix(".json")).write_text(json.dumps(stats, indent=2) + "\n", encoding="utf8")
            if loop_result is not None:
                (final.with_suffix(".loop.json")).write_text(json.dumps(loop_result, indent=2) + "\n", encoding="utf8")
                log(f"Loop report: {final.with_suffix('.loop.json')}")
            log(f"Saved: {final}")
            return final, stats
        except BaseException:
            # Research failures are useful evidence. TempDirectory removes the
            # worker report on exit, so retain it *even when the video fails*.
            # Do not publish a partial/invalid MP4 as a successful inference.
            if lab.mode != "off":
                for rank_report in tmpdir.glob("loop_result_rank*.json"):
                    dest = target_dir / f"{prefix}_{job_id}.failed.{rank_report.stem}.json"
                    try:
                        shutil.copy2(rank_report, dest)
                        log(f"Retained failed loop report: {dest}")
                    except OSError as report_error:
                        log(f"WARNING: could not retain failed loop report: {report_error}")
            raise
        finally:
            raw.unlink(missing_ok=True)
            muxed.unlink(missing_ok=True)


def make_preview(path: Path, stats: dict) -> dict:
    base = output_dir()
    result = {"text": (f"RelayVSR {stats['variant']} → {path} ({stats['elapsed_seconds']}s)",)}
    if os.path.commonpath([str(base), str(path.resolve())]) == str(base):
        sub = path.resolve().relative_to(base)
        result["images"] = [{"filename": sub.name, "subfolder": "" if sub.parent == Path('.') else sub.parent.as_posix(), "type": "output"}]
        result["animated"] = (True,)
    return result
