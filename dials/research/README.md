# Dials research

Open, in-progress research on Dials: training-free steering vectors for MiniMax H3 made from prompt pairs. This folder
holds findings, the running plan, and one write-up per experiment. Things here are measured on few seeds and few
scenes unless a page says otherwise; they move into the main [README](../README.md) or [LESSONS](../LESSONS.md) once
they hold up.

| page | what |
|---|---|
| [PLAN.md](PLAN.md) | the goal, the experiment queue with gates, and the revision log. Start here |
| [2026-11-06-overnight-findings.md](2026-11-06-overnight-findings.md) | villainy pack on Pika, size-matched placebos, speech survival, experimental dials, a two-dial painting, probe profiles vs renders |
| [2026-11-06-external-ideas.md](2026-11-06-external-ideas.md) | ideas from control-vector / steering work elsewhere, checked against our measurements, with sources |
| [2026-11-06-synthesis.md](2026-11-06-synthesis.md) | what our other H3 research (conditioning, timing, AdaLN, taps, audio) says about Dials, contradictions fixed, new plan nodes |
| [2026-11-06-jlens-ideas.md](2026-11-06-jlens-ideas.md) | the Jacobian lens: ways to make dials from word lists, read dials and activations, and the encoder constraint (proposed) |
| [experiments/](experiments/) | one page per experiment as results come in |
| [word_dials/](word_dials/README.md) | **try it**: 12 dials made from four words each (Jacobian lens), with a placebo, and how to make your own |
| [code/](code/README.md) | the scripts behind every experiment (word dials, token audit, metrics, render graphs, a masked-dial test node) |
| [pairs/new1106/](pairs/new1106/) | the prompt pairs of the experimental `h3_x_*` dials |
| [logs/](logs/README.md) | raw working logs and measurement JSONs, chronology included |

Clips: [Dials Lab](https://matlowai.github.io/ComfyUI-Dials/lab.html). Dials: [H3-Dials on Hugging Face](https://huggingface.co/MATLOWAI/H3-Dials).

## Status labels

Every claim carries one of: **measured** (with seeds and scenes), **source-confirmed** (read in code or a paper),
**proposed**, or **rejected**. Numbers always come with their seed count.

## Credits

Ideas here borrow openly from people working on the same thing from other directions:
[fredbliss](https://github.com/fblissjr)'s H3 control vectors ([guide](https://github.com/fblissjr/ComfyUI-h3-explorations/blob/main/docs/wiki/control_vectors.md):
span pooling, vision-row and dialogue masks, norm-matched application, jacobian-lens experiments), JohnDopamine's
audio-push experiments, [Heretic](https://github.com/p-e-w/heretic), and [DeTangle](https://github.com/matlowai/DeTangle).
