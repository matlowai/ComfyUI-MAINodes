# Research code

The scripts behind the [experiments](../experiments/). They are research tools, published as they were used (paths
made portable), not polished nodes. Run the Python ones from the **ComfyUI root** unless a script says otherwise.

| script | what it does | used by |
|---|---|---|
| `dials_word_dial.py` | word dials from word lists: `--method logit` (logit lens) or `--method jlens` (Jacobian lens via the upstream Qwen3-VL tail); see [word_dials](../word_dials/README.md) | J2, J3 |
| `dials_token_audit.py` | re-encodes a dial's pairs exactly as Make Dial does; per-token norms and shares; `--save-variants` writes pooling variants | T1, T2/T3 |
| `dials_wheel_vs_renders.py` | colour temperature, darkness, contrast, motion and texture of a clip vs its control; probe profile vs render | wheel check, T4, T5 |
| `dial_dialogue_wer.py` | Whisper word error rate of a clip's speech against the script | speech survival |
| `mint_dials_arms.py` | writes text-to-video API graphs (MAINodes Simple example) for any set of rack rows | most render experiments |
| `mint_dials_t5_masks.py` | image-to-video, weak first-frame pin (H3 Cond Strength), Ref2V reference arms | T5-T5f |
| `mint_dials_evil_sweep.py`, `mint_dials_x_sweep.py`, `mint_dials_placebo_sweep.py` | the overnight sweeps | overnight log |
| `mint_dials_new1106_make.py` | one API graph that makes the experimental `h3_x_*` dials with Make Dial from `../pairs/new1106/` | overnight log |
| `make_dials_lab_page.py` | builds the [Dials Lab](https://matlowai.github.io/ComfyUI-Dials/lab.html) page | Lab |
| `contact_sheet_rows.sh`, `contact_grid4.sh` | contact sheets (ffmpeg) | every verdict |
| `dialslab_masked_node/` | a small node: apply one dial to all rows or text rows only (copy the folder into `custom_nodes/`) | T5 |

The `mint_*` scripts write ComfyUI **API graphs** to `$DIALS_WORKFLOWS` (default `./workflows`); post them to ComfyUI's
`/prompt` endpoint with any client. (We launch ours through a private queue helper that also guards output-name
collisions; the logs mention it as `queue_scene.py`.) They use the model file names of our setup
(`minimax_h3/...`); edit them for yours. `dials_wheel_vs_renders.py` reads dials from `$DIALS_DIR`
(default `models/loras/dials/`). `dials_word_dial.py` takes the upstream tail with `--tail` or `$QWEN3VL_TAIL`.
