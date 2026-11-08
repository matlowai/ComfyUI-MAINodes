# Current session lessons

Relevant complete current entries, including historical gate caveats; geometry correction supersedes the early aerial feasibility interpretation.

- **Named-rule checks miss what doesn't belong (2026-11-08, Dylan on seq02 cut1b).** Counts and cited-picture scores didn't flag an out-of-place object in Corvin's hand during the power-up, or a groan at the end of the clash before the sweat-drop cut; the coordinator even saw the "dark ring shapes" and called them an oddity. Treat any oddity as a finding, and add an open whole-clip "what doesn't belong / what sounds wrong" pass (blind-tested first: F-SQ78).
- **Gate result (a4cabb3, builder):** exit 0; the real failures were all mine and fixed after the snapshot (c430f33,
  df30beb): a policy change (the key and master out of References) breaks every older suite that relied on the old
  default (g4book), so grep the suites for the old behaviour before the gate, as G17a's voice lesson already said; a
  new branch placed before an old refusal (the F-AC05 re-run path) has to keep the refusal's guard (g15cut, SNAP-R214);
  a non-numeric audio placeholder in a comment trips g3cards' cite rule. The three timing suites (ui, adopt, f2model) were
  full when re-run alone: load while the U46h lab ran.
- **Final rev df30beb is not gated whole.** The next coordinator gate should run on a new snapshot of df30beb, with
  :8194 restarted only once GPU0 is free and its unit given `AUDIOCPP_SERVER` (u101base already has the fork and the two
  model folders linked, and its Voice QA setting is "this GPU, experts in RAM").
- **When rewording can't change a pose (which hand is raised), build the board from a neighbouring frame that already has it** (2026-11-08, seq02 C5: three rewordings kept the wrong hand; an edit of C7's frame 0 fixed it first try).

- **Codex migration (2026-11-08):** Snap pack skills have custom `scope`/`rules` frontmatter rejected by Codex skill-creator validation, and the voice description contains angle brackets rejected by the same validator. Small valid wrappers can retain full descriptions (voice display token normalized) and read canonical sources without forking them. Verify discovery with local app-server `skills/list`, not only directory existence. Workspace `.agents`/`.codex` and Codex runtime state are sandbox-protected; scoped setup escalation worked. Live tools must be checked against G17a even when canonical dev skills describe G17b.

- **Overhead continuity trial (2026-11-08):** exact drawn actor marks are a better planning input than asking an image model to redraw labels/arrows. Two P-H3 annotation attempts made ambiguous/duplicate marks; draw_set_plan fixed that input, and P-H3 then added the observed crack to the map first try. That diagram success did not establish camera-view control: both H3 image paths and exact Qwen2.1 retained blocking errors. Preserve the distinction between editing the map and projecting its state into a camera. See MAP_CONTINUITY_EXPERIMENT_2026-11-08.md.
- **Set-design review (2026-11-08):** compare exact source compass/camera notes with whole native set plates before multiplying views. The north-looking S plate shows sun almost ahead despite west-sunset notes; this is a source disagreement to reconcile, while screen-side reversals and cooler close-ups alone are not proof of bad geometry. snap-set-design separates factual flaws, advisory choices and unresolved coverage.
- **Qwen2.1 integration (2026-11-08):** use the native encoder's positive/negative AND first-reference latent, original8B encoder and matchingVAE with the official25step CFG1 Euler/simple recipe; no independent empty latent or borrowed sampling shift. Installed weights need a registered Snap graph adapter. Focused wiring + real isolated runs passed, but the legacy placeholder-model U101 gate must not be run against real model files. Full regression/main landing remain separate.

- **Clarify the representation before rejecting a method (2026-11-08):** the first overhead trial tested symbolic dots/arrows, whereas the user intended textured overhead scenery plus real actor layers. Actual cutout collage + clean references produced useful H3/Qwen starting frames; two H3 empty-camera-plate + textured-overhead-guide seeds preserved general blocking and facing. The older failures were not evidence against that proposal. Preserve raw layers, masks and placement data, and show the input.
- **Blur and partial redraw are separate levers (2026-11-08):** actor-only blur with a full reference-conditioned edit, alpha feather, boundary blur and encoded-target partial init answer different questions. In this small trial sharp/corner-softened inputs worked; .7 init retained blurred proxies, while .95 restored detail with model-dependent facing. P-H3 .7 used only two sigma transitions. Do not present same numeric denoise as equivalent across models, or infer an all-model rule from one seed.
- **Crash recovery (2026-11-08):** GNOME Shell SIGSEGV killed desktop/agent control but surviving Comfy services finished queued assets. Reconcile history/files/queue before restarting or rerendering. Saved assets and reports recovered all six runs; no regeneration had queued. Elevated health checks distinguished sandbox GPU access failure from driver failure. Recreate only unfinished agents, recover visible Chrome/page ids and serialize heavy runs.

- **Do not promote a generated geometry error into canon (2026-11-08):** the first aerial became square despite the original rectangular terrace, and its repair prompt then explicitly said “preserve square terrace.” Coordinator review noted a rough proxy but still overstated aerial-transfer feasibility. Correcting duplicate landmarks was insufficient. Check footprint, proportions, ring scale and landmark relationships against original sources before using a derived aerial; distinguish image canvas from floor shape. An existing camera plate and explicit words can explain a nice output, so a matching no-plate/aerial-only arm is needed before attributing continuity to the map.


## Native Director integration follow-up

- A strategy preview is a proposal over existing native records. Its `ok` flag does not establish generation readiness, accepted geometry or completed criticism. Reconcile actual native reference order before a render.
- Read method-specific instruction scopes for the selected method, including inherited native purpose choices. A tool-only stack can omit the person's guidance. Preserve Book/shot isolation and make genuine cycles visible.
- Put an extension's entry in the actual Snap view. A ComfyUI action-bar registration alone is hidden by the Snap overlay. Scoped preferences should follow the selected Book; preserve an explicit global choice.
- Remove arbitrary text/candidate/reference ceilings in imported code. Keep real native limits and caller-supplied budgets; return every omission, and report when a required first canvas was excluded.
- Qualify read-only previews on initialized native storage by comparing graph and user-file hashes. Synthetic fixture scene shots must carry their native `takes` arrays; fixture errors are not product defects.
- Keep the full gate, pure-module checks, visible UI checks, GPU checks and fresh critic results separate. A successful runner exit is insufficient when it does not aggregate per-suite failures.


## Lighthouse source correction

- More consistent generated angles can preserve the same wrong source premise. Ground recognizable architecture in original references showing its function and access before accepting a master. The old lighthouse example enclosed its optic in a domestic plaster room.
- Keep physical levels and source dates distinct: Point Reyes clockwork below and glazed lantern above are different spaces; lens-less restoration photographs are construction evidence. Source role labels must reflect what a picture actually shows.
- Measured monochrome plans supply geometry, while a textured top remains a separate asset. The new research packet does not claim R271 completion or adopt the real building into fictional canon. Complete reports and source/hash ledger are in `lighthouse/`.


## Native Voice QA qualification

- A model can exist on disk and be advertised by its native loader while the core experimental inventory omits its format. AudioCPP GGUF discovery belongs at its integration boundary: read the loader's declared combo and retain model-graph role metadata. Keep the shared inventory unchanged.
- Successful silence is a valid Voice QA result. An empty transcript with an `ok` QA report should pass; preserve legacy `no voice` when QA did not run, and retain `check`/`listen` for leaked or uncertain speech. The focused regression suite covers these distinct paths.
- Keep original failed GPU results and rerun the affected cases against the exact corrected snapshot. Distinguish broad-gate source, focused-fix source and human listening evidence.
