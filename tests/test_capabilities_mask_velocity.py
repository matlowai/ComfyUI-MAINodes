#!/usr/bin/env python3
"""Unit test for `mask_velocity_conversion`, the #15988 capability state in
h3_capabilities.py. CPU only, no GPU, no weights.

    /mnt/work/ai/venvs/comfyui-cu132/bin/python tests/test_capabilities_mask_velocity.py

THE FIXTURES ARE REAL SOURCE. The `compat_needed` case is
`inspect.getsource(MiniMaxH3Model.forward)` from the installed ComfyUI - the
exact text the detector will meet in production - and every other case is a
mechanical edit of that same text: the native case inserts the PR's two lines
where the PR inserts them, the truncated case cuts the function short, the
half case deletes one of the two lines. Nothing here invents a plausible-
looking forward, because a detector tested against a paraphrase of core only
proves it can read the paraphrase.

The six cases are the compat handoff s.6.3 list, plus the pre-#15375 case:
  1. real current core                      -> compat_needed
  2. + the PR's two multiplications         -> native
  3. truncated before the audio carry       -> unknown
  4. only the video multiplication          -> unknown
  5. source unreadable ("")                 -> unknown
  6. forward owned by another pack          -> unknown
  7. per_token_masks False (pre-#15375)     -> legacy_no_model_mask

The safety invariant under test: `compat_needed` is returned ONLY for case 1.
Every other shape must refuse, because installing a second multiplication
gives mask^2 * v, which is a worse error than the bug it corrects.
"""
import importlib.util
import inspect
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# installed layout is <ComfyUI>/custom_nodes/<pack>; a git worktree of the pack
# lives anywhere, so fall back to the install this box runs.
for _root in (os.path.dirname(os.path.dirname(HERE)),
              os.environ.get("COMFYUI_ROOT", ""),
              "/mnt/work/ai/apps/ComfyUI"):
    if _root and os.path.isdir(os.path.join(_root, "comfy", "ldm", "minimax")):
        COMFY = _root
        if COMFY not in sys.path:
            sys.path.insert(0, COMFY)
        break
else:
    print("CANNOT RUN: no ComfyUI checkout found (set COMFYUI_ROOT)")
    sys.exit(2)

spec = importlib.util.spec_from_file_location(
    "h3_capabilities", os.path.join(HERE, "h3_capabilities.py"))
caps_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caps_mod)

ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ((" | " + detail) if detail else ""))
    ok = ok and bool(cond)


def state(src, owner="comfy core", ptm=True):
    return caps_mod.classify_mask_velocity(src, owner, ptm)


# --------------------------------------------------- the real core fixture
try:
    from comfy.ldm.minimax.model import MiniMaxH3Model
    REAL = inspect.getsource(MiniMaxH3Model.forward)
except Exception as e:                                   # noqa: BLE001
    print("CANNOT RUN: comfy.ldm.minimax.model is not importable here: %s: %s"
          % (type(e).__name__, e))
    sys.exit(2)

lines = REAL.splitlines()
w_idx = next(i for i, l in enumerate(lines) if "WrapperExecutor" in l)
# the PR inserts immediately after the wrapped call and before the carry block
carry_if = next(i for i in range(w_idx, len(lines))
                if lines[i].strip().startswith("if scale != 1.0"))
indent = lines[carry_if][:len(lines[carry_if]) - len(lines[carry_if].lstrip())]

PR_LINES = [
    indent + "if denoise_mask is not None:",
    indent + "    out[0] = out[0] * denoise_mask",
    indent + "if audio_denoise_mask is not None:",
    indent + "    out[1] = out[1] * audio_denoise_mask",
]
NATIVE = "\n".join(lines[:carry_if] + PR_LINES + lines[carry_if:])
HALF = "\n".join(lines[:carry_if] + PR_LINES[:2] + lines[carry_if:])
TRUNCATED = "\n".join(lines[:carry_if])
FOREIGN_OWNER = "ComfyUI-SomeOtherH3Pack"

print("\n0. the fixture is the installed core, not a paraphrase")
check("   real forward source read from MiniMaxH3Model.forward",
      "WrapperExecutor" in REAL and "self._forward" in REAL,
      "%d lines" % len(lines))
check("   the PR's insertion point exists (carry block follows the wrapped call)",
      carry_if > w_idx, "WrapperExecutor line %d, carry block line %d" % (w_idx, carry_if))
check("   the real source does NOT already carry #15988",
      not caps_mod._MASK_MULT_VIDEO.search(REAL)
      and not caps_mod._MASK_MULT_AUDIO.search(REAL))

print("\n1..7. the six handoff cases plus pre-#15375")
check("   1 real current core          -> compat_needed",
      state(REAL) == "compat_needed", state(REAL))
check("   2 + the PR's two lines       -> native",
      state(NATIVE) == "native", state(NATIVE))
check("   3 truncated before the carry -> unknown",
      state(TRUNCATED) == "unknown", state(TRUNCATED))
check("   4 video multiplication only  -> unknown",
      state(HALF) == "unknown", state(HALF))
check("   5 source unreadable          -> unknown",
      state("") == "unknown", state(""))
check("   6 foreign forward owner      -> unknown",
      state(REAL, owner=FOREIGN_OWNER) == "unknown", state(REAL, owner=FOREIGN_OWNER))
check("   7 pre-#15375 core            -> legacy_no_model_mask",
      state(REAL, ptm=False) == "legacy_no_model_mask", state(REAL, ptm=False))

print("\n8. the safety invariant: compat_needed is the narrow case")
check("   a foreign pack that DOES scale both streams reads as native",
      state(NATIVE, owner=FOREIGN_OWNER) == "native")
check("   audio-only multiplication is unknown, not native",
      state("\n".join(lines[:carry_if] + PR_LINES[2:] + lines[carry_if:])) == "unknown")
check("   per_token_masks unknown is unknown, never compat_needed",
      state(REAL, ptm="unknown") == "unknown")
# the carry must be AFTER the wrapped call: a forward that carries first and
# wraps second would put our wrapper on the wrong side of the conversion
swapped = "\n".join(lines[carry_if:] + lines[:carry_if])
check("   carry BEFORE the wrapped call -> unknown", state(swapped) == "unknown",
      state(swapped))
# KNOWN LIMITATION, tested rather than claimed away: the detector is textual,
# so a COMMENT inside forward that spells one of the two operations reads as
# that operation. It fails toward unknown (no install), never toward
# compat_needed, which is the direction that matters. The real protection
# against false positives is that only forward's own source is read, not the
# module's tests and comments.
commented = REAL.replace(
    "        out = comfy",
    "        # #15988 would add: out[1] = out[1] * audio_denoise_mask\n        out = comfy")
check("   a comment inside forward degrades to unknown, not to compat_needed",
      state(commented) == "unknown", state(commented))

print("\n8b. a foreign pack that REASSIGNS MiniMaxH3Model.forward")
# The real shape this guards against (found on this box by the night's core
# audit, pack not named here): a module that rewrites MiniMaxH3Model.forward,
# ._forward and FinalLayer.forward process-wide, lazily at node-execution
# time, when its own probe decides core's mask support is incomplete. The
# class object therefore proves nothing about what will run, and its forward
# may or may not already scale the velocity - which is exactly `unknown`.
# Both signals are checked: the file a function came from AND its __module__.
PACK_FILE = os.path.join(COMFY, "custom_nodes", "a_third_party_h3_pack",
                         "h3_mask_compat.py")


def foreign_forward(filename, module):
    """A real function object carrying `filename` as its code's origin and
    `module` as its __module__, the two things a rewrite is judged by."""
    ns = {}
    exec(compile("def forward(self, x, timestep, context, transformer_options={},\n"
                 "            minimax_payload=None, denoise_mask=None,\n"
                 "            audio_denoise_mask=None, **kwargs):\n"
                 "    return [x[0], x[1]]\n", filename, "exec"), ns)
    fn = ns["forward"]
    fn.__module__ = module
    return fn


owner = caps_mod._forward_owner(
    foreign_forward(PACK_FILE, "custom_nodes.a_third_party_h3_pack.h3_mask_compat"))
check("   a forward defined in custom_nodes is owned by that pack",
      owner == "a_third_party_h3_pack", owner)
# and the second signal on its own: a function whose code claims a core file
# but whose __module__ is the pack's (assigned from elsewhere onto the class)
spoofed = caps_mod._forward_owner(
    foreign_forward(os.path.join(COMFY, "comfy", "ldm", "minimax", "model.py"),
                    "custom_nodes.a_third_party_h3_pack.h3_mask_compat"))
check("   __module__ alone is enough to disown it",
      spoofed == "custom_nodes.a_third_party_h3_pack.h3_mask_compat", spoofed)
check("   and that spoofed owner also degrades to unknown",
      state(REAL, owner=spoofed) == "unknown")
check("   and the state degrades to unknown", state(REAL, owner=owner) == "unknown",
      state(REAL, owner=owner))
check("   even when the reassigned forward looks native, we install nothing",
      state(NATIVE, owner=owner) == "native")     # native also means no install
rep_txt = caps_mod.format_report(
    {"mask_velocity_conversion": "unknown", "h3_forward_owner": owner}, {})
mvc_line = [l for l in rep_txt.splitlines() if "mask_velocity_conversion" in l][0]
check("   the report line names the owning pack", owner in mvc_line, mvc_line.strip())
check("   the real core forward still resolves to comfy core",
      caps_mod._forward_owner(MiniMaxH3Model.forward) == "comfy core",
      caps_mod._forward_owner(MiniMaxH3Model.forward))

print("\n9. whitespace and *= variants are tolerated")
for variant in ("out[0]*=denoise_mask\nout[1]*=audio_denoise_mask",
                "out[ 0 ] = out[ 0 ]  *  denoise_mask\nout[1] = out[1] * audio_denoise_mask"):
    check("   %-42s -> native" % variant.replace("\n", " ; ")[:42],
          state(REAL + "\n" + variant) == "native")

print("\n10. probe_core() on the installed core, and the report line")
caps = caps_mod.probe_core()
live = caps.get("mask_velocity_conversion")
check("   probe_core reports a legal state", live in caps_mod.MASK_VELOCITY_STATES,
      "mask_velocity_conversion = %s, forward owner = %s, per_token_masks = %s"
      % (live, caps.get("h3_forward_owner"), caps.get("per_token_masks")))
check("   and it agrees with the direct classification of the same source",
      live == state(REAL, caps.get("h3_forward_owner"), caps.get("per_token_masks")))
text = caps_mod.format_report(caps, caps_mod.block_patch_report(None))
line = [l for l in text.splitlines() if "mask_velocity_conversion" in l]
check("   format_report carries exactly one mask_velocity_conversion line",
      len(line) == 1, line[0].strip() if line else "MISSING")
check("   the line names the state", bool(line) and str(live) in line[0])

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
