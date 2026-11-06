"""H3 Core Compatibility (alpha, 2026-09-04): one MODEL -> MODEL node that
brings the running ComfyUI up to the H3 mask semantics this pack needs, and
gets out of the way the moment the core does it itself.

WHY A NODE AND NOT ONLY A SIDE EFFECT. `H3TemporalInsert` emits a LATENT
carrying a 0/1 `noise_mask`, so it cannot patch the model itself; and a user
can legitimately run it on stock H3 without `H3StreamedBlocks`. That graph has
no other place to put a model patch. The same helper is called automatically
from `H3StreamedBlocks`, so low-VRAM graphs need no rewiring, and applying
both is safe: the wrapper is keyed and removed before it is added.

WHAT IT CAN FIX TODAY. Exactly one thing: the #15988 mask-velocity conversion
(the maths, the deviation from the PR, and the wrapper's position in the chain
are all documented in `h3_mask_conv.py`). It is a list of one on purpose - the
node exists so that the NEXT pending-core-fix has an obvious home, not so that
it can accumulate patches nobody reviewed.

WHEN IT DOES NOTHING, AND SAYS SO. On a core that already carries #15988; on a
core older than #15375, which has no model-side mask timesteps to correct; on
a model that is not MiniMax H3; and - loudly - whenever the capability probe
cannot prove who owns `MiniMaxH3Model.forward`, because a second
multiplication would give mask^2 * v, which is worse than the bug.
"""

import logging

from .h3_mask_conv import (MODES, SCOPES, apply_h3_mask_velocity_compat,
                           core_mask_velocity_state)

log = logging.getLogger("MAINodes.h3_core_compat")


class H3CoreCompatibility:
    """Apply the pending-core H3 fixes this graph needs, and nothing else."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip":
                    "the H3 model this pass samples with. Wire it like any "
                    "model patch, before the sampler."}),
            },
            "optional": {
                "mask_velocity_15988": (list(MODES), {"default": "auto", "tooltip":
                    "auto = install the #15988 velocity correction only when "
                    "the running core is detected as 'compat_needed'. A core "
                    "that already has the fix, a core older than #15375, and "
                    "any core whose forward cannot be attributed all get "
                    "nothing. off / on force the arm for an A/B."}),
                "scope": (list(SCOPES), {"default": "both", "tooltip":
                    "which stream the correction applies to. A chain graph can "
                    "carry three fractional paths at once (audio_strength, the "
                    "prefix release ramp, drift control's per-step mask); use "
                    "this to say which one moved the result."}),
            },
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "patch"
    CATEGORY = "MAINodes/alpha"
    DESCRIPTION = (
        "EXPERIMENTAL (alpha), new 2026-09-04. Reads the installed ComfyUI "
        "source and applies the H3 core fixes this graph needs while they are "
        "still pending upstream - today that is the #15988 denoise-mask "
        "velocity conversion. No-op on a core that already has them, on "
        "pre-#15375 cores, and on non-H3 models; refuses (with a warning) when "
        "another pack owns MiniMaxH3Model.forward, because scaling the "
        "velocity twice is worse than not scaling it. H3StreamedBlocks calls "
        "the same helper by itself; this node is for graphs without it, such "
        "as H3TemporalInsert on stock H3.")

    def patch(self, model, mask_velocity_15988="auto", scope="both"):
        state = core_mask_velocity_state()
        m, rep = apply_h3_mask_velocity_compat(model, scope, mask_velocity_15988)
        text = ("H3 Core Compatibility\n"
                "  core mask_velocity_conversion: %s\n"
                "  mask_velocity_15988 = %s, scope = %s\n\n%s"
                % (state, mask_velocity_15988, scope, rep))
        log.info("\n" + text)
        return (m, text)


NODE_CLASS_MAPPINGS = {"H3CoreCompatibility": H3CoreCompatibility}
NODE_DISPLAY_NAME_MAPPINGS = {"H3CoreCompatibility": "H3 Core Compatibility (alpha)"}
