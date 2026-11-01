> **Pulled into MAINodes 2026-10-31.** Written against ComfyUI-Dials; the Dials work now happens here (`dials/`). Already in
> MAINodes when this was pulled in: per-dial info in the dial file (description, side labels, useful/overcook; the
> ⚙ editor), presets that hash the vector, the rack map with ellipses and an overlap/push readout, and the rack report's
> pairwise cosines. Status and order of the rest: `dials/ROADMAP.md`, "Interaction atlas".

# MATLOWAI Dials — Interaction Atlas, Calibration & Future SAE Roadmap

**Coding-agent handoff / technical design / research roadmap**  
**Prepared:** 2026-10-31  
**Status:** Proposed; no repository changes made by this handoff  
**Project:** [matlowai/ComfyUI-Dials](https://github.com/matlowai/ComfyUI-Dials)  
**North star:** Make tiny, training-free concept dials *composable, interpretable and self-explanatory*—without turning every render into a diagnostic job.

> **Instruction to the coding agent:** Treat this as a design brief and implementation plan, not as proof that any proposed metric predicts quality. Inspect the *current local checkout* and pin its commit before changing code. Make backward-compatible, measured changes, implement the initial release, and leave expensive research as optional, well-isolated work. Record any departures from this plan in an ADR or `docs/decisions.md`.

---

## 0. Executive decision

**Ship a lightweight Interaction Atlas first, not an SAE.** The best initial system combines:

1. **Exact vector mathematics and provenance:** pairwise cosine/signed reinforcement/cancellation, stack composition, and truthful model-space compatibility.
2. **Per-dial metadata + normalization:** an **ⓘ info button**; measured or creator-provided positive/negative useful ranges; model-/pipeline-specific calibration; no silent rescaling of the actual dial strength.
3. **A curated semantic probe atlas:** 16–24 high-confidence primary axes initially, expandable to 32–64 deliberately constructed bipolar concepts. Compute one-time per-dial profiles and combine them instantly.
4. **An excellent visualization:** a ragged/radar/rose **influence wheel** whose angles denote *labeled semantic probes*, plus a compact **pairwise overlap matrix** and a “who contributed?” inspector. Green/yellow/red should mean *calibrated* behavior, not unvalidated vector magnitude.
5. **Optional offline experiments:** deeper calibration, prompt-aware pre-refiner response analysis, later a shared H3-specific SAE and actual denoiser-interaction tests.

**Key rule:** *“Shared direction” is not “shared meaning,” and neither is “verified clash.”* The interface must communicate which has been established.

**Non-goals for v1:** training an SAE, claiming reliable LoRA-clash detection from cosine, automatically inventing arbitrary semantic names, adding any Qwen/DiT passes during ordinary sampling, replacing the existing `.safetensors` format, and automatically adjusting user strengths.

---

## 1. Origin and product vision: what we are trying to communicate

The design started from an intuitive observation in Discord:

- Some concept dials barely activate until roughly **+5**; others become excessive around **+1.5**. A raw strength number is therefore a poor *common visual scale*.
- One dial can influence several apparently unrelated dimensions. Two different dials can overlap in one dimension, even when they are otherwise independent; multiple modest dials may push a shared dimension much harder than intended.
- We want a **green donut / jagged frontier / ragged radar ring**. Each concept has a shape around a circle. Add dials, watch contributions superimpose, and see where the combination becomes concentrated or *potentially* overcooked.
- The UI should also answer: **“Which dials caused this spike? Are they reinforcing, canceling, or producing opposing effects? Have we ever measured this as a failure?”**
- It should be comprehensible to casual ComfyUI users: no interpretability jargon required for normal use; the advanced details belong behind an info affordance.

### Product experience we want

A person drags a motion dial and a sinister-atmosphere dial into a stack. The app displays their two distinct colored footprints. A third dial adds darkened environments, increasing the *darkness* sector while not necessarily affecting motion. Hovering over that sector shows a signed contribution breakdown. If that model/pipeline has tested calibration for darkness or the specific combination, the sector may show a limit; otherwise it says **Uncalibrated**, not a fabricated red warning. At all times the user's real ComfyUI slider values remain unchanged.

The *long-term dream* is a portable, community-wide feature atlas for H3 and potentially other video models: users make tiny dials, get intelligible descriptions and interaction fingerprints, run optional diagnostic experiments, and eventually compare their steering against LoRAs and other conditioning interventions. An SAE could deepen the atlas, but the user-facing contract should not depend on one.

---

## 2. Verified code and model facts (reviewed on `main`, 2026-10-31)

Primary links:

- [ComfyUI-Dials `nodes.py`](https://github.com/matlowai/ComfyUI-Dials/blob/main/nodes.py) — actual implementation; inspect latest before editing.
- [ComfyUI-Dials `README.md`](https://github.com/matlowai/ComfyUI-Dials/blob/main/README.md) — published behavior, tested strengths and caveats.
- [ComfyUI MiniMax model code](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/model.py) — model and conditioning path.
- [ComfyUI MiniMax text encoder](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/text_encoders/minimax.py) — H3 uses a truncated Qwen3-VL-32B text/vision conditioning setup.
- [Official H3 reference config](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/transformer_ref/config.json) — `text_dim=5120`, `hidden_size=5376`, 2 refiner blocks.

### Actual conditioning path

```text
Text / supported multimodal conditioning
  -> H3 Qwen3-VL conditioning (5120-dimensional output)
  -> H3 condition_proj (5376-dimensional)
  -> H3 token_refiner (2 blocks, 5376-dimensional)
  -> [DEFAULT post_refiner dial vector injected on output]
  -> H3 diffusion transformer / audiovisual generation
```

The **post-refiner** path is the default. `ShiftedForward` wraps `token_refiner.forward` using a ComfyUI ModelPatcher object patch and adds the vector to its output. With compatible post-refiner dials, the intervention itself is a sum of vectors in one shared space.

The **pre-refiner** path applies a vector as a `condition_proj` bias delta (`diff_b` LoRA file), then the nonlinear token refiner processes the result. Pre and post directions are **not interchangeable**. Even when two pre-refiner input vectors sum exactly, their post-refiner effect can vary with the prompt.

### What `MakeDial` actually produces

- Prompt pairs `A ||| B` (optionally expanded over subjects) are encoded with `clip.encode_from_tokens_scheduled`.
- Differences are computed between **token-mean** projected/refined representations, averaged across pairs.
- Optional debias removes nuisance directions constructed from hard-coded nuisance pairs using SVD.
- `calibrate` is **pre-refiner signal rescaling only**, *not* a perceptual/overcook calibration.
- The resulting `DIAL` is roughly a 5376-component vector, the target/mode, and metadata (`name`, `pairs`, `n_pairs`, `pair_agreement_cos`, `inject`, `debias_removed`, `calibrated`, format string).
- `save_dial` writes **one BF16 tensor** to a `.safetensors` file and serializes metadata values as strings. `LoadDial` reads them back. Support the old one-tensor format.
- `ApplyDial` currently does not emit a structured registry of all active dials on a patched MODEL.
- `CombineDials` calculates a cosine and constructs `weight_a * a + weight_b * b`; optional `orthogonalize` removes `b`'s direction from `a` **before** combining. Its saved metadata currently carries parent *names*, but not a complete reproducible expression tree with weights, vector hashes, orthogonalization and provenance.
- There are no existing semantic probe dictionaries, semantic labels, measured angle-wise boundaries or overlap visualizations in the reviewed code.
- The repository exposes five nodes: Make, Apply, Load, Combine, Save; package currently declares no extra Python dependencies.

### Existing real-world evidence is already valuable

- H3 base motion dial: published six-prompt seed-matched test reports roughly **2.7×** baseline motion at +2, **0.05×** at −2.
- Pika H3 Flex motion: a **single** prompt/seed sweep reports +0.5/+1 remain useful, whereas +1.5 to +2 can restage/morph and +3 loses prompt adherence. This is *not* a universal overcook boundary.
- `h3_evil_sinister` can degrade dialogue at +2 in a documented two-line test; `h3_evil_seductive` did not in that limited test. Quality has multiple axes, so a single green circle cannot encode every failure mode.
- Other dials cluster by cosine (e.g., sinister/cold, creepy/dread) while motion is close to orthogonal to the villainy pack. That suggests cosine is useful, but it misses local overlap on a chosen semantic axis.

**Implementation implications:** preserve separate model/pipeline calibration; store evidence quality and sample size; distinguish model-space metrics from output-quality metrics; build the new analyzer as an additive capability rather than modifying H3 inference.

---

## 3. Options, trade-offs and scored prioritization

**Scoring method:** every axis rates from 1 (bad) to 10 (good). The weighted overall score is **25% practical value + 25% measurement validity + 15% low render-time overhead + 15% development speed + 10% low offline compute + 10% future extensibility**. Scores are *engineering judgments for this project*, not published benchmark numbers. A method can score highly for usefulness without establishing semantic or causal truth. Order is a proposed delivery priority, not a scientific ranking.

| Option | Value | Validity | Runtime | Dev speed | Offline cost | Extensible | Weighted /10 | Recommendation |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A. Metadata, model-space identity, provenance | 10 | 10 | 10 | 8 | 10 | 10 | **9.70** | **P0 foundation** |
| B. Exact overlap matrix + signed vector arithmetic | 9 | 9 | 10 | 9 | 10 | 9 | **9.25** | **P0 ship** |
| C. Manual/assisted per-dial strength calibration | 10 | 9 | 10 | 8 | 6 | 9 | **8.95** | **P0/P1 ship** |
| D. Curated semantic reference directions | 10 | 7 | 10 | 7 | 7 | 10 | **8.50** | **P1, recommended core** |
| E. Ragged influence wheel + contributions inspector | 9 | 7 | 10 | 7 | 10 | 9 | **8.45** | **P1 ship with D** |
| F. Render-based outcome/calibration suite | 10 | 9 | 10 | 4 | 1 | 9 | **7.85** | **P2 optional batch** |
| G. Automated, larger contrast-label search | 8 | 6 | 10 | 5 | 6 | 9 | **7.25** | **P2 exploration** |
| H. Shared, offline H3-specific SAE | 9 | 5 | 10 | 3 | 2 | 9 | **6.55** | **Research, not prerequisite** |
| I. Prompt-aware analysis of pre-refiner transformations | 7 | 8 | 6 | 4 | 4 | 8 | **6.45** | **P2 targeted** |
| J. Denoiser nonlinear-interaction probes | 8 | 7 | 3 | 3 | 2 | 8 | **5.65** | **Research, selective diagnostics** |

### A. Structured metadata and provenance — 9.70/10

**Pros:** tiny, fast, enables every other feature, prevents misleading saved combinations, preserves user choices and dial identity. **Cons:** not visually exciting; requires careful migration and serialization tests. **Do:** first. Add stable vector identity/hash, model-space and optional model fingerprints, creator-set calibration windows, probe-atlas version, structured composition tree and evidence source. Do not make legacy files unloadable.

### B. Vector overlap / matrix / cancellation — 9.25/10

**Pros:** mathematically exact within a compatible vector space; cheap CPU computation; does not require a model or generation; catches reinforcement/cancellation hidden by global names. **Cons:** global cosine alone cannot explain behavior, does not know semantic labels or output quality. **Do:** ship as the first real analyzer, and keep it available even without a semantic dictionary.

### C. Per-dial calibration — 8.95/10

**Pros:** directly solves +5-vs-+1.5 and the green-donut problem; allows creator metadata immediately; no render-time cost. **Cons:** single-dial boundaries do not automatically predict combination limits; different presets/prompts/seeds may produce different limits. **Do:** initial manual entry + optional attach-evidence workflow, then automated calibration. Never conflate the old pre-refiner `calibrate` flag with this feature.

### D. Curated semantic probe atlas — 8.50/10

**Pros:** compatible with the way dials are made; fast once shared probes exist; interpretable, versionable, doesn't need SAE training; allows local overlaps despite low global cosine. **Cons:** labels depend on carefully chosen pairs; correlated axes double-count; important characteristics may be unprobed; not causal proof. **Do:** start with small, audited, bipolar H3 post-refiner atlas.

### E. Jagged influence wheel — 8.45/10

**Pros:** the distinctive, friendly, memorable feature; makes partial overlap visible; natural hover and per-dial explanation. **Cons:** radial geometry can imply fake precision, 64 labels are unreadable, green/red invites unwarranted quality claims. **Do:** a fixed-angle 12–16-sector overview plus drilldown, **paired** with an exact matrix and uncertainty labels.

### F. Empirical output-calibration harness — 7.85/10

**Pros:** the most credible basis for calling something overcooked; tests real motion, speech, prompt adherence, identity continuity, etc. **Cons:** high offline GPU cost, noisy automatic metrics, evaluation-set dependence, no guarantee on unseen prompts. **Do:** optional short, seed-matched evaluation batches; publish evidence quality, not a universal guarantee.

### G. Automated contrast dictionary — 7.25/10

**Pros:** may expand descriptive coverage beyond hand-selected axes without training an SAE; compatible with existing Make Dial pipeline. **Cons:** thousands of generated contrast pairs can be redundant, contradictory, or spuriously labeled; expensive encoder passes to construct and validate. **Do:** after 16–64 curated probes are shown insufficient. Use curated probes as anchors, deduplicate and validate on held-out subjects.

### H. Shared community SAE — 6.55/10 now, potentially higher later

**Pros:** can discover unfamiliar features and co-activations, provide a common feature ID scheme, and be published once for the entire community. **Cons:** considerable activation-collection/training/validation work; feature labels are not guaranteed; prompt-dependence, seed instability, coverage gaps; a feature isn't an overcook score. **Do:** architect the pluggable atlas now, defer training.

### I. Prompt-specific pre-refiner analysis — 6.45/10

**Pros:** accounts for nonlinear refiner reshaping and variant/strength differences. **Cons:** needs model access and representative prompts; defeats a purely offline analyzer; cannot make a prompt-independent universal chart. **Do:** separate optional path with an explicit *prompt-specific* badge.

### J. Denoiser interaction probes — 5.65/10 now

**Pros:** tests actual nonlinear response (and eventually LoRAs); might identify combinations whose effects are not additive downstream. **Cons:** DiT evaluation is expensive; “interaction” may be benign and is not an automatic visual-quality verdict; cannot replace render validation. **Do:** research-only Deep Analyze.

**Decision:** A+B+C first, D+E next, then F/G. Keep H/I/J behind an explicit research flag.

---

## 4. The mathematics we should actually compute

Let the active compatible post-refiner dials be `v_i ∈ R^5376` with real signed strengths `s_i`. Always use **the effective vectors after any orthogonalize/combination operation**, not only the original parent vectors.

### 4.1 Exactly known in the default post-refiner space

```text
combined_shift = Σ_i s_i * v_i
cos_ij = dot(v_i, v_j) / (||v_i|| * ||v_j||)
pair_interaction_ij = s_i * s_j * dot(v_i, v_j)
||combined_shift||² = Σ_i s_i² ||v_i||² + 2 Σ_{i<j} pair_interaction_ij
```

- `pair_interaction > 0` = **reinforcement** in vector energy; `< 0` = **cancellation**; `= 0` = no global dot-product interaction.
- Negative strengths reverse signs. Show signed and absolute magnitudes, not just cosine.
- A high total norm is **not** a proven failure. Call it *combined steering energy* rather than overcook.
- Zero-norm vectors and tiny denominators must produce *undefined/neutral*, not NaN. The current optional orthogonalization in `CombineDials` divides by `vb @ vb`; fix/test the zero-vector case while working in this area.
- If analysis shows source contributions to a saved combination, account for the precise transformation tree, including orthogonalization, to avoid incorrect attribution.

**Important subtlety:** two globally orthogonal dials can both push the same probe positively while canceling elsewhere. The pairwise cosine matrix and the semantic view answer complementary questions.

### 4.2 A deliberately constructed semantic probe dictionary

Let `p_j` be a reference vector made from carefully controlled `A_j -> B_j` prompt pairs using the **same injection space**. Keep its positive/negative label, model compatibility, quality, version and evidence.

For a quick **probe-equivalent coefficient**:

```text
alpha_ij = s_i * dot(v_i, p_j) / max(dot(p_j, p_j), epsilon)
combined_alpha_j = Σ_i alpha_ij
```

This says “how much of reference probe `j` is present in the signed steering projection?” It **does not** prove that the output actually has that amount of a visible/audio characteristic. If the interpretation should instead be a cosine affinity, compute and label it separately; do not substitute cosines for additive contributions.

**Problem:** ordinary semantic probes are correlated. If `darkness`, `contrast`, `low-key lighting` and `menace` overlap, projecting onto all of them can draw four impressive spikes for substantially one underlying component. Support both:

- **Direct affinities** (easy to explain, not independent); and
- **Joint, regularized coefficients** via a fixed, versioned ridge regression / decomposition against the dictionary, with documented scaling and diagnostics.

For a probe matrix `P=[p_1,...,p_k]`, an optional joint fit:

```text
beta = (PᵀP + λI)^−1 Pᵀ v
v_explained = P beta
residual_fraction = ||v - v_explained|| / max(||v||, epsilon)
```

Tune `λ` on held-out contrast pairs; warn when probe condition number is high. This is a *linear approximation* of the vector, not an independent partition of human meaning. Show the unexplained fraction (and its uncertainty) prominently; do not claim “80% semantically explained” merely because numerical variance is captured. Inspect both fit and held-out behavioral validity.

### 4.3 Pre-refiner is a separate universe unless measured

For pre-refiner vectors, analyze their **input**-space combination exactly and label it *pre-refiner overlap*. For output effects:

```text
post_effect(prompt, s, v) = mean_tokens(refiner(pre(prompt) + s*v))
                           - mean_tokens(refiner(pre(prompt)))
```

This depends on prompt, strength and refiner state. Measure via representative prompt evaluations if requested. Do **not** silently mix pre and post vectors or project them onto a post-refiner probe bank. If users load a pre-refiner dial through the stock LoRA loader, the analyzer cannot assume it can reconstruct that active stack from `ApplyDial` calls; provide explicit stack registration/import or declare the stack incomplete.

### 4.4 Distinguish overlap, opposition, unknown and bad outcomes

| UI statement | Minimum evidence | Safe label |
|---|---|---|
| Two dials point the same way globally | Compatible vectors + cosine/dot | **Reinforcing** |
| Opposing global vector shifts | Compatible vectors + signed dot | **Canceling** |
| Both align with a labeled probe | Validated probe direction + projections | **Shared probe affinity** |
| The combination passes a threshold | Per-pipeline calibration of matching quantity | **Above measured/estimated range** |
| A combination causes actual defects | Controlled output evaluation (with examples) | **Observed degradation** |
| Two LoRAs interfere | Controlled downstream evaluation | **Observed/model-response interaction** |

Never color the last three as confirmed based only on the first three.

---

## 5. Strength normalization and the green donut

The user specifically wants different dials' visual sizes to be comparable, even though a useful dial may start at +5 or overcook at +1.5.

### 5.1 Store *distinct* thresholds; don't make a magical scalar

Per model/preset, allow optional:

- **Positive onset:** earliest *reliably noticeable* effect for positive steering.
- **Positive recommended band:** `[recommended_min, recommended_max]`.
- **Positive observed overcook boundary** or a confidence interval, if there is evidence.
- Separate **negative** onset, recommendation, and observed boundary (asymmetric behavior is normal).
- **Failure categories:** prompt drift, speech intelligibility, motion restaging, identity drift, color clipping, temporal instability, etc.
- **Calibration provenance:** creator heuristic vs single-example observation vs multi-scene empirical test, dates, prompts/seeds, model/pipeline fingerprint, metrics and sample count.
- **Unknown** is a first-class value (`null`, not zero).

Use a signed normalized *display-only* position **when the relevant boundary exists**:

```text
raw strength s is NEVER altered by the visualizer.
if s > 0 and trusted positive limit L+ > 0: display_ratio = s / L+
if s < 0 and trusted negative magnitude L- > 0: display_ratio = s / L-
otherwise: display_ratio = unknown; show raw strength.
```

This gives an intuitive *per-dial* fraction of its tested range. It is **not** a valid per-angle safe boundary for a combined stack.

### 5.2 Distinguish individual-dial range from stack-region range

Proposed visual encoding:

- **Raw influence shape:** display signed combined probe coefficients / affinities, with a transparent scale legend.
- **Gray/dashed envelope:** unknown threshold / uncalibrated. This is the default for new probes and combinations.
- **Green band:** only where the exact quantity and relevant pipeline have calibrated useful bounds.
- **Amber:** approaching measured/estimated bound; mark **estimated** when derived from a heuristic.
- **Red protrusion:** exceeds a **documented** range on a comparable measure (or a direct experimentally observed failure), and includes an explanation.
- **Blue/purple/etc.**: individual dial contributions, deliberately distinct from risk coloring.

Initially, a fully calibrated green/red *per-angle* overcook frontier probably **does not exist**. Show a useful uncalibrated influence wheel plus **separate per-dial normalization arcs** and a risk panel. Earn angle-specific risk contours via later empirical outcome calibration. Avoid summing arbitrary normalized dial limits and claiming a combined angle is overcooked.

### 5.3 Model/preset identity matters

Examples of separate contexts:

- MiniMax H3 base, particular code/checkpoint.
- Pika H3 Flex and its exact LoRA version/weight, sampler and step schedule.
- Specific audio/video workflows where a metric is valid.

A single-dial test in one configuration must not silently become a universal recommended maximum for every configuration. Store `applicable_models`, `pipeline_key`, `model_fingerprint`, `evidence_scope` and `confidence`. When a preset is unknown, **calibration unavailable** is better than pretending it transfers.

---

## 6. UX specification: Influence Wheel + Matrix + Inspector

**Make the cool ragged-edge idea real, but accountable.** This is a model-influence viewer, not a literal map of model intelligence.

### 6.1 Main view

```text
┌───────────────────────────────────────────────────────────────────────┐
│  MatlowAI Dials                                      [ⓘ] [Analysis] │
│                                                                       │
│  Active stack                Combined influence     Interactions     │
│  ────────────                ──────────────────     ────────────     │
│  Motion         +1.00       (radial rose/radar)     [A × B matrix]   │
│  Sinister       +1.50       fixed angular labels    [who pushes?]    │
│  Color Satur.   +0.60       colored per-dial layers [confidence]     │
│                                                                       │
│  ───────────────────────────────────────────────────────────────────  │
│  Highlighted sector: DARKNESS   |   state: UNCALIBRATED              │
│  Contributions: sinister +0.74, color +0.10, motion -0.02           │
│  Method: reference-probe affinity • Atlas v1 • Not an outcome test  │
│                                                                       │
│  [Vector math] [Semantic map] [Calibration] [Deep Analyze (later)]  │
└───────────────────────────────────────────────────────────────────────┘
```

Values in this mock wireframe are fictional.

### 6.2 Angular semantics

- Use **fixed** angles to stop the wheel rotating unpredictably as a stack changes. Suggested top-level groups: motion/camera, lighting/color, materials/detail, subjects/faces/expression, scene/composition, mood/narrative, speech/audio. Begin with 12–16 *visible* sectors; drill down into 32–64 sub-probes. The first examples are proposals, not established H3 latent categories.
- For bipolar dimensions, negative movement must not get silently hidden by a positive-only radius. Use a **clearly signed split track**, outward/inward encoding with a visible zero baseline, or a `+ / − / both` toggle. Test comprehension with examples.
- A ragged contour should reflect **actual measured probe values** at known angles, with restrained interpolation for aesthetics only. Avoid interpolating so aggressively that fictional features appear between probes.
- For correlated probes, mark the family grouping and optionally switch between `direct affinities` and `joint-fit explanation`.
- Hover/click an angle to show **per-dial signed contributions, cancellation, probe definition, evidence, residual/unexplained warning and any applicable calibration**.
- Pairwise matrix: red/blue or warm/cool **interaction magnitudes**, with legend for signed reinforcement/cancellation, separate from defect-risk colors. Respect color-blind modes and use labels/patterns.

### 6.3 Information button and provenance

Every dial row gets **ⓘ** with:

`Name / A -> B concept / full or summarized source pairs / mode / target / pair agreement / debias / creation provenance / current raw strength / optional calibrated positive and negative windows / known failure categories / model and probe-bank version / last analysis / unknowns`.

The stack inspector shows the *effective* saved `CombineDials` expression and **original vs effective** components after orthogonalization. It must identify when the actual running stack is only partially known (e.g., pre-refiner dials applied via stock LoRA loading, or unsupported model patches).

### 6.4 UX language policy

**Good:** “These dials reinforce the darkness probe. Estimated combined affinity +1.9; output quality untested.”  
**Bad:** “92% chance of bad visuals,” “This will overcook,” “These are the 64 true concepts inside H3.”

**Good:** “Sinister at +2 impaired speech in one published two-line test.”  
**Bad:** “Sinister always breaks audio at +2.”

Use *measured*, *estimated*, *creator-set*, *unknown* and *exploratory* labels consistently.

---

## 7. Proposed schema and compatibility strategy

The existing `.safetensors` payload is one tensor and metadata strings. Preserve that shape. Make the enriched analysis optional and readable by both old and new versions. Prefer **a small versioned `analysis_v1` JSON metadata entry** for stable, portable data and **optional `.analysis.json` sidecars** for large evidence, plots or per-seed records. Sidecars must be clearly derived and regenerable; no extra 100 MB dependencies just to load a 14 KB dial.

**Illustrative schema (values are examples, not measurements):**

```json
{
  "schema_version": 1,
  "dial": {
    "id": "sha256:PLACEHOLDER_VECTOR_HASH",
    "name": "sinister",
    "mode": "post",
    "target": "token_refiner",
    "space_id": "h3-post-refiner-5376-v1",
    "model_fingerprint": null
  },
  "composition": {
    "kind": "primitive",
    "expression": null
  },
  "semantic": {
    "bank_id": "h3-curated-probes-v1",
    "method": "direct_probe_equivalent_projection",
    "scores": {"darkness": 0.61, "menace": 0.83},
    "residual_fraction": null,
    "evidence": "unvalidated_example"
  },
  "calibration": [
    {
      "pipeline_key": "h3-base-example",
      "positive": {
        "onset": null,
        "recommended": [null, null],
        "observed_limit": null
      },
      "negative": {
        "onset": null,
        "recommended": [null, null],
        "observed_limit": null
      },
      "evidence_kind": "uncalibrated",
      "n_prompts": 0,
      "n_seeds": 0,
      "failure_metrics": []
    }
  ]
}
```

**Agent note:** Replace the placeholder `id` string with a correct deterministic SHA-256 of canonical identity (e.g., tensor bytes + target/mode + method identifier), not an arbitrary filename. Define and test hashing rules, precision/serialization, and model-space compatibility explicitly. A semantic profile made for bank v1 must **not** be silently displayed as if it were bank v2. Do not assume version names alone prove checkpoint compatibility.

### Composition expression tree

```json
{
  "kind": "combine",
  "weight_a": 1.0,
  "weight_b": -0.5,
  "orthogonalize_a_against_b": true,
  "a": {"kind": "primitive_ref", "dial_id": "sha256:..."},
  "b": {"kind": "primitive_ref", "dial_id": "sha256:..."},
  "effective_vector_hash": "sha256:..."
}
```

The effective saved vector remains authoritative; a missing parent file should not break the dial or require downloading it. Provenance gives attribution only when parent content/hashes are available; show *partial provenance* otherwise. Do not silently override or mutate the original source files.

**Compatibility requirements:** old files load and run identically; metadata is optional; analysis errors never block rendering; model-target mismatch remains an error for actual combination; untrusted metadata is validated and never treated as code, paths or permission to fetch remote assets.

---

## 8. Implementation plan / coding-agent tasks / acceptance gates

### Phase 0 — Repository discovery, guards and baselines

**Inspect:** `nodes.py`, `__init__.py`, README, all existing example workflows, current ComfyUI custom-node extension conventions and test capabilities. Pin exact local commit. Read the ComfyUI frontend custom-extension docs rather than guessing current APIs. Confirm 5376 dimensions in tested H3 build. Run existing workflows or write smoke tests, with exact output comparison at unchanged strength.

**Deliver:** `docs/INTERACTION_ATLAS_SPEC.md` (can adapt this handoff), a small ADR defining vector spaces and calibration semantics, a `tests/` baseline that exercises load/save/make/combine/apply behavior without requiring H3 for pure math tests, and a compatibility report.

**Pass:** no sampling behavior change and no new required dependency for ordinary usage.

### Phase 1 — Exact analyzer and provenance (P0)

1. Create a **pure Python analysis layer** separated from ComfyUI node glue, e.g. `dials_analysis/vector_math.py`, `identity.py`, `schema.py`, `stack.py`.
2. Implement norms, vector fingerprints, cosine/Gram matrix, signed pairwise energy contributions, effective sum, cancellation/risk-neutral concentration statistics and diagnostics. Support BF16 source tensors but calculate analysis in FP32/FP64 as appropriate.
3. Preserve an exact composition expression in `CombineDials`, including weights and orthogonalization, plus parent hashes when known. Fix zero-vector division and mismatched-shape handling.
4. Provide an **Analyze Dial/Stack** node or equivalent non-intrusive API that can accept explicit loaded dials/weights. Do not assume the `MODEL` object reveals every externally applied LoRA/dial. Separate vector analysis from inference-time injection.
5. Export a **structured machine-readable report** for front-end use and a human-readable summary; don't force parsing prose.
6. Add migration tests for legacy safetensors + old workflows, and tests that analysis can be disabled entirely.

**Pass:** exact math agrees with direct vector recomputation; positive and negative strengths work; saved combinations reproduce the effective vector; 8 dial stack updates require no GPU and are tiny CPU work; disabled mode behaves as before.

### Phase 2 — Creator metadata + manual normalization (P0/P1)

1. Add optional creator/editor metadata inputs (or an Analyze/Edit Metadata node) for onset, positive/negative recommended ranges, observed overcook notes, failure axes, model/pipeline preset and evidence provenance.
2. Distinguish `pre_refiner_calibration` (existing code) from `perceptual_strength_calibration` (new). Do **not** overload the existing `calibrated` key.
3. Add small UI **ⓘ info** popup with raw strength and metadata, a visual **raw vs normalized-display** toggle, and unknown values shown explicitly.
4. Introduce schema versioning and clear invalidation for incompatible checkpoint, pipeline and probe-bank IDs.

**Pass:** raw slider still drives the same underlying `ApplyDial` strength; changing metadata changes only presentation; missing calibration never gets a green “safe” claim; negative asymmetry tested; base H3 and Pika settings remain distinct.

### Phase 3 — Curated semantic atlas (P1)

1. Define initial 12–16 high-value **bipolar** axes, covering motion, camera, lighting, color, texture/material, expression/identity, mood, scene complexity and speech/audio **only insofar as held-out examples show reliable separability**. Include opposing labels and intended usage.
2. Create 4–8 varied subjects/contexts per prompt-pair template, with independent hold-out subjects, different wording and hard negatives. Avoid having all “negative” examples shorter or more generic than all “positive” examples.
3. Build probes using the **same `MakeDial` representation path** (post-refiner first) and save a single signed, versioned dictionary. This is a one-time library build; avoid rerunning Qwen during normal user slider interactions.
4. Compute a dial profile by projecting against bank vectors; optionally run a regularized joint fit, probe collinearity analysis and residual diagnostics. Save compact derived metadata, or analyze old dial files in a batch without rebuilding them.
5. Evaluate label validity using held-out contrasts and **actual generation experiments on a small selected set**, including whether turning a probe produces the expected direction; reject or relabel probes that fail.
6. Start with a curated dictionary; expand to 32–64 *only after* measuring incremental coverage and meaningful quality.

**Pass:** old and new dials can be analyzed without changing their behavior; semantic profiles are deterministic per vector/bank; source bank and uncertainty are visible; direct and joint-fit methods are not conflated; no confident names are assigned to low-confidence probes.

### Phase 4 — Visual interface (P1)

1. Build a lightweight ComfyUI frontend extension using its supported registration/hooks, and/or a new stack-analyzer node with a UI panel. The current repository has Python nodes but not this visual analyzer; inspect frontend APIs first. Make the analyzer **optional and unobtrusive**.
2. Use **SVG or Canvas** for a responsive influence wheel (not a heavyweight chart dependency unless necessary). Fixed sector angles, hover contributions, positive/negative mode, raw/normalized toggle, selection of an angle and pairwise matrix.
3. Keep the actual computation in reusable pure math and serialized data; frontend recomputes from cached per-dial profiles when sliders move, instead of invoking the encoder.
4. Use neutrals for unknown, measured boundary shading when valid, and accessible patterns/labels instead of relying on color alone.
5. Provide a small context panel: **Overlap ≠ failure**; explain evidence and data provenance in plain language.

**Pass:** 8-dial / 64-probe stress test at interactive slider rates, zero added sampler calls, keyboard-accessible labels, stable circle order, correct negative depiction, graceful mobile/narrow layouts, and honest empty/uncalibrated states. Measure actual frame time rather than assuming “0ms.”

### Phase 5 — Empirical calibration harness (P2)

1. Create a **reproducible seed-matched batch harness** for each model/pipeline (H3 base, Pika Flex; later others), including baseline and positive/negative strength sweeps with identical prompts/seeds/latents/sampler versions.
2. Evaluate multiple meaningful outputs: camera-removed optical flow, optical-flow artifacts/jerk, prompt/subject continuity, identity consistency, speech intelligibility/ASR WER where speech exists, audio-video synchrony, and human quality preferences. Avoid one aggregate “quality” number until validated.
3. Use a **small pilot** on the existing motion and sinister/dread/seductive examples; choose threshold definitions after observing distributions. Include repeated seeds and held-out prompts; label the published Pika single-seed findings as preliminary.
4. Save run manifests and output artifacts in optional, size-appropriate sidecars; record failure criteria, pipeline fingerprint, sample counts, uncertainties and actual observed outcomes.
5. If enough evidence exists, fit a *conditional* risk envelope for specific outcomes and validated semantic dimensions; otherwise display creator-set guidance separately from measured risk.

**Pass:** another agent can reproduce a calibration from manifest + pinned dependencies; no result in one preset is silently applied to another; overcook alerts cite evidence, its scope and confidence.

### Phase 6 — Optional research lanes, isolated from v1 UX

- **Expanded contrast bank** (automated description discovery with human/empirical validation).
- **Prompt-aware pre-refiner refiner tests** (same prompt and strength, effect after the nonlinear refiner).
- **Offline shared SAE** (section 10).
- **Denoiser response interaction** and eventually LoRA compatibility (section 11).
- **Automatic stack advising** only after proof that predictions correlate with outcomes; default to non-destructive *suggestions*, not stealth changes to user input.

**Explicit stop condition:** Do not begin research lanes before passing the exact-math, compatibility, quality-label and UI honesty gates.

---

## 9. Runtime and compute budget

All numbers below are **orders of magnitude or algebraic sizes**, not actual benchmarks of this repo on the user's hardware.

| Task | Work | During generation? | Notes |
|---|---|---|---|
| 8-dial pairwise Gram/cosine | ~28 × 5376 dot products | No required overhead | CPU tiny; can cache by vector hash |
| 1 dial × 64 semantic probes | 64 × 5376 = 344,064 coefficient products | No | One-time at analysis/creation; batched CPU or GPU |
| Recompute 8 dial profiles across 64 probes | ~512 scalar weighted additions | No | Suitable for browser-side sliders |
| Shared 64-probe FP32 matrix | ~1.31 MiB | No | Load once for analysis; no need inside sampler |
| 16K-feature, 5376-wide SAE BF16 encoder+decoder weights | ~336 MiB (352 MB decimal) | No if cached | Training memory substantially greater |
| 32K SAE BF16 encoder+decoder weights | ~672 MiB (704 MB decimal) | No if cached | Optimizer/activation memory extra |
| 10M × 5376 BF16 activation vectors | ~100 GiB uncompressed | Offline | Stream, shard, compress or regenerate |
| Four-way denoiser interaction test | 4 matched model evaluations per test point | **Only in Deep Analyze** | Expensive; don't hook into standard sampler |
| End-to-end overcook calibration | Multiple real videos per dial/stack/preset | **Offline batch only** | Largest compute bill; cache artifacts |

**Hardware reality:** A single RTX 5090 (32 GB) is plausible for training a **moderate 16K/32K SAE on already-collected 5376-wide activations** with appropriate batch sizes and streaming. But loading the **full BF16 H3-specific Qwen3-VL-32B text encoder** on 32 GB is a different problem; collecting activations may require quantization, offload or access to bigger cards. Do not assume the text encoder + H3 DiT fit into 32 GB simultaneously. No duration claims until a pilot benchmark.

**Budget requirements:** default stack viewer adds **zero new Qwen calls and zero new DiT evaluations to rendering**. It may perform tiny cached CPU/UI calculations and file reads. Heavy analysis runs explicitly, with visible cost estimates and cached results.

---

## 10. Future SAE project — one shared atlas for the community

### 10.1 Why a shared SAE could be worth making

A user-created dial is a high-dimensional direction. A trained, released **H3 conditioning SAE** could expose sparse feature activation changes, giving fine-grained shared feature IDs across many dials, including components we did not anticipate in a hand-crafted probe bank. The community would not need to train one SAE per dial. Users could either download the analyzer once or use profiles precomputed by dial authors.

**But:** an SAE does not automatically emit human names or determine whether a video will look good. Learned features can split, duplicate, shift across training seeds and respond nonlinearly to specific prompts. Its value is *hypothesis generation and structured measurement*, followed by causal/output testing.

### 10.2 Where to train it

**Preferred initial target:** **H3 post-refiner token activations, 5376-dimensional**, because they are the same space into which default Dials inject. Compare with token-mean activations as an ablation; token-level data contains variation the averaged dial construction discards. The initial goal is to explain *changes caused by adding a dial* to actual conditioning, not to interpret the raw vector in isolation.

For sample prompt activation `h` and dial shift `v`, use:

```text
z_base    = SAE.encode(h)
z_shifted = SAE.encode(h + strength * v)
delta_z   = z_shifted - z_base
```

Average or report distributions across a **representative prompt set** and strengths; don't assume `SAE.encode(v)` equals the feature change. The SAE nonlinearity makes this distinction important. Store prompt-family variation/uncertainty. For pre-refiner dials, use prompt-dependent `refiner(pre + v)` to obtain comparable post-refiner activations or train a **separate** pre-refiner dictionary.

**Do not begin with a generic SAE for full Qwen hidden states and assume those labels cleanly transfer through H3's projection + refiner.** Qwen is a possible later cross-layer comparison, not the primary target.

### 10.3 Candidate architectures to compare

| Candidate | Why consider it | Caveat | Recommended experiment |
|---|---|---|---|
| **16K BatchTopK SAE** | Straightforward, flexible average sparsity; strong baseline in LLM experiments | Interpretation may be unstable across seeds; not validated for H3 specifically | **First controlled pilot** |
| **32K BatchTopK SAE** | More capacity for finer-grained features | More labels, more compute and potentially less stable individual features | Compare only after 16K baseline |
| **16K–32K Matryoshka SAE** | Coarse-to-fine nested features can preserve broad concepts alongside detailed ones | More complex objectives; H3 usefulness unproven | Second research branch |
| **JumpReLU / simple L1 SAE** | Architectural control; possibly different stability or sparsity trade-off | Needs hyperparameter tuning and apples-to-apples comparison | Baseline/ablation |
| **Cross-layer/cross-model dictionaries** | Eventually relate Qwen, pre-refiner, post-refiner, DiT outputs and LoRA effects | Multiple spaces, huge confounding; not an MVP dependency | Future research only |

Start with 16K; **32K is a capacity test, not a target number of named topics**. Track reconstruction, activation sparsity, dead features, held-out stability, causal intervention usefulness and *whether the SAE adds explanatory power beyond the curated probe atlas*.

### 10.4 Training corpus / representativeness

Use a diverse, deduplicated, licensed/appropriate prompt corpus covering camera/motion, lighting/color, materials, human and non-human subjects, expressions, emotions, scenes, styles, speech, music/sound, complex composition, references and atypical/negative strengths. Vary length and phrasing. Do not let style terms become proxies for the number of prompt tokens or template wording.

- Include **plain prompts plus dial-perturbed post-refiner activations** with both positive and negative strengths, because that is the distribution the tool must interpret.
- Build train/validation/test splits separated by **prompt template, subject and semantic family** where feasible, not only randomized tokens from the same template.
- Pilot at perhaps **1–3 million activation tokens**, then consider **10M+** if reconstruction/stability curves justify it. These are experimental budgets, not established sufficiency thresholds.
- Include enough naturally occurring and deliberately balanced content to avoid domination by familiar camera/portrait clichés.
- Collect activation statistics (norms, mean, outliers, token positions and modality tags) and fix normalization policy before training.
- If text/vision reference conditioning differs meaningfully, label the coverage and add a separate dataset lane; do not pretend text-only training covers all H3 modes.

### 10.5 Evaluation and publication contract

An SAE is publishable as a useful community artifact when it passes:

1. Held-out reconstruction and sparsity vs baselines (including 16K vs 32K trade-offs).
2. **Cross-seed feature stability**, or explicit acknowledgment when IDs are unstable. IDs must be versioned.
3. Quantitative comparison against curated probes on labeled contrasts, including novel/unseen concepts.
4. Evidence that selected features cause predictable **H3 output** changes under controlled interventions (not merely attractive prompt-based auto-labels).
5. Robustness across strength signs, prompt families, base H3/Pika and ordinary user-created dials.
6. A manageable downloadable checkpoint or precomputed dial-profile distribution, reproducible training scripts/manifest and a licensing review.

Potential delivery: `MATLOWAI/H3-Dials-Feature-Atlas` with SAE weights, normalized feature IDs, interpretations with confidence and examples, versioned metadata, CLI `analyze_dial`, and an optional ComfyUI node. This is a **proposed** artifact name, not an existing release. Users who only download `.safetensors` dials should not be required to install the SAE.

### 10.6 Research references

- [BatchTopK Sparse Autoencoders (2024)](https://arxiv.org/abs/2412.06410) — candidate SAE training baseline, **not** direct H3 evidence.
- [Learning Multi-Level Features with Matryoshka Sparse Autoencoders (ICML 2025)](https://proceedings.mlr.press/v267/bussmann25a.html) — coarse-to-fine feature organization.
- [Sparse Autoencoders Trained on the Same Data Learn Different Features (ICLR 2026)](https://proceedings.iclr.cc/paper_files/paper/2026/hash/3c1fe56b043848b211030c202764c6a7-Abstract-Conference.html) — caution about feature stability and ontological claims.
- [Testing with Concept Activation Vectors (ICML 2018)](https://proceedings.mlr.press/v80/kim18d.html) — conceptual precedent for human-labeled directions; **our probe projections are not automatically full TCAV sensitivity tests**.

**Decision gate:** Do SAE work only if the lightweight atlas demonstrably misses meaningful dimensions *and* a pilot shows SAE features supply novel, stable, behaviorally useful explanations.

---

## 11. Future: test actual interference, including LoRAs

### 11.1 Nonlinear denoiser interaction residual

With identical latent `z_t`, timestep `t`, sampler conditions, random state and prompt `c`, compare:

```text
f0  = f(z_t, t, c)
fA  = f(z_t, t, c + A)
fB  = f(z_t, t, c + B)
fAB = f(z_t, t, c + A + B)
interaction = fAB - fA - fB + f0
```

A large interaction residual means **nonlinearity at that model-response point**, not automatically an undesirable clash. Normalize against ordinary single-dial dose nonlinearity, measure more than one timestep, use matched contexts, and compare to actual rendered results. Track *where and when* interactions appear if later extending to temporal/spatial heatmaps.

### 11.2 How LoRA comparison differs

A LoRA changes model weights, not necessarily a single H3 post-refiner conditioning vector. A cosine on raw LoRA tensors is not the same as semantic overlap with a dial. If we later study **dial + LoRA** or **LoRA + LoRA** combinations, use matched denoiser responses, intermediate activations, rendered metrics or learned model-specific response fingerprints. Version/identify every LoRA and patch order, and don't call a positive interaction residual a failure without output evidence.

### 11.3 Potential advanced product features (not v1 promises)

- **Stack advisor:** “These two dials strongly reinforce the same semantic probe; consider lowering one,” clearly marked as heuristic unless calibrated.
- **Measured per-region budget:** not a universal redline, but model/pipeline-specific conditional bounds inferred from sufficiently rich calibration.
- **Explain this output:** link measured generation regressions to candidate steering dimensions and their contributing dials.
- **Auto-deconflict proposal:** suggest a projection, scale adjustment or alternative dial *without changing the workflow until accepted*; preview lost desired attributes.
- **Unknown-feature discovery:** SAE highlights a shared feature not in the curated dictionary; nominate it for labeling and targeted testing.
- **Spatial/temporal response atlas:** future denoiser experiments show which aspects of the clip responded, when and where, rather than pretending semantic probes correspond to literal pixel positions.
- **Community learning loop:** creators optionally publish benchmark evidence and improved atlas entries, with provenance, model version and reproducibility.
- **Dial-to-LoRA export calibration:** treat converting dial behavior into a trained/weight-based artifact as a separate experimental bridge. Benchmark equivalence across strengths and prompts rather than assuming a one-to-one scalar; keep this independent of semantic labeling and do not let it block the atlas.

---

## 12. Tests, acceptance matrix and red flags

### 12.1 Synthetic CPU tests (mandatory, fast)

- Identical vectors: cosine +1, positive strengths reinforce.
- Opposing vectors: cosine −1; equal signed shifts cancel.
- Orthogonal vectors: cosine ~0 but both can project positively onto a third `p`; wheel catches shared affinity.
- Mixed positive/negative strengths: sign of pair interaction flips correctly.
- Zero and near-zero vectors: no divide-by-zero, NaN, infinity or false alerts.
- Repeated `CombineDials` with orthogonalization: effective vector and tree exactly match the operation order.
- Correlated probe bank: both direct and ridge methods work, collinearity warning and residual reported.
- Mismatched pre/post or model-space fingerprint: refuse cross-space vector combination; don't silently coerce.
- Legacy `.safetensors` with only old metadata, no sidecars: loads and renders as before.
- Unknown calibration, asymmetric positive/negative thresholds and model-preset mismatch: correct neutral/unknown display.
- Stale profile with changed vector/hash/bank version: invalidated and recomputed, not reused.
- Deliberately malformed metadata: safe parser errors, no code execution, no arbitrary path accesses.

### 12.2 GPU / evaluation tests (once implementation runs locally)

- Base H3 dial at unchanged strength produces equivalent output to unmodified nodes, within controlled test tolerances.
- Pika and base calibration remain separate.
- Repeat at least the documented motion and sinister/speech examples (same prompts, seeds, resolution, steps and exact model versions where available), accounting for limited past sample sizes.
- When the analyzer is disabled, profile shows **no new encoder or DiT evaluations**.
- Interactive UI p95 update time and memory measured on 8, 16 and 32 stacked dials; choose budget after real hardware profiling, with ~16 ms as an aspirational 60-fps frame budget rather than a claimed benchmark.
- Test actual semantic labels on held-out subjects, prompt wording variations, signs and several stack compositions. Report failures, not just successes.

### 12.3 Stop / investigate flags

- Two seemingly different profiles rank the same on every dial because probes are too correlated.
- Labels only work on training subjects or exact contrast templates.
- The wheel signals red with no threshold evidence.
- Analyzer causes extra full Qwen runs every slider drag or every render.
- Pre-refiner and post-refiner vectors are compared as if they share a basis.
- Rendering changes when only metadata is edited.
- A legacy dial becomes unusable, or a combined dial loses its exact effective vector.
- A green “safe” claim appears for an untested model variant, prompt family or audio metric.
- SAE reconstruction gets better while semantic/causal validity gets worse: prefer the latter for user value.

---

## 13. Suggested file organization (adapt after inspection)

```text
ComfyUI-Dials/
├── nodes.py                          # preserve five existing nodes + optional new analyzer nodes
├── dials_analysis/
│   ├── vector_math.py                # norm/cos/Gram/signed contributions
│   ├── identity.py                   # vector hashes, space/model compatibility
│   ├── schema.py                     # typed analysis metadata + legacy decoding
│   ├── composition.py                # exact saved expression tree
│   ├── probes.py                     # versioned semantic atlas + coefficients
│   ├── calibration.py                # normalization/evidence/unknown states
│   └── report.py                     # structured API for UI and CLI
├── web/                               # optional supported ComfyUI custom UI extension
│   ├── dials-atlas.js                 # interaction hook, state and rendering
│   └── dials-atlas.css
├── tools/
│   ├── analyze_dial.py               # offline/batch analysis, no generation
│   ├── build_probe_bank.py           # one-time Qwen/MakeDial-derived atlas build
│   └── calibration_sweep.py          # optional expensive reproducible generation runs
├── probe_banks/
│   └── h3-curated-v1.*               # tiny versioned dictionary + labels/validation
├── tests/
│   ├── test_vector_math.py
│   ├── test_legacy_safetensors.py
│   ├── test_composition.py
│   ├── test_calibration.py
│   └── test_probe_validation.py
└── docs/
    ├── INTERACTION_ATLAS_SPEC.md
    ├── CALIBRATION_EVIDENCE.md
    ├── DECISIONS.md
    └── SAE_RESEARCH_ROADMAP.md       # optional, can split from this handoff
```

Paths are a proposal, not an assertion that these files exist. Add new dependencies only if justified; keep pure-vector analysis usable outside ComfyUI. Review ComfyUI's current JavaScript custom-node extension conventions: [official frontend extensions development guide](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/extensions/development.md).

---

## 14. Suggested first implementation session / execution order

**Session 1: ship mathematical truth, not ornament.**

1. Inspect repo at pinned commit, record current five-node API and working sample workflows.
2. Implement pure `vector_math` and compatibility identity checks, with synthetic tests.
3. Patch `CombineDials` zero-vector handling and structured provenance while preserving the exact vector/output of normal combinations.
4. Add optional schema/read/write with backward compatibility. Expose JSON-like report including effective vector stats and matrix data.
5. Add creator-configurable onset/recommended/overcook metadata and basic info display **without changing strength**.
6. Run existing regression tests and add missing coverage. Produce a concise before/after runtime and compatibility report.

**Session 2: labeled atlas and UI.**

1. Design 12–16 carefully distinct pilot probes; build a reproducible bank-generation script.
2. Validate on held-out contrast pairs; deduplicate/flag correlated axes.
3. Add per-dial profiles, unknown coverage, and a structured UI report.
4. Build the first radial wheel + pairwise overlap matrix + hover contribution inspector. Do not add risk redlines until supported.
5. Capture before/after screenshots of a single dial, two partially overlapping dials, opposing dials and an uncalibrated stack; have a human check whether the display is intuitive.

**Session 3: earn the overcook warnings.**

1. Create a small reproducible seed-matched test plan using documented H3/Pika examples.
2. Add audio/motion/prompt-adherence metrics and user review metadata.
3. Attach per-pipeline evidence to calibration boundaries.
4. Implement calibrated warning UI only for those experimentally supported cases.

**Only then:** consider automatic contrast search, SAE and denoiser probes.

---

## 15. Open decisions for the coding agent to resolve from evidence

1. **Where does the first UI live?** ComfyUI `web/` frontend extension, a widget on a new Analyze Stack node, or a shared web page component? Prefer the least intrusive way to reflect *actual* active stack state; document the trade-off.
2. **How does a user declare a stack?** An explicit `DIAL_STACK`/analysis node may be more reliable than introspecting arbitrary patched models; integrate with existing Apply/Combine nodes without hiding externally loaded LoRAs.
3. **Are probe coefficients displayed directly or using a regularized joint fit?** Keep both methods internally; pilot user comprehension and semantic stability before choosing a default.
4. **How are signed negative effects drawn radially?** Prototype a dual-track display rather than assuming a plain positive-radius polygon is intelligible.
5. **Where is large calibration evidence stored?** Prefer compact metadata plus optional sidecars; preserve user ownership and easy sharing.
6. **What model/LoRA fingerprints are reliable and cheap?** Do not hash enormous DiT checkpoint bytes at every slider change; cache verified identifiers and explicitly mark partial identities.
7. **How to minimize subjective metrics?** Treat speech WER and optical flow as narrow observable outputs and combine with human evaluation for artistry, quality and prompt drift.
8. **What constitutes a useful atlas?** Define held-out label predictive validity, correlation/dedup, prompt-family robustness and residual thresholds before chasing 64, 16K or 32K features.

---

## 16. Project principles to protect

- **Tiny dials first.** Preserve existing ~14 KB portability. Analysis is optional; no extra weights required to use a dial.
- **No stealth model or strength changes.** The UI describes what was asked; an optional future optimizer only *suggests* alternatives.
- **Same-space math is exact; semantic labels are hypotheses; bad-output claims require evidence.** Every visual state should reflect that distinction.
- **Creation-time/offline work over render-time overhead.** Profiles are cached by vector + model-space + probe-bank version. Slider movement must not invoke Qwen or DiT.
- **Backward-compatible, agent-operable artifacts.** Versioned metadata, deterministic manifests, small dependencies, reproducible tests and logs.
- **Correctness before prettiness.** The jagged circle is a visual language for measured data, not a generator of fictitious risk.
- **Preserve the dreams.** A community feature atlas, useful overlap detection, eventually model-response-aware diagnosis and LoRA integration are legitimate long-term goals—but do not let them block shipping useful, truthful tooling now.

### Immediate deliverable definition of done

A user can load multiple H3 dials, see an exact reinforcement/cancellation matrix, inspect every dial's metadata, optionally use creator-entered calibrated strength ranges, and—when a validated reference probe bank is installed—see a labeled influence wheel with per-dial contributions and uncertainty. Old workflows render identically, and **ordinary generation runs no new analysis-model inference**. There is a clear, versioned route to richer probes, empirical overcook envelopes and a future shared SAE.

---

## Sources and provenance

**Implementation and current results:** [Dials repository](https://github.com/matlowai/ComfyUI-Dials), [nodes.py](https://raw.githubusercontent.com/matlowai/ComfyUI-Dials/main/nodes.py), [README](https://raw.githubusercontent.com/matlowai/ComfyUI-Dials/main/README.md), [H3 ComfyUI model code](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/model.py), [H3 text encoder](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/text_encoders/minimax.py), [H3 config](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/transformer_ref/config.json).  
**Interpretability research:** [TCAV](https://proceedings.mlr.press/v80/kim18d.html), [BatchTopK SAE](https://arxiv.org/abs/2412.06410), [Matryoshka SAE](https://proceedings.mlr.press/v267/bussmann25a.html), [SAE seed stability / ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/3c1fe56b043848b211030c202764c6a7-Abstract-Conference.html).  
**UI integration:** [ComfyUI frontend extensions guide](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/extensions/development.md).

> **Handoff status:** This is a source-checked plan, not a merged implementation. Figures presented as design examples or estimates are explicitly labeled as such. Validate against the actual checked-out versions and current model stack before editing.
