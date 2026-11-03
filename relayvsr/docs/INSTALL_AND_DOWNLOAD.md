# Installation & downloads

## Prerequisites

- A recent working ComfyUI installation with native `VIDEO` support; a ComfyUI build with only legacy VideoHelperSuite nodes can use the file-path node but may not accept `VIDEO` output. This was not GUI-verified here.
- A NVIDIA GPU and a working **separate** CUDA-enabled LightX2V Python installation compatible with that GPU (RTX 5090, RTX 6000 Pro, etc.). Match CUDA/Triton/PyTorch to the upstream documentation and your driver. Do **not** install LightX2V dependencies into ComfyUI's own Python as a convenience shortcut.
- `git`, `ffmpeg`, `ffprobe`, enough free disk space for input/output and model checkpoints, Python capable of loading LightX2V.
- A short sample video (2–4 seconds initially) generated from H3 or another source. Keep its exact bytes unchanged across A/B comparisons.

## 1. The nodes

The RelayVSR nodes ship inside ComfyUI-MAINodes (`relayvsr/`); installing MAINodes installs them. If you used the
standalone `ComfyUI-RelayVSR-BlockLoop-Lab` or `ComfyUI-RelayVSR-X2` folders, remove or disable them (rename to
`<name>.disabled`): they register the same node names. The setup summary with the tested dependency list is in
[`../README.md`](../README.md).

## 2. Prepare LightX2V (separate Python / venv)

```bash
git clone https://github.com/ModelTC/LightX2V.git /path/to/LightX2V
cd /path/to/LightX2V
git rev-parse HEAD   # Record this for reproducibility!

# Create a separate environment using a Python version supported by LightX2V:
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -v .

# GPU-specific attention/Triton/torch dependencies: follow LightX2V upstream docs.
```

Upstream may recommend Docker or different native package pins on Blackwell. Verify **upstream unmodified inference** with its `scripts/relayvsr/run_relayvsr_x2_sr.sh` before diagnosing loops. This pack does not patch the source checkout, so you can still follow official instructions verbatim.

Windows: point the settings node at `LightX2V\\.venv\\Scripts\\python.exe` and a Windows-compatible LightX2V install. Experimental hooks have not been tested with Triton-Windows or Windows process launch here.

## 3. Download correct model checkpoints

**Native X2** (recommended for initial work):

```bash
cd /path/to/LightX2V
.venv/bin/python -m pip install -U huggingface_hub
.venv/bin/hf download lightx2v/RelayVSR_X2 \
  wan_x2.safetensors flash_x2.safetensors \
  --local-dir /path/to/LightX2V/models/RelayVSR_X2
```

If the `hf` binary is not in that venv, run `hf download` from a shell where `huggingface_hub` is installed, or use `huggingface-cli download` on an older Hub CLI. Only the two X2 files go in this directory.

**Original X4** (optional separate variant):

```bash
hf download kopper/RelayVSR wan.safetensors flash.safetensors \
  --local-dir /path/to/LightX2V/models/RelayVSR
```

Native X2 **requires** `wan_x2.safetensors` and `flash_x2.safetensors` together. Do not mix them with the original X4 pair. The source model and checkpoints are not shipped in this ZIP.

## 4. Run preflight

```bash
cd /path/to/ComfyUI/custom_nodes/ComfyUI-MAINodes/relayvsr
python tools/check_setup.py \
  --root /path/to/LightX2V \
  --weights /path/to/LightX2V/models/RelayVSR_X2 \
  --python /path/to/LightX2V/.venv/bin/python \
  --variant X2
python -m unittest discover -s tests -v
```

`check_setup` verifies paths, sizes and Python Torch import. It **does not** load or execute X2 weights.

## 5. ComfyUI: wire settings

In `RelayVSR • X2 / X4 Settings` set:

```text
variant:           X2 native (recommended)
lightx2v_root:     /path/to/LightX2V
model_dir:         /path/to/LightX2V/models/RelayVSR_X2
python_executable: /path/to/LightX2V/.venv/bin/python
execution_mode:    single GPU
gpu_ids:           0
output_scale:      2
compile_model:     false
warmup:            false
clip_len:          16
queue_size:        4
codec:             libx264
crf:               17
preserve_audio:    true
```

Create `RelayVSR • Block Loop Lab (Experimental)` and wire its `loop_experiment` output to the **optional** input of the model settings node. For first run select preset `baseline_off`; next select `discovery_scan`. In both cases loop controls are read-only diagnostics or disabled; only a preset with `mode=experiment` performs repeats.

Run `RelayVSR • Upscale Video File` with a 2–4s source path or use native `VIDEO` source and the matching example workflow. Completed outputs land in `ComfyUI/output/relayvsr/` as `<prefix>_<id>.mp4`, `<prefix>_<id>.json` and, in discover/experiment modes, `<prefix>_<id>.loop.json`.

## 6. Headless sweep (excellent for local coding agents)

**Plan only, no GPU:**

```bash
python tools/run_experiments.py \
  --root /path/to/LightX2V \
  --weights /path/to/LightX2V/models/RelayVSR_X2 \
  --python /path/to/LightX2V/.venv/bin/python \
  --input /path/to/short_clip.mp4 \
  --output-dir /path/to/relayvsr_lab_runs \
  --presets baseline_off discovery_scan EXPERIMENTAL_wan_early_2pass
```

**Actually render those three variants:** add `--execute`. The sweep runs them serially with the same seed, preserving per-run JSON reports and a CSV manifest. If the experimental run fails to match blocks, inspect the discovery `.loop.json`, set `wan.owner_regex` in a copied preset or the ComfyUI custom node, and rerun. A failed match is **not** a quality result.

Compare rendered videos side by side:

```bash
python tools/make_ab_preview.py baseline.mp4 experiment.mp4 \
  --output /path/to/ab_side_by_side.mp4
```

The LEFT side is the baseline, the RIGHT is the experiment. This is a review convenience, not a numerical quality metric.

## If something breaks

- `Missing ... checkpoints`: the two required X2/X4 files are not together or are Git LFS pointer text files.
- `LightX2V missing ... infer.py`: set the `lightx2v_root` to the repository root.
- `Loop worker did not generate its report`: the experimental bootstrap did not run or is missing from `PYTHONPATH`. Check stdout/traceback and `relay_looping.launch`.
- `loop stage wan ... never executed`: inspect discovery; the expected container might not match `wan` automatically, might not be an `nn.ModuleList`, or the optimized path bypasses Python forwards. **Do not mark such a run as a baseline victory or success.**
- `more than one container matched`: set a restrictive `wan_owner_regex` / `flash_owner_regex` matching the discovery `owner` and block class, or explicitly allow multiple only after confirming intent.
- `live cache arguments`: either keep strict failure or explicitly opt into research-mode `allow_stateful_repeats`, acknowledging caches may be mutated multiple times. For Flash, be particularly cautious.
- `compile_model`/`warmup`: switch both off in discovery/experiment mode. Once behavior is validated, benchmark a source-level optimized implementation separately.
- Two GPUs/offloading: not the first test. Discover on single GPU; advanced modes require explicit opt-in and are unvalidated.
- Uninstall: disconnect the Lab node or select `baseline_off` for normal inference; delete the new nodepack folder only when ComfyUI is stopped. No upstream code is modified by the package.
