"""The three-layer price meter, as a COMPOSITION of three separable factors.

    cost = plan GEOMETRY  x  backend COMPLEXITY MODEL  x  machine CALIBRATION

No layer hardcodes another's numbers (amendment 2, item 5):
  - Geometry comes from the backend's compile pass: how much work the plan
    asks for versus a plain render of the same clip. Units are opaque here
    ("work units"); for H3 they are latent tokens.
  - ComplexityModel is the backend's RecipeProfile speaking: how cost grows
    with work units (an exponent + measured anchors). Hardware-independent
    by construction, which is why layer (a) needs zero calibration.
  - Calibration is the user's own machine, from the flight recorder. Absent
    -> layers (a) and (c-stub) still answer; layer (b) says "not calibrated"
    rather than predicting from GPU specs.

Layers, in spec language:
  (a) EQUIVALENT CLIP TIME — always available. "= 3.4x a plain render."
  (b) REAL MINUTES — only after self-calibration from the recorder.
  (c) VRAM FIT LINE — a cliff, not a multiplier. STUBBED, see VramModel.

Stdlib only.
"""
import json


class Geometry(object):
    """What the plan asks for, in backend-neutral units."""

    def __init__(self, work_units_plan, work_units_plain, steps=1,
                 frames_plan=0, frames_plain=0, fps=24.0, pixels=0,
                 note=""):
        self.work_units_plan = float(work_units_plan)
        self.work_units_plain = float(work_units_plain)
        self.steps = int(steps)
        self.frames_plan = int(frames_plan)
        self.frames_plain = int(frames_plain)
        self.fps = float(fps) or 24.0
        self.pixels = int(pixels)
        self.note = note

    @property
    def work_ratio(self):
        return self.work_units_plan / max(self.work_units_plain, 1e-9)

    def as_dict(self):
        return {"work_units_plan": self.work_units_plan,
                "work_units_plain": self.work_units_plain,
                "steps": self.steps, "frames_plan": self.frames_plan,
                "frames_plain": self.frames_plain, "fps": self.fps,
                "pixels": self.pixels, "note": self.note}


class ComplexityModel(object):
    """How this model family's per-step cost grows with work units.

    exponent: attention dominates, so per-step time goes as units**exponent.
    anchors: [{"work_units", "seconds_per_step", "pixels", "device", "note"}]
             — measured points, used for a sanity scale when the user has no
             calibration of their own. They are the RECIPE PROFILE's data;
             this class does not own any number.
    """

    def __init__(self, exponent, anchors=(), label=""):
        self.exponent = float(exponent)
        self.anchors = [dict(a) for a in anchors]
        self.label = label

    def relative_cost(self, geom):
        """Layer (a): equivalent clip time. Hardware-independent."""
        return geom.work_ratio ** self.exponent

    def anchor_seconds_per_step(self, work_units, pixels=0):
        """Scale the nearest anchor (same pixel count if we have one) by the
        exponent. This is a SANITY figure, not a prediction for the user's
        box — layer (b) is what predicts, and only from their own history."""
        if not self.anchors:
            return None, "no anchors in this recipe profile"
        same = [a for a in self.anchors
                if pixels and int(a.get("pixels") or 0) == int(pixels)]
        pool = same or self.anchors
        a = min(pool, key=lambda a: abs(float(a["work_units"]) - work_units))
        s = float(a["seconds_per_step"]) * (
            (work_units / float(a["work_units"])) ** self.exponent)
        why = (f"scaled from anchor {a['work_units']:g} units -> "
               f"{a['seconds_per_step']:g} s/step"
               + (f" ({a['note']})" if a.get("note") else "")
               + ("" if same else "; ANCHOR IS AT A DIFFERENT RESOLUTION"))
        return s, why


class Calibration(object):
    """The user's own machine, read from the flight recorder. Keyed per
    device AND per model tag, so new hardware or a new quant starts a fresh
    curve (spec)."""

    def __init__(self, records=()):
        self.records = [dict(r) for r in records]

    @classmethod
    def from_recorder(cls, path, device=None, model=None, pixels=None):
        rows = []
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue
                    if device and r.get("device") != device:
                        continue
                    if model and r.get("model") != model:
                        continue
                    if pixels and int(r.get("pixels") or 0) != int(pixels):
                        continue
                    rows.append(r)
        except OSError:
            pass
        return cls(rows)

    def seconds_per_step(self, work_units, exponent):
        """Fit s/step = k * units**exponent through the user's own runs (the
        exponent is the backend's, not re-fitted from two noisy points), then
        read it at this plan's work units. None when there is no history."""
        pts = [(float(r["work_units"]), float(r["s_per_step"]))
               for r in self.records
               if r.get("work_units") and r.get("s_per_step")
               and not r.get("streamed")]
        if not pts:
            return None, "no calibration runs on record"
        ks = [s / (u ** exponent) for u, s in pts]
        k = sorted(ks)[len(ks) // 2]                      # median, outlier-safe
        return k * (work_units ** exponent), (
            f"calibrated from {len(pts)} recorded run(s), median k={k:.4g}")

    def peak_bytes(self):
        vals = [int(r["peak_bytes"]) for r in self.records if r.get("peak_bytes")]
        return max(vals) if vals else None

    def streamed_boundary(self):
        """Empirical bracketing (spec): the cliff sits between the largest
        on-curve run and the smallest streamed one."""
        on = [float(r["work_units"]) for r in self.records
              if r.get("work_units") and not r.get("streamed")]
        off = [float(r["work_units"]) for r in self.records
               if r.get("work_units") and r.get("streamed")]
        return (max(on) if on else None), (min(off) if off else None)


class VramModel(object):
    """Layer (c), the FIT LINE. HONEST STUB.

    Design (spec, 2026-08-14 night): peak ~ weights + a*work_units +
    b*decode_chunk_pixels, first-guessed from the user's recorded torch
    peaks, with the source of truth being empirical bracketing of streamed
    vs on-curve runs. The VAE stage, not the sampler, is often the real peak.

    TODO(T2): a and b are NOT MEASURED YET. Nothing here fits them; the
    constants below are placeholders that this class refuses to use for a
    numeric prediction. Until they are measured, verdict() answers only
    from bracketing + live free VRAM, and says so.
    """
    A_BYTES_PER_WORK_UNIT = None      # TODO measure: sampler activation slope
    B_BYTES_PER_DECODE_PIXEL = None   # TODO measure: VAE decode-chunk slope
    MARGIN = 0.10                     # ~10% band; fragmentation makes any
                                      # prediction soft (minted ops doctrine)

    def verdict(self, geom, calib, free_bytes=None):
        on, streamed = calib.streamed_boundary()
        u = geom.work_units_plan
        if streamed is not None and u >= streamed:
            return ("red", f"a {streamed:g}-unit run on this box streamed "
                           f"weights; this plan is {u:g} units, so the time "
                           f"estimate is not believable")
        if on is not None and u <= on:
            band = on * (1.0 - self.MARGIN)
            if u >= band:
                return ("amber", f"within {self.MARGIN:.0%} of your largest "
                                 f"clean run ({on:g} units) — free models or "
                                 f"restart the instance to reclaim VRAM "
                                 f"before this run")
            return ("green", f"smaller than your largest clean run ({on:g} units)")
        peak = calib.peak_bytes()
        if free_bytes and peak:
            return ("unknown", f"no bracketing yet; your biggest recorded peak "
                               f"was {peak / 2**30:.1f} GiB against "
                               f"{free_bytes / 2**30:.1f} GiB free now")
        return ("unknown", "no flight-recorder history for this device/model "
                           "yet — the fit line calibrates on your first run")


class Estimate(object):
    def __init__(self, geom, multiplier, seconds, seconds_why, fit, fit_why,
                 lines):
        self.geometry = geom
        self.multiplier = multiplier
        self.seconds = seconds
        self.seconds_why = seconds_why
        self.fit = fit
        self.fit_why = fit_why
        self.lines = lines

    def as_dict(self):
        return {"geometry": self.geometry.as_dict(),
                "equivalent_clip_time_x": self.multiplier,
                "seconds": self.seconds, "seconds_why": self.seconds_why,
                "vram_fit": self.fit, "vram_fit_why": self.fit_why}

    def __str__(self):
        return "\n".join(self.lines)


def estimate(geom, model, calib=None, free_bytes=None, overhead_s=6.7):
    """Compose the three factors. Never predicts minutes from hardware
    specs: without calibration layer (b) abstains and says why."""
    calib = calib or Calibration([])
    mult = model.relative_cost(geom)
    lines = [
        f"(a) EQUIVALENT CLIP TIME: {mult:.2f}x a plain render of this clip "
        f"({geom.work_units_plain:g} -> {geom.work_units_plan:g} work units, "
        f"exponent {model.exponent:g}"
        + (f", {model.label}" if model.label else "") + ")",
        f"    frames {geom.frames_plain} -> {geom.frames_plan} "
        f"({geom.frames_plan / max(geom.frames_plain, 1):.2f}x frames — NOT "
        f"the time ratio)",
    ]
    sps, why = calib.seconds_per_step(geom.work_units_plan, model.exponent)
    if sps is None:
        anchor, awhy = model.anchor_seconds_per_step(geom.work_units_plan,
                                                     geom.pixels)
        if anchor is None:
            secs, seconds_why = None, why
            lines.append(f"(b) REAL MINUTES: not calibrated ({why}; {awhy})")
        else:
            secs = None
            seconds_why = f"{why}; anchor-only reference: {awhy}"
            lines.append(
                f"(b) REAL MINUTES: not calibrated ({why}). For reference "
                f"only, this pack's anchor scales to ~{anchor:.1f} s/step "
                f"({awhy}) = ~{(anchor * geom.steps + overhead_s) / 60:.0f} "
                f"min on the box that anchor came from")
    else:
        secs = sps * geom.steps + overhead_s
        seconds_why = why
        lines.append(f"(b) REAL MINUTES: ~{secs / 60:.1f} min "
                     f"({sps:.2f} s/step x {geom.steps} steps + "
                     f"{overhead_s:g}s overhead; {why})")
    fit, fit_why = VramModel().verdict(geom, calib, free_bytes)
    lines.append(f"(c) VRAM FIT: {fit.upper()} — {fit_why} "
                 f"[fit line is a STUB: slope constants unmeasured, TODO T2]")
    return Estimate(geom, mult, secs, seconds_why, fit, fit_why, lines)


def system_stats(port=8189, timeout=5):
    """Live state from ComfyUI /system_stats (universal, no privileges).
    Returns (free_bytes, dict) or (None, None)."""
    import urllib.request
    try:
        with urllib.request.urlopen(
                f"http://127.0.0.1:{int(port)}/system_stats",
                timeout=timeout) as fh:
            d = json.load(fh)
    except Exception:
        return None, None
    devs = d.get("devices") or []
    free = min([int(x.get("vram_free") or 0) for x in devs] or [0])
    return (free or None), d


def monotonic_check(model, pairs):
    """Sanity used by the tests: cost must be non-decreasing in work."""
    vals = [model.relative_cost(g) for g in pairs]
    return all(b >= a - 1e-12 for a, b in zip(vals, vals[1:]))
