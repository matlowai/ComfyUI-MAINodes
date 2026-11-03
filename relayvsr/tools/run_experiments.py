#!/usr/bin/env python3
"""Standalone local A/B sweep. No ComfyUI process or frontend required.

Does NOT download anything or modify LightX2V. Requires a working LightX2V
checkout and its Python environment. Defaults to PLAN ONLY, not GPU execution.
"""
from __future__ import annotations
import argparse
import csv
import importlib
import json
from pathlib import Path
import sys
import tempfile
import time
import types

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("_relay_lab_cli")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
bridge = importlib.import_module(package.__name__ + ".bridge")
labtypes = importlib.import_module(package.__name__ + ".relay_looping.spec")


def main():
    presets = sorted(p.stem for p in (ROOT / "presets").glob("*.json"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Short source MP4; use the SAME clip for every run")
    parser.add_argument("--root", required=True, type=Path, help="LightX2V checkout containing lightx2v/infer.py")
    parser.add_argument("--weights", required=True, type=Path, help="Directory with both X2 or X4 .safetensors")
    parser.add_argument("--python", required=True, type=Path, help="Python in the separate working LightX2V venv")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--variant", choices=list(bridge.VARIANTS), default="X4 original (recommended, also for 2x)")
    parser.add_argument("--output-scale", type=int, choices=(2,4), default=2)
    parser.add_argument("--gpu-ids", default="0")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--crf", type=int, default=17)
    parser.add_argument("--clip-len", type=int, default=16)
    parser.add_argument("--presets", nargs="+", choices=presets,
                        default=["baseline_off", "discovery_scan", "EXPERIMENTAL_wan_early_2pass"])
    parser.add_argument("--execute", action="store_true", help="ACTUALLY RUN the GPU experiments; otherwise print a plan")
    parser.add_argument("--stop-on-error", action="store_true", help="Stop sweep after first failed run")
    args = parser.parse_args()
    source = args.input.expanduser().resolve()
    root = args.root.expanduser().resolve()
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    bridge.output_dir = lambda: output
    bridge.temp_dir = lambda: output / ".relayvsr_tmp"
    all_results = []
    print("RelayVSR Block Loop Lab A/B sweep")
    print("input:", source, "| model:", args.variant, "| seed:", args.seed)
    print("All runs share the same source/seed/scale/codec. Do NOT claim quality wins from speed alone.")
    for index, preset in enumerate(args.presets, 1):
        data = json.loads((ROOT / "presets" / (preset + ".json")).read_text(encoding="utf8"))
        loop = labtypes.LoopSpec.from_value(data)
        settings = bridge.Settings(lightx2v_root=str(root), model_dir=str(args.weights.expanduser().resolve()),
                                   python_executable=str(args.python.expanduser().resolve()),
                                   variant=args.variant, output_scale=args.output_scale, mode="single GPU",
                                   gpu_ids=args.gpu_ids, compile_model=False, warmup=False,
                                   clip_len=args.clip_len, queue_size=4, codec="libx264", crf=args.crf,
                                   preserve_audio=True, unload_comfy_models=False,
                                   loop_experiment=loop.as_dict())
        status = {"preset":preset,"mode":loop.mode,"index":index}
        try:
            settings.validate()
            # Plan checks repo/config and checkpoint files using the SAME bridge as ComfyUI.
            if not source.is_file():
                raise FileNotFoundError(f"Input video missing: {source}")
            with tempfile.TemporaryDirectory(prefix="relayvsr_lab_plan_") as work:
                cfg = bridge.make_config(root, settings, Path(work))
                planned = bridge.build_command(root, settings, source, output / "PLAN.mp4", cfg, args.seed)
            status["planned_command"] = " ".join(planned)
            print(f"\n[{index}/{len(args.presets)}] {preset}: {loop.mode}")
            print("  startup:", status["planned_command"][:1400])
            if args.execute:
                started = time.monotonic()
                video, stats = bridge.process_video(source, settings, output_subfolder="",
                                                    filename_prefix=f"lab_{index:02d}_{preset}", seed=args.seed,
                                                    on_line=lambda line: print("  "+line, flush=True))
                status.update(status="ok", output=str(video), elapsed_seconds=round(time.monotonic()-started,3),
                              extra_block_calls=(stats.get("block_loop") or {}).get("extra_block_calls", {}))
                print("  result:", video)
            else:
                status["status"] = "planned_only"
        except Exception as exc:
            status.update(status="failed",error=f"{type(exc).__name__}: {exc}")
            print("  ERROR:", status["error"], file=sys.stderr)
            all_results.append(status)
            if args.stop_on_error:
                break
            continue
        all_results.append(status)
    manifest = output / "experiment_manifest.json"
    manifest.write_text(json.dumps({"input": str(source), "seed":args.seed, "variant":args.variant,
                                    "executed":args.execute, "results":all_results},indent=2)+"\n",encoding="utf8")
    with (output/"experiment_manifest.csv").open("w",newline="",encoding="utf8") as handle:
        writer=csv.DictWriter(handle,fieldnames=["index","preset","mode","status","elapsed_seconds","output","extra_block_calls","error"],extrasaction="ignore")
        writer.writeheader()
        for entry in all_results:
            writer.writerow(entry)
    print("\nManifest:", manifest)
    return 1 if any(x["status"]=="failed" for x in all_results) else 0


if __name__=="__main__":
    sys.exit(main())
