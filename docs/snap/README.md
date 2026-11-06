# Snap (test branch)

Snap is a snap-together view over the real ComfyUI graph. You build a render from bricks (Models, Prompt, References,
Render, Upscale, ...) and Snap edits the ordinary ComfyUI workflow underneath, so anything you change in the graph
shows up in Snap and the other way round. The layers are:

- **Graph:** plain ComfyUI nodes and links. Saved workflows stay plain ComfyUI plus an `extra.snap` block.
- **Snap:** bricks, recipes, Cast, scenes and takes on top of that graph.
- **Agents:** the same actions as tools, over WebMCP in the page or MCP / HTTP from outside (see [Agent hooks](#agent-hooks)).

This is the `snap` branch, for testers. It is not on `main` yet. The design rules are in
[`SNAP_RULES.md`](SNAP_RULES.md) (SNAP-R1, R2, ...); code cites them by ID.

## Install the branch

```
cd ComfyUI/custom_nodes
git clone -b snap https://github.com/matlowai/ComfyUI-MAINodes
```

Already have MAINodes? `git fetch origin && git switch snap`. Restart ComfyUI and reload the page.

Snap downloads nothing by itself. The onboarding sheet lists the files and node packs a setup needs, with sizes,
sources and licenses, and a command you can run (see [Third-party models and licenses](#third-party-models-and-licenses)).

## Open it

- Open `http://<your ComfyUI>/?snap`, or
- press the **Snap** button in the ComfyUI top bar, or Alt+S, or "Toggle Snap view" in the command palette.

The same toggle takes you back to the graph.

## What to try

- **Recipes and setups:** start a recipe from the onboarding sheet or the Library (MiniMax H3 video with sound, MOSS-Image
  / Kromoss / Krea 2 stills). Starting on a non-empty graph opens a new tab; it never touches open work.
- **Cast:** make a Cast record for a character (name, trigger words, details, reference pictures, LoRA) and put it
  in a shot. Cast records are versioned.
- **Scenes, shots and takes:** group shots into scenes (`+ Shot`), render takes, star the one you keep, browse them in
  Dailies.
- **Re-take and re-run:** re-take a take as it was (same versions, seed included), or with today's world, or re-run it
  with swaps (another Cast version, another reference, another LoRA).
- **Extend:** continue a take past H3's clip length (Standard, Long, or the Geiru protected chain). The longer take
  lands as a version of the take.
- **Edits and recast:** change something in a take (light, weather, an object) with Ripple or Viggle Remake, or recast
  a person. Candidates come back with identity and copy notes; you pick.
- **Work card:** the pill above the chain shows everything in flight, landed or failed, from the server's own records,
  including runs started from another page or by an agent.
- **Library:** search cards, setups, LoRAs and Cast by words or by meaning (local EmbeddingGemma 2, if installed;
  keyword search otherwise).

## Agent hooks

- Start with [`AGENT_START.md`](AGENT_START.md): how an agent finds the server's Snap, opens a page, and calls tools.
- `tools/snapcall.py <base> <tool> '<json args>'`: one tool call from a shell.
- `tools/snap_mcp.py`: the same tools as an MCP server, e.g. `claude mcp add comfy-snap -- python3 tools/snap_mcp.py --base-url http://127.0.0.1:8188`.
- `tools/snap_agent_page.sh`: a headless Snap page of the agent's own.
- **Let agents see** in Snap's top bar shares your tab with agents (screenshots); it reads **Agents can see** while on.
  Settings › MAINodes › Snap › Agents run decides whether an agent's renders start at once or wait as proposals for you.
- `describe_recipe` returns the open recipe as an agent sees it; attach its output to bug reports.

## snap-gate (optional)

`snap_gate/gate.py` is a separate sign-in service for shared installs (a family or studio machine). It sits in front of
an unmodified ComfyUI running with `--multi-user` on 127.0.0.1 and gives each account its own work, outputs and inputs,
rating caps (PG / Mature / Adult) on files and outputs, idle locks, and an admin page to rate files (`/gate/admin`).
Started with `--disabled` it relays every byte unchanged. Single-person installs don't need it. Usage is in the header
of `snap_gate/gate.py`; its rules are SNAP-R40 to R49, R56 and R57.

## Known issues

- Cast applied in one shot can leak into later shots: a new shot can inherit earlier shots' characters and pictures
  (F-A17, F-A16).
- Dropping a picture file on References can replace an existing picture (for example the Cast's turnaround) instead of
  adding one (B1).
- There is no tool yet to make set snapshots, location cards or shot cards (F-A09).
- A file written after the page loaded can show a false "missing" chip until the page reloads its file lists.
- Re-take on a tab with unsaved changes opens another tab each time, so tabs stack up.
- More in the [issue tracker](https://github.com/matlowai/ComfyUI-MAINodes/issues).

## How to report

Open a GitHub issue on [matlowai/ComfyUI-MAINodes](https://github.com/matlowai/ComfyUI-MAINodes/issues) with "Snap"
in the title and:

1. what you did (steps, the recipe or setup);
2. what you expected;
3. what happened (error text as shown, the browser console if there is an error);
4. a screenshot;
5. the Snap version: the pack commit (`git -C custom_nodes/ComfyUI-MAINodes rev-parse --short HEAD`) and the `code`
   field of `http://<your ComfyUI>/mainodes/snap/info`;
6. your browser and its version, OS and GPU.

Agents can attach `describe_recipe` output (and `run_status` for a failed run). Leave out pictures, prompts or LoRA
names you don't want public.

## Third-party models and licenses

Snap's cards, kits and methods name the models below. **Snap does not download or redistribute any of these weights.**
The sources are the Hugging Face repos Snap's model graph (`snap_cards/models.json`), kits and methods record; where
the graph records no source, the row says so and gives where the file is published. Every link was checked on
2026-11-05. Licenses are as the source states them (model card metadata or LICENSE file). Several are non-commercial
or carry use restrictions, and a repackaged file keeps the license of the model it came from. **Each model's license is
yours to read and follow before you use it.**

### MiniMax H3 (video with sound)

| model / file family | what Snap uses it for | source | license at the source |
|---|---|---|---|
| MiniMax H3 FL2VA and Ref2VA (pruned int8 convrot, w6a8), Qwen3-VL 32B H3 text encoder, H3 video VAE, H3 audio VAE | the video recipes (first/last frame and reference to video) | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3), original [MiniMaxAI/MiniMax-H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) | MiniMax H3 Community License Agreement (commercial products above 20M USD yearly revenue need written authorization; "MiniMax H3" shown in commercial UIs) |
| Pika H3 Flex LoRAs (FL2VA, Ref2VA) | the recommended render LoRA | [Pika-Labs/Pika-H3-Flex](https://huggingface.co/Pika-Labs/Pika-H3-Flex) (FL2VA also in Comfy-Org/MiniMax-H3) | MiniMax H3 Community License Agreement |
| DMAD 4-step speed LoRA | the "DMAD speed LoRA" preset | [Kijai/MiniMax-H3-experimental](https://huggingface.co/Kijai/MiniMax-H3-experimental) | not stated (H3 derivative: MiniMax H3 license applies) |
| LightX2V 4-step FL2V turbo LoRA (Kijai resize) | turbo pairing for Ripple | [Kijai/MiniMax-H3_comfy](https://huggingface.co/Kijai/MiniMax-H3_comfy) | not stated (H3 derivative) |
| H3 Anti-Burn LoRA | long chains, clips 2+ (Geiru protection) | [Imagineer13/H3-Anti-Burn-LoRA](https://huggingface.co/Imagineer13/H3-Anti-Burn-LoRA) | MiniMax H3 Community License Agreement |
| H3 Ripple LoRA | Change something · Ripple (edit propagation) | [WepeNerd/H3_Ripple](https://huggingface.co/WepeNerd/H3_Ripple) | card points to the MiniMax H3 Community License for the base model's terms |
| Viggle Remake edit / swap LoRAs (and r128) | Change something · Viggle Remake, Recast | [Viggle/Viggle-Remake](https://huggingface.co/Viggle/Viggle-Remake) | MiniMax H3 Community License (card: the LoRAs are a Model Derivative) |
| P-H3-Image (model, text encoder, VAE, LoRA) | H3-based image and edit model | [PrunaAI/P-H3-Image-Comfy](https://huggingface.co/PrunaAI/P-H3-Image-Comfy) | MiniMax H3 Community License Agreement |
| H3 latent upscaler | H3 latent upscale method (not wired yet) | not recorded in the branch; several community uploads exist | see the upload you use |

The Pika H3 Flex Video and Reference to Video **(API)** setups use ComfyUI's Pika partner nodes: the clip renders on
Pika's servers, paid with Comfy credits, and your prompt and pictures are sent to Pika.

### MOSS-Image, Kromoss and Krea 2 (stills)

| model / file family | what Snap uses it for | source | license at the source |
|---|---|---|---|
| MOSS-Image Base and SFT (bf16, int8 convrot), Qwen3.5 9B text encoder | still setups; the encoder also expands prompts | [Comfy-Org/MOSS-Image](https://huggingface.co/Comfy-Org/MOSS-Image) | Apache-2.0 |
| FLUX.2 VAE (`flux2-vae.safetensors`) | MOSS-Image's VAE | [Comfy-Org/flux2-dev](https://huggingface.co/Comfy-Org/flux2-dev) (redirects to Comfy-Org/Flux-2-Dev) | card: FLUX dev non-commercial license |
| MOSS-Image SFT DeBand (int8, plus, fast) | the SFT DeBand setup | local builds, not published; the card names the file only | MOSS-Image license applies to derivatives |
| Kromoss (int8) and its DMD / DMD2 8-step LoRAs | Kromoss setups | [lodestones/Kromoss](https://huggingface.co/lodestones/Kromoss) | Apache-2.0 |
| MOSS-Image SFT 8-step DMD LoRA | turbo for SFT | [lodestones/MOSS-Image-SFT-8-steps-dmd](https://huggingface.co/lodestones/MOSS-Image-SFT-8-steps-dmd) | Apache-2.0 |
| MOSS-Image heal | fine-tune of Base | [KBlueLeaf/MOSS-Image-heal](https://huggingface.co/KBlueLeaf/MOSS-Image-heal) | Apache-2.0 |
| 4-step DMAD adapter LoRA | turbo for SFT | [darask0/MOSS-Image_4-step_adapter_lora](https://huggingface.co/darask0/MOSS-Image_4-step_adapter_lora) | Apache-2.0 |
| colour/depth control adapter | control | [darask0/MOSS-Image-color-depth-control](https://huggingface.co/darask0/MOSS-Image-color-depth-control) | Apache-2.0 |
| MOSS-Image Turbo MFD LoRAs | turbo | [congruency/MOSS-Image-Turbo-MFD](https://huggingface.co/congruency/MOSS-Image-Turbo-MFD) | Apache-2.0 |
| Kijai SFT-delta and 4-step LoRAs | SFT as a LoRA, turbo | [Kijai/MOSS-image_experimental](https://huggingface.co/Kijai/MOSS-image_experimental) | not stated (MOSS-Image derivative: Apache-2.0 base) |
| hires LoHa test | hires detail | [comfyanonymous/MOSS_image_MAX_ULTRA_hires_lora_test](https://huggingface.co/comfyanonymous/MOSS_image_MAX_ULTRA_hires_lora_test) | not stated |
| MOSS-Image Edit HQ (armV5) | the edit step in Ripple / Remake methods | [akhaliq/MOSS-Image-Edit-HQ](https://huggingface.co/akhaliq/MOSS-Image-Edit-HQ) | Apache-2.0 |
| Moss-Image-Edit adapter | edit LoRA | [chinoll/Moss-Image-Edit](https://huggingface.co/chinoll/Moss-Image-Edit) | not stated for the weights; card: project code GPL-3.0 |
| Krea 2 Raw and Turbo, Qwen3-VL 4B encoder, Qwen-Image VAE | Krea 2 setups | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) | Krea 2 Community License |
| Krea 2 community fine-tune, Heretic Qwen3-VL 4B encoder, other local Krea / H3 merges named in the graph | optional variants | not recorded in the branch | see the file's own source |

### Checks, search and upscaling

| model / file family | what Snap uses it for | source | license at the source |
|---|---|---|---|
| SAM 3.1 (`sam3.1_multiplex_fp16`) | finding heads, faces and hair for checks; cropped inpaint masks | not recorded in the model graph; published at [Comfy-Org/sam3.1](https://huggingface.co/Comfy-Org/sam3.1) | SAM License (Meta) |
| DINOv3 ViT-H (`dino_v3_vit_h_bf16`) | the copy check (did a take copy its reference picture's view) | not recorded in the model graph; published at [Comfy-Org/Idol](https://huggingface.co/Comfy-Org/Idol) | repo card Apache-2.0; DINOv3 weights are Meta's [DINOv3 License](https://ai.meta.com/resources/models-and-libraries/dinov3-license) |
| ArcFace IResNet-101, WebFace4M (CVLface) | identity notes on edit candidates (`snap_faces.py`) | [minchul/cvlface_arcface_ir101_webface4m](https://huggingface.co/minchul/cvlface_arcface_ir101_webface4m) | card: cite the paper and follow the training dataset's license (WebFace4M; research use). AdaFace weights are not used. |
| EmbeddingGemma 2 | Library search by meaning (`tools/snap_embedder.py`, its own venv, offline, CPU) | [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2) | Apache-2.0 |
| RelayVSR (X2, X4) | the Upscale brick, 2x / 4x video | [kopper/RelayVSR](https://huggingface.co/kopper/RelayVSR), [lightx2v/RelayVSR_X2](https://huggingface.co/lightx2v/RelayVSR_X2), quantized X4: [MATLOWAI/RelayVSR-X4-Quants](https://huggingface.co/MATLOWAI/RelayVSR-X4-Quants) | weights repos: not stated (Quants card: Apache-2.0); code [kopperx/RelayVSR](https://github.com/kopperx/RelayVSR) Apache-2.0; runs through [LightX2V](https://github.com/ModelTC/LightX2V) (Apache-2.0) |
| SeedVR2 | still upscaling method (not wired yet) | not recorded in the branch; published at [Comfy-Org/SeedVR2](https://huggingface.co/Comfy-Org/SeedVR2) | Apache-2.0 |
| LTX-2 spatial upscaler x2 | LTX latent upscale method (not wired; no LTX recipe yet) | not recorded in the branch; published at [Lightricks/LTX-2](https://huggingface.co/Lightricks/LTX-2) | LTX-2 Community License Agreement |
| 4x-UltraSharp | still upscaling (ESRGAN family) | [Kim2091/UltraSharp](https://huggingface.co/Kim2091/UltraSharp) | CC-BY-NC-SA-4.0 |
| 4x-AnimeSharp, 2x-AnimeSharpV4 RCAN | anime upscaling | [Kim2091/AnimeSharp](https://huggingface.co/Kim2091/AnimeSharp), [Kim2091/2x-AnimeSharpV4](https://huggingface.co/Kim2091/2x-AnimeSharpV4) | CC-BY-NC-SA-4.0 |
| 4x NMKD-Siax 200k | photo detail | [peonybun/4x_NMKD-Siax_200k](https://huggingface.co/peonybun/4x_NMKD-Siax_200k) (community re-upload) | not stated |
| RealESRGAN x2plus, x4plus anime 6B | upscaling | [hlky/RealESRGAN_x2plus](https://huggingface.co/hlky/RealESRGAN_x2plus), [hlky/RealESRGAN_x4plus_anime_6B](https://huggingface.co/hlky/RealESRGAN_x4plus_anime_6B) | not stated at the re-upload; original [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) is BSD-3-Clause |

The AST AudioSet tagger is not referenced on this branch.

### Third-party node packs

Snap's methods can use these packs when installed. Snap reads them generically and installs nothing.

| pack | what it unlocks | source | license |
|---|---|---|---|
| Geiru context suite (roycho87) | protected long chains: keystone frames, late lock, context noise, Anti-Burn. Its protection node's default option downloads the Anti-Burn LoRA; pick the local file by name to avoid that. | [roycho87/geiru_context_suite](https://github.com/roycho87/geiru_context_suite) | GPL-3.0 |
| MaskVidExperiments (drozbay) | cropped inpaint: re-render one face or subject in a mask and paste it back | [drozbay/MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments) | GPL-3.0 |
| ComfyUI-Viggle-Remake (Viggle) | Viggle Remake and Recast conditioning | the `comfyui/ComfyUI-Viggle-Remake` folder of [Viggle/Viggle-Remake](https://huggingface.co/Viggle/Viggle-Remake) | Apache-2.0 (code) |

### Notices

- `snap_faces.py`: `IRBlock` / `IResNet101` follow the IResNet of insightface's arcface_torch
  ([deepinsight/insightface](https://github.com/deepinsight/insightface); code MIT, its training data and models trained
  on it non-commercial research only) in the key layout [CVLface](https://github.com/mk-minchul/CVLface) (MIT) saves.
- `dials/` is the Dial Rack, ported from this author's [ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials).
- Vendored browser libraries (mp4-muxer, webm-muxer, MIT) are listed in [`../../web/vendor/README.md`](../../web/vendor/README.md).
- MAINodes itself is GPL-3.0-or-later (see [`../../LICENSE`](../../LICENSE)).
