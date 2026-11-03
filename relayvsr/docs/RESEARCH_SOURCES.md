# Primary references and implementation traceability

**Checked against public information on 2026-11-02.** Research results below are external; no numbers from them should be reported as measurements of this Block Loop Lab without independent testing.

## RelayVSR architecture and actual inference backend

- [RelayVSR: Large-Small Model Collaboration for Efficient Real-World Video Super-Resolution (arXiv:2609.37850)](https://arxiv.org/abs/2609.37850). Describes sparse generative reference generation and lightweight temporal video reconstruction. Source: [kopperx/RelayVSR](https://github.com/kopperx/RelayVSR).
- [LightX2V RelayVSR guide](https://github.com/ModelTC/LightX2V/blob/main/scripts/relayvsr/README.md). Official X4 vs X2 model classes/checkpoints, runtime configurations and usage. This is the input to our CLI bridge.
- [LightX2V native X2 checkpoint and model card](https://huggingface.co/lightx2v/RelayVSR_X2). Checkpoint filenames `wan_x2.safetensors`, `flash_x2.safetensors`, native `sr_ratio=2`, intended for H3-scale video upscaling.
- [LightX2V source repository](https://github.com/ModelTC/LightX2V). Runtime is installed by the user and **not** redistributed or automatically patched here.

## Block looping motivation and caveats

- [Looped Diffusion Transformer (arXiv:2609.40305)](https://arxiv.org/abs/2609.40305). Shared transformer computation re-used inside diffusion steps. Its authors report naive looping is inconsistent without architecture/training measures (deep supervision and self-modulating attention). We adopt the **experimental question**, not its trained method.
- [Training-Free Looped Transformers (arXiv:2605.23872)](https://arxiv.org/abs/2605.23872). Separate research on looping frozen **language** transformers; notes naive reapplication can degrade performance and discusses damped updates. Inspires the `damped_steps` experimental option, but results do not establish suitability for video restoration.
- [ComfyUI-HunyuanImage3](https://github.com/PedroMarinhoDev/ComfyUI-HunyuanImage3). Community experimentation with block looping in a different image model. Its block indices should **not** be reused as canonical RelayVSR indices.

## Related quality improvements, not implemented here

- [ReCaVSR](https://github.com/kopperx/ReCaVSR): alternative streaming VSR model and distinct KV routing; not a drop-in RelayVSR checkpoint.
- [SparkVSR](https://github.com/taco-group/SparkVSR): editable sparse reference-guided VSR; a separately trained model, not simply an X2 conditioning switch.
- [Earlier roadmap in this bundle](history/RelayVSR_Research_Enhancement_Roadmap_2026.md) details source-fidelity, color correction, optical flow and other longer-horizon ideas.

## Operational guidance and decisions

- `block offload` in LightX2V **moves weights** between memory tiers; it is unrelated to `block looping`, which **repeats computation**. The lab defaults to full single-GPU execution to avoid mixing these mechanisms in first studies.
- Do not interpret a changed tensor/MP4 as a successful quality enhancement. A valid experiment requires an exact target match, replay counts, identical comparison settings and review of temporal effects.
