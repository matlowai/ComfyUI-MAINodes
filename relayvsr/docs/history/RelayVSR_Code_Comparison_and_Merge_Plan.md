# RelayVSR ComfyUI code review: uploaded standalone X4 wrapper vs ComfyUI-RelayVSR-X2

Review date: 2026-11-02. Status: static/source review + local CPU adapter tests; **not** a successful GPU model inference benchmark.

## Executive decision

**Retain the LightX2V-backed X2/X4 integration as the main video pipeline. Borrow several robust implementation details from the uploaded original-X4 wrapper, and preserve original X4 direct execution as an optional reference backend rather than treating its checkpoints as interchangeable with native X2.**

The implementations are not duplicates:
- Uploaded: original `kopperx/RelayVSR` checkout pinned to `e856773350f53036d825404c9ea9228e6dffadca`, `wan.safetensors` + `flash.safetensors`, original `CollaborativeFrameStream`, computes native **4x** even when delivering a smaller finish.
- Prior package: `ModelTC/LightX2V`, native `relayvsr_x2` with `wan_x2.safetensors` + `flash_x2.safetensors`; also `relayvsr_x4` via LightX2V. The X2 model computes at **2x** and only accepts `sr_ratio=2`.

Upstream reference: https://github.com/ModelTC/LightX2V/blob/main/scripts/relayvsr/README.md ; original API: https://github.com/kopperx/RelayVSR/blob/e856773350f53036d825404c9ea9228e6dffadca/inference.py

## Detailed capability comparison

| Topic | Uploaded original-X4 package | Earlier LightX2V package | Decision |
|---|---|---|---|
| 2x model support | Original 4x inference, resize 2x | Native 2x inference | Keep native X2 as default |
| 4x support | Direct original API | LightX2V reimplementation | A/B validate consistency rather than assuming pixel-identical output |
| Video integration | VHS IMAGE batch + FPS + optional AUDIO | native VIDEO / direct path / IMAGE-batch-to-video | Keep native VIDEO and path for large clips |
| High-res frames | Provides full output IMAGE tensor | VIDEO output; optional capped decode | Add a clearly labeled *small-clip* IMAGE output node if desired |
| Files | Bounded-RAM output MP4 from raw RGB | Direct LightX2V video-file output | Keep file-backed as primary long-clip path |
| Install | Pin, clone, private venv, download weights | Manual LightX2V install/venv | Adopt optional explicit setup/check utilities |
| Worker lifecycle | Separate process with progress.json and log file | Separate process, streamed log, cancel via callback | Merge quality-of-life ideas; preserve process isolation |
| Execution modes | One GPU, BF16 original runner | single GPU, block offload, two-GPU SP | Keep LightX2V settings |
| Quality assurance | Per-frame count/order/checksum-size checks, output ffprobe | checks existence/nonempty; mock and adapter tests | Adopt actual output stream verification |
| Audio | Optional supplied VHS audio; stand-alone CLI copies source soundtrack when possible | source audio remux with AAC | Add AUDIO socket, prefer stream-copy when compatible |
| Tests | No test suite included in supplied files | 13 CPU adapter tests | Add original-worker unit and workflow tests |

## High-confidence strengths of the uploaded code

`relay_worker.py` uses the same original imports, sampling configuration, frame data types, and `CollaborativeFrameStream` contract as the pinned original `inference.py`. The upstream stream yields GPU/CPU BCHW float in [-1,1]; the uploaded post-processing converts it to RGB8. Original input must be uint8 CHW. It checks sequence order and image geometry.

`relay_runtime.py` validates input tensors and input byte counts, exchanges frames through disk-backed RGB, checks disk space, and distinguishes MP4 from full IMAGE batch output. It checks helper receipt + actual output file size. `relay_process.py` supports process-group cancellation, timeout, and JSON progress reporting. The installer isolates the package in a private Python environment and pins the original Git and weight revisions. `relayvsr_video.py` adds a standalone CLI useful for scripts not running inside ComfyUI, including avoiding a full ComfyUI IMAGE input batch.

## Findings and recommended corrections

### High: `MP4 file` delivery returns original frames on an output named `images`

`relay_runtime.upscale_frames`, lines 97-108: when file delivery is selected, the method returns `result = frames` (the input low-resolution batch). `relay_nodes.RelayVSRUpscale` still exports that as an `IMAGE` socket and returns it normally. The supplied MP4 workflow warns the user; however, if the user changes delivery from `frames (VHS output)` to `MP4 file` while downstream `VHS_VideoCombine` stays connected, the video output can silently be low-resolution original frames. That is a correctness hazard, not just a usability issue.

Fix: split file-based and frame-based output into two nodes with different outputs, or in MP4 mode return no `IMAGE` output and explicitly reject downstream frame use. Do not make a low-resolution batch appear as an enhanced batch.

### Medium: MP4 preview UI has no demonstrated frontend rendering path

The uploaded UI emits `ui.relayvsr_files`, a custom key; no matching frontend JavaScript/viewer was included in the uploaded material. Its own workflow note claims in-node preview. Treat the claim as unverified until a browser integration test or native `VIDEO` output exists. Our earlier package returns `VIDEO` and a conventional `images` preview descriptor for MP4, but that UI still needs an actual current ComfyUI frontend smoke test; unit tests only exercise the shape of the result.

Fix: add native VIDEO output where supported and test actual ComfyUI preview. If using VHS preview, follow its expected `gifs`/video descriptor convention or supply a custom frontend extension.

### Medium: verification should tolerate unknown `nb_frames`

`relay_media.probe_video` returns `count=0` when ffprobe does not expose a numeric `nb_frames`. `relay_files.verify_video` treats any frame count mismatch (including `0` meaning unknown) as proof of failure. Correct files encoded by a different container/muxer can be rejected. For the included x264 MP4 output, `nb_frames` is *usually* populated; the issue is an interoperability risk, not proof that normal encoding fails.

Fix: when `nb_frames` is absent, use `ffprobe -count_frames` / `nb_read_frames`, or a counted decode, and then compare exact counts.

### Medium: file mode still pays the cost of loading the entire *input* IMAGE batch through VHS

MP4 delivery avoids creating the upscaled float tensor, but the VHS branch still materializes the original input IMAGE batch before `relay_runtime` runs. For long source videos, use the direct-file CLI or the native VIDEO/file-path entry point from our package. This is a memory-model limitation, not a bug.

### Medium: original-X4 2x/fit mode is computationally expensive compared with native X2

`relay_worker` performs `native=(height*4,width*4)` inference and optionally `F.interpolate` to `out_height,out_width`. The raw-output disk size is only the *requested output size*, but the neural computation and full native frame activations are 4x. It may still yield different visual results. No apples-to-apples measured quality or speed comparison has been run.

### Low/medium: audio and output guarantees

The VHS `AUDIO` path converts a full waveform to 16-bit WAV, then AAC for mux. This is appropriate for modified audio inputs, but copies/encodes unnecessarily if the source already has an AAC soundtrack. Prefer source stream-copy where it fits the MP4 container; allow explicit AUDIO to override. The uploaded `finalize_file` retains a valid video-only file on mux failure, which is useful, but the UI/report should prominently indicate that audio preservation failed.

Our prior wrapper currently trusts a nonempty output MP4 and does not verify frame count/dimensions/FPS/audio. Adopt the stricter metadata and actual-file checks from the uploaded implementation, with fallback counting and VFR policy.

### Workflow `"fixed"` is legitimate, *not* an extra invalid widget

Both uploaded editor workflows include `"fixed"` after the `seed` integer in `widgets_values`. ComfyUI's frontend automatically adds a `control_after_generate` widget for an `INT` named `seed`; this is normal. Do not remove it. The supplied API-format workflows omit the UI-only control, also normal. Reference: https://github.com/Comfy-Org/ComfyUI_frontend/issues/4460

### Setup/integration caveats

The uploaded files imply a package root with `__init__.py`, and installer/CLI files inside `tools/`; full package layout and JavaScript UI code were not supplied for inspection. Do not conclude the author's complete project lacks them. Both paths require a GPU model-loading smoke test. The uploaded `--probe` checks package inventory and paths but does not verify weight compatibility or CUDA inference, as the check node correctly explains.

## Suggested merge roadmap

1. **P0:** Retain LightX2V X2 as the default; preserve the original-X4 wrapper as a reference/optional backend. Do not mix X2 and X4 checkpoints.
2. **P0:** Ensure that file delivery cannot silently produce low-resolution `IMAGE` outputs. Keep file and frame nodes separate.
3. **P1:** Add robust ffprobe/decoded-frame validation (dimensions, count, FPS, audio) to our LightX2V file outputs; verify temp-file atomicity and cleanup.
4. **P1:** Add a companion install/setup-check command supporting an isolated venv, with safe behavior for preexisting user installations.
5. **P1:** Add optional user-supplied AUDIO + stream-copy when possible, with explicit output status on failures.
6. **P2:** Add detailed per-stage progress, peak VRAM and time-to-first-frame metrics, video preview smoke testing and predictable cancellation.
7. **P2:** Benchmark both original-X4 direct API and LightX2V X4 with the *same weights/clip*; separately benchmark native X2. Compare temporal motion stability, faces, hair, hands, detail hallucinations, perceived sharpness, memory, and end-to-end latency.
8. **P3:** Use the LightX2V server/resident worker facility to amortize repeated X2 model loading for short MiniMax-H3 clips, if the service integration works reliably.

## What was actually tested during this review

- Re-ran prior `ComfyUI-RelayVSR-X2` unit suite: **13/13 passed**, including a mocked whole-process invocation, interrupt, config/device flags, checkpoint selection, image batch roundtrip, and workflow structure.
- Python syntax compilation: seven mounted uploaded modules compiled without errors. Other provided source text was inspected but was not available as mountable bytes for this compilation check.
- Compared uploaded direct-worker call sequence with upstream GitHub file at the exact pinned commit. It is consistent with its exported input/output frame shapes and original runtime API.
- **Not run:** actual RelayVSR CUDA checkpoint loading or image quality/performance benchmarks in either backend, ComfyUI browser UI/preview integration, full installer in a clean environment.

## Sources

- Original RelayVSR: https://github.com/kopperx/RelayVSR
- Pinned original API: https://github.com/kopperx/RelayVSR/blob/e856773350f53036d825404c9ea9228e6dffadca/inference.py
- Pinned original stream contract: https://github.com/kopperx/RelayVSR/blob/e856773350f53036d825404c9ea9228e6dffadca/refvsr_inference/runtime/streaming.py
- LightX2V RelayVSR model variants and modes: https://github.com/ModelTC/LightX2V/blob/main/scripts/relayvsr/README.md
- ComfyUI frontend `seed`/`fixed` behavior: https://github.com/Comfy-Org/ComfyUI_frontend/issues/4460
