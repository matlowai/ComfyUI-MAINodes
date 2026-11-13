"""Model profiles: the per-model clock facts the de-rope pipeline needs, so one
hold map (integer hold per world frame) can be retimed for any model.

A profile is five numbers and a flag:

  block        frames per latent time block. Holds of 2+ are quantised to a
               multiple of this, because a held frame only owns its own block
               when its hold fills whole blocks (LTX-2.5: 8; measured, d=8
               barely moves and d=16 does).
  hold_scale   how many world frames one oracle hold unit buys on this model.
               The oracle emits holds of 1-4 in H3 terms (scale 1). LTX-2.5
               needed x4 (hold 4 -> 16x) to move at all: MEASURED, not derived.
  legal        (step, offset): legal pixel lengths are step*k + offset
               (H3 17k+5, LTX-2.5 8k+1, Wan 4k+1).
  fps          the model's native frame rate (what a second of holds costs).
  cap_seconds  longest single pass, or None. LTX-2.5: 20 s, from its absolute-
               seconds positional cap. H3's wall is VRAM and moves with the card.
  measured     True only when hold_scale and block come from a ladder on this
               model. A custom or unmeasured profile is stamped as such in every
               report: a confident default here is how LTX d=8 fooled us for a day.

  latent       how that model's VIDEO LATENT maps onto pixel frames, so the jerk
               oracle can read the model's own latent: channels, and the token
               clock as (first, block): token 0 owns `first` frames, every later
               token owns `block` frames (LTX-2.5: 1 + 8k; Wan: 1 + 4k). H3 is
               the exception with its (1,4,4,4,4)-per-17 grid and five-phase
               normalisation, kept in motion.py bit-identical; `latent: None`
               here means "use the H3 code path".

Holds of 1 are never scaled: a hold of 1 is plain video on any model.

Presets live in PRESETS. Users extend them without touching code by dropping a
JSON object {id: profile} at <ComfyUI user dir>/mainodes_models.json (or the
path in $MAINODES_MODELS_JSON); a row there overrides a preset of the same id.
Pure python, no torch, no comfy: unit-testable.
"""
import json
import os

PRESETS = {
    "minimax-h3": dict(
        name="MiniMax-H3", block=1, hold_scale=1, legal=(17, 5), fps=24,
        cap_seconds=None, measured=True, latent=None,
        note="native: the oracle's holds are in H3 frames already; smear pads to 17k+5"),
    "ltx-2.5": dict(
        name="LTX-2.5", block=8, hold_scale=4, legal=(8, 1), fps=48,
        cap_seconds=20.0, measured=True, latent=dict(channels=128, first=1, block=8),
        note="time compressed x8; hot holds must fill whole 8-frame blocks. x4 measured 2026-08-21 "
             "(d=8 uniform: staircase 0.94-0.90 across the denoise range; d=16: 0.90-0.28). "
             "fps is the frame_rate the LTXV conditioning is told (48 in the deck's graphs); the 20 s "
             "positional cap is in seconds of THAT clock, so 913 dilated frames = 19.02 s. Longer "
             "clips are windows, spliced"),
    "wan-2.2 (unmeasured)": dict(
        name="Wan 2.2", block=4, hold_scale=4, legal=(4, 1), fps=16,
        cap_seconds=5.0, measured=False, latent=dict(channels=16, first=1, block=4),
        note="placeholder from the model's published grid (4x time, 4k+1 frames, 16 fps, "
             "trained at 81 frames = 5 s so that is the cap); hold_scale is a guess until a "
             "ladder is run. Treat every number as unmeasured"),
}

FIELDS = ("name", "block", "hold_scale", "legal", "fps", "cap_seconds", "measured", "note", "latent")


def _user_registry_path():
    p = os.environ.get("MAINODES_MODELS_JSON")
    if p:
        return p
    try:
        import folder_paths                      # only inside ComfyUI
        return os.path.join(folder_paths.get_user_directory(), "mainodes_models.json")
    except Exception:
        return None


def normalize(pid, raw):
    """Fill defaults and coerce types for a profile row; never raises on a
    missing optional field, always raises on a malformed required one."""
    p = dict(raw)
    out = dict(
        id=pid,
        name=str(p.get("name", pid)),
        block=max(1, int(p["block"])),
        hold_scale=max(1, int(p["hold_scale"])),
        legal=(int(p["legal"][0]), int(p["legal"][1])),
        fps=float(p.get("fps", 24)),
        cap_seconds=(None if p.get("cap_seconds") in (None, 0, "") else float(p["cap_seconds"])),
        measured=bool(p.get("measured", False)),
        note=str(p.get("note", "")),
        latent=(None if not p.get("latent") else dict(
            channels=int(p["latent"].get("channels", 0)),
            first=max(1, int(p["latent"].get("first", 1))),
            block=max(1, int(p["latent"].get("block", 1))))),
    )
    if out["legal"][0] < 1:
        raise ValueError(f"profile {pid}: legal step must be >= 1")
    return out


def load_profiles(extra_path=None):
    """PRESETS merged with the user registry (user rows win). Never raises:
    a broken registry prints and is skipped, so the pack still loads."""
    profiles = {k: normalize(k, v) for k, v in PRESETS.items()}
    path = extra_path or _user_registry_path()
    if path and os.path.exists(path):
        try:
            user = json.load(open(path, encoding="utf-8-sig"))
            for k, v in user.items():
                profiles[str(k)] = normalize(str(k), v)
        except Exception as e:                   # a typo must not take the pack down
            print(f"[MAINodes] model registry {path} not loaded: {type(e).__name__}: {e}")
    return profiles


def legal_ceil(n, legal, min_k=0):
    """Smallest step*k + offset >= n."""
    step, off = legal
    k = max(min_k, -(-(n - off) // step))
    return step * k + off


def remap_holds(holds, profile):
    """Oracle holds (H3 units) -> holds on the target model's clock.

    1 stays 1. h >= 2 becomes h * hold_scale, quantised to a whole number of
    blocks (never below one block). H3's profile (block 1, scale 1) is the
    identity, so existing graphs are unchanged by construction."""
    b, s = profile["block"], profile["hold_scale"]
    out = []
    for h in holds:
        h = int(h)
        if h <= 1:
            out.append(1)
        else:
            out.append(max(b, int(round(h * s / b)) * b))
    return out


def pad_to_legal(holds, legal):
    """Extend the final hold so the total sits on the legal grid (what
    H3TimeSmear does with 17k+5). Returns (holds, total, pad)."""
    holds = list(holds)
    total = legal_ceil(sum(holds), legal)
    pad = total - sum(holds)
    holds[-1] += pad
    return holds, total, pad


def windows_needed(total_frames, profile):
    """How many passes a dilated length needs under the profile's cap."""
    if not profile.get("cap_seconds"):
        return 1
    cap = int(profile["cap_seconds"] * profile["fps"])
    return max(1, -(-total_frames // cap))


def report(holds_in, holds_out, total, pad, profile):
    held = sum(1 for h in holds_in if h > 1)
    n = len(holds_in)
    lines = [
        f"profile {profile['id']} ({profile['name']}): block {profile['block']}, "
        f"hold_scale x{profile['hold_scale']}, legal {profile['legal'][0]}k+{profile['legal'][1]}, "
        f"{profile['fps']:g} fps" + (f", cap {profile['cap_seconds']:g} s/pass" if profile.get('cap_seconds') else ""),
        f"world {n} frames, {held} held -> {total} dilated frames ({total / profile['fps']:.2f} s at "
        f"{profile['fps']:g} fps), tail pad {pad}",
        f"hold histogram in -> out: {_hist(holds_in)} -> {_hist(holds_out)}",
    ]
    w = windows_needed(total, profile)
    if w > 1:
        lines.append(f"EXCEEDS the per-pass cap: {w} windows needed (splice them)")
    if not profile.get("measured"):
        lines.append("UNMEASURED profile: block / hold_scale are not from a ladder on this model; "
                     "treat the retime as an experiment, not a recipe")
    return "\n".join(lines)


def _hist(holds):
    from collections import Counter
    c = Counter(int(h) for h in holds)
    return "{" + ", ".join(f"{k}:{v}" for k, v in sorted(c.items())) + "}"


# ------------------------------------------------------------ latent clock
# A generic (first, block) token clock: token 0 owns `first` pixel frames, each
# later token owns `block`. These are the three functions the oracle's planner
# needs; motion.py keeps H3's own (1,4,4,4,4)-per-17 versions and uses these
# only when a profile carries a `latent` entry.

class LatentClock:
    def __init__(self, profile):
        lat = profile["latent"]
        self.first, self.block = lat["first"], lat["block"]
        self.channels = lat.get("channels", 0)
        self.legal = profile["legal"]
        self.id = profile["id"]

    def tok_start_frame(self, t):
        return 0 if t == 0 else self.first + (t - 1) * self.block

    def frame_token(self, f, t_lat):
        if f < self.first:
            return 0
        return min(1 + (f - self.first) // self.block, t_lat - 1)

    def token_count(self, frames):
        n = legal_ceil(frames, self.legal)
        return 1 + max(0, -(-(n - self.first) // self.block))

    def legal_ceil(self, n):
        return legal_ceil(n, self.legal)
