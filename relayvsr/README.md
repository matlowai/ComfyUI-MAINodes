# RelayVSR upscaling (alpha)

Video super-resolution with [RelayVSR](https://github.com/kopperx/RelayVSR), run through
[ModelTC/LightX2V](https://github.com/ModelTC/LightX2V) in its own Python process, so nothing heavy loads into
ComfyUI. Use the **X4** model even for 2x output: it computes at 4x and resizes, and on our H3 test clips it was clearly
better than the native X2 model, which re-draws faces (PSNR +3.3 dB, less flicker).

Nodes (category `RelayVSR`): **RelayVSR • X2 / X4 Settings**, **RelayVSR • Upscale VIDEO** (native VIDEO in and out,
keeps the soundtrack), **RelayVSR • Upscale Video File**, **RelayVSR • Upscale IMAGE Sequence**,
**RelayVSR • Decode Video to IMAGE Batch**, and **RelayVSR • Block Loop Lab (Experimental)** for research.

## Setup

1. **LightX2V in its own venv** (never in ComfyUI's Python):

   ```bash
   git clone https://github.com/ModelTC/LightX2V.git && cd LightX2V
   uv venv --python 3.12 .venv
   uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
   uv pip install --python .venv/bin/python numpy scipy safetensors loguru omegaconf einops av pillow \
       opencv-python-headless imageio imageio-ffmpeg tqdm diffusers transformers accelerate ninja packaging \
       gguf prometheus_client pydantic comfy-kitchen
   ```

   That is the subset the RelayVSR path imports (LightX2V's full requirements add serving and cloud packages it does
   not use). `comfy-kitchen` is only needed for the quantized VRAM tiers. Match the torch build to your GPU; the one
   above is CUDA 13.0 (Blackwell tested).
2. **Weights** (safetensors only), into `ComfyUI/models/relayvsr/RelayVSR/`:
   - `flash.safetensors` plus one Wan file. Full precision: `wan.safetensors` from
     [kopper/RelayVSR](https://huggingface.co/kopper/RelayVSR). Smaller cards: one of the pre-quantized Wan files
     from [MATLOWAI/RelayVSR-X4-Quants](https://huggingface.co/MATLOWAI/RelayVSR-X4-Quants) (see VRAM below).
3. On the Settings node set `lightx2v_root` to the LightX2V folder (or leave `auto` if it sits next to ComfyUI) and keep
   `model_dir` on `auto`. Example graphs: [`examples/relayvsr/`](../examples/relayvsr/).

## Settings that matter

| input | what it does |
|---|---|
| `variant` | **X4 original (recommended, also for 2x)**. X2 native is kept for comparison. |
| `output_scale` | 2 or 4. |
| `quality` | **faithful** (default): back-projection + residual 0.85, the best texture/fidelity balance we measured. **faithful + Flash loop**: the same with Flash's last 4 blocks looped at half strength. **smooth**: every knob, calmest and least texture. **stock**: the model as shipped. **custom**: the three knobs below. |
| `back_projection` | custom only. Shrinks each output frame back to the input size and adds this much of the difference back, so shapes, thickness and brightness follow the input while the added texture stays. Biggest single gain: +2.6 dB PSNR, -20 % flicker. |
| `residual_gain` | custom only. How much of the detail RelayVSR adds on top of a bicubic upscale (1 = stock, below 1 calmer and more faithful). |
| `downscale` | custom only. Filter for the X4 result when the output is 2x (bilinear is calmer, bicubic is stock). |
| `vram` | memory/speed tier, below. `auto` picks by the card's memory. |
| `execution_mode` | single GPU (default), Wan block offload, or two GPUs (SP). |

## VRAM

At 1280x704 in (an H3 clip) -> 2560x1408 out, X4, faithful preset, 3 s clip, one RTX 5090. The 16 GB tiers ran under a
PyTorch memory cap that leaves room for the CUDA context and a desktop on a 16 GB card. Drift is PSNR against the
full-precision output (above ~45 dB is invisible); on our five scored clips every tier scored the same as full precision.

| card | `vram` tier | Wan file | peak | time per 3 s clip | drift |
|---|---|---|---|---|---|
| 32 GB | full precision (Wan block offload) | `wan.safetensors` (9.4 GB) | 27.9 GB | 28.4 s | — |
| 24 GB+ | int8 ConvRot weights + int8 KV (fastest) | `wan_int8_convrot.safetensors` (4.9 GB) | 21.8 GB | 21.9 s | 53 dB |
| 16 GB | W6A8 weights + int4 KV | `wan_w6a8.safetensors` (4.0 GB) | fits 13.5 GiB | 23.0 s | 47 dB |
| 16 GB, more headroom | W4A8 weights + int4 KV | `wan_w4a8.safetensors` (2.9 GB) | fits 13.0 GiB | 22.8 s | 44 dB |

Memory is set by resolution, not clip length: most of it is Wan's key/value cache over four keyframes (19.6 GiB in
bf16 at this size), which the tiers store as rotated int8 / int4. Smaller weight quants would not take a 12 GB card
there; that needs a smaller output or tiling. If no pre-quantized file is present, the worker quantizes
`wan.safetensors` on load (a few seconds slower, same tiers). Quantized weights need `single GPU`; with Wan block
offload only the KV cache is quantized; two GPUs stay full precision.

## Limits

Alpha. Every run starts a fresh LightX2V process (model load each time). Not tested on AMD, Windows, or cards other
than the RTX 5090. Block loops ("Block Loop Lab") are research: Wan loops made results worse in every variant we tried;
only a half-strength loop on Flash's last blocks helped slightly. The study behind these numbers, including the
side-by-side viewer, used five 3 s H3 clips; treat single-seed differences under ~0.15 dB as noise.

Design notes and the research roadmap: [`docs/`](docs/), [`ROADMAP.md`](ROADMAP.md). Tools:
`tools/quantize_wan.py` (makes the quantized Wan files), `tools/run_experiments.py`, `tools/make_ab_preview.py`.
Tests: `python -m unittest discover -s tests` from this folder.

Credits: RelayVSR (kopperx, arXiv:2609.37850), the LightX2V team (inference backend and the native X2 model),
Wan 2.2 and FlashVSR, comfy-kitchen (quantized kernels).
