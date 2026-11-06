"""Snap's "keep eye colour" step (G3): a stage 2 redraw re-synthesises iris colour from its own prior (the u102b study:
one character's brown went grey, another's amber went olive), so after it this node re-tints the irises toward the Cast
front's: the iris pixels' Lab a/b shift by (Cast iris median - this frame's iris median) x strength, L untouched, so the
pupil, outline, highlights and shading keep their values. The irises come from SAM 3.1 (core SAM3_Detect, text only,
no seeding; Snap ANDs "eye:2" at 0.6 with "pupil:2, iris of the eye:2" at 0.3: on anime faces "pupil" is often the
iris disc and "iris of the eye" fills in where it is only the dark centre). Only a pair of irises side by side counts:
a profile, a back or a lone eye-like thing (a gold hair bell was found as an eye at 0.6) passes through untouched; a
Cast whose iris is grey or not found skips the whole step rather than invent a colour. The report says what was done
to every frame.
SNAP-R134 keep eye colour is optional, after stage 2, SAM-located · SNAP-R85 a reference is redrawn · SNAP-R11 warn,
never block · SNAP-R18 local only · see docs/snap/SNAP_RULES.md"""
import json

import torch

from comfy_api.latest import io

SRGB_TO_XYZ = ((0.412453, 0.357580, 0.180423), (0.212671, 0.715160, 0.072169), (0.019334, 0.119193, 0.950227))
WHITE = (0.95047, 1.0, 1.08883)  # D65, as skimage's rgb2lab (the study's measures)
GREY_CHROMA = 6.0  # a Cast iris below this is grey: no colour to keep, and none to invent
MAX_AREA = 0.02  # a mask over 2 % of the frame is a face or a body, not two irises
MIN_PIXELS = 12  # fewer iris pixels than this can't give a median worth trusting
PAIR_RATIO = 4  # two irises of one face differ in size by less than this
MEDIAN_L = (32, 60)  # the lit iris whose median a/b is compared (ramp >= 0.5): the dark top and pupil carry little colour


def rgb_to_lab(rgb):
    """CIE Lab (D65) of sRGB values in 0-1, (..., 3)."""
    lin = torch.where(rgb <= 0.04045, rgb / 12.92, ((rgb.clamp(min=0) + 0.055) / 1.055) ** 2.4)
    xyz = lin @ torch.tensor(SRGB_TO_XYZ, device=rgb.device, dtype=rgb.dtype).T / torch.tensor(WHITE, device=rgb.device, dtype=rgb.dtype)
    f = torch.where(xyz > 0.008856, xyz.clamp(min=0.008856) ** (1 / 3), 7.787 * xyz + 16 / 116)
    return torch.stack((116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])), -1)


def lab_to_rgb(lab):
    """sRGB (0-1, not clipped) of CIE Lab (D65), (..., 3)."""
    fy = (lab[..., 0] + 16) / 116
    f = torch.stack((fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200), -1)
    xyz = torch.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * torch.tensor(WHITE, device=lab.device, dtype=lab.dtype)
    lin = xyz @ torch.linalg.inv(torch.tensor(SRGB_TO_XYZ, device=lab.device, dtype=lab.dtype)).T
    return torch.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin.clamp(min=0.0031308) ** (1 / 2.4) - 0.055)


def lightness_weight(L):
    """How much of the shift a pixel takes by its lightness: 0 at L 22 rising to 1 at L 42 so the pupil and outline stay
    (u102b's ramp), back to 0 from L 60 to 75 so sclera and highlights stay."""
    return ((L - 22) / 20).clamp(0, 1) * ((75 - L) / 15).clamp(0, 1)


def iris(image, mask):
    """One picture's irises from its SAM mask: (box, Lab of the box, weight, median a/b, pixels), or a str saying why
    there are none. Two blobs side by side (two runs of the mask's columns) of similar size, the eyes of a face toward
    the camera. The mask is eroded ~1 px per 832 px of the short side, and pixels that close to anything bright (sclera,
    skin, highlights) take no shift: u102b's halo, where edge pixels between a dark iris and white turned orange."""
    H, W = mask.shape
    m = mask > 0.5
    area = int(m.sum())
    if area == 0:
        return "no iris found"
    if area > MAX_AREA * H * W:
        return f"the mask is {100 * area / (H * W):.1f} % of the frame: too big for irises"
    cols = m.sum(0).tolist()
    runs, run = [], 0
    for c in cols + [0]:
        if c:
            run += c
        elif run:
            runs.append(run)
            run = 0
    if len(runs) != 2 or max(runs) > PAIR_RATIO * min(runs):
        return f"{len(runs)} blob(s) of {runs} px side by side, not a pair of irises: a profile, a back or something else"
    r = max(1, round(min(H, W) / 832))
    ys, xs = torch.nonzero(m, as_tuple=True)
    y0, y1, x0, x1 = max(ys.min().item() - r, 0), min(ys.max().item() + r + 1, H), max(xs.min().item() - r, 0), min(xs.max().item() + r + 1, W)
    core = -torch.nn.functional.max_pool2d(-m[y0:y1, x0:x1].float()[None, None], 2 * r + 1, 1, r)[0, 0]
    lab = rgb_to_lab(image[y0:y1, x0:x1, :3].to(mask.device))
    near_bright = torch.nn.functional.max_pool2d((lab[..., 0] > 75).float()[None, None], 2 * r + 1, 1, r)[0, 0]
    weight = core * (1 - near_bright) * lightness_weight(lab[..., 0])
    sel = (weight > 0) & (lab[..., 0] > MEDIAN_L[0]) & (lab[..., 0] < MEDIAN_L[1])
    n = int(sel.sum())
    if n < MIN_PIXELS:
        return f"{n} iris pixels between L {MEDIAN_L[0]} and {MEDIAN_L[1]} inside the eroded mask, off bright edges: too few to read"
    return (y0, y1, x0, x1), lab, weight, (lab[..., 1][sel].median().item(), lab[..., 2][sel].median().item()), n


def keep_eye_colour(images, masks, reference, reference_mask, strength):
    """The node's work: (images, report dict). Frames go one at a time, only their iris box is touched."""
    ref = iris(reference[0], (reference_mask > 0.5).any(0))
    report = {"skipped": None, "target": None, "strength": strength, "touched": 0, "frames": len(images), "mean_shift": None, "per_frame": []}
    if isinstance(ref, str):
        report["skipped"] = f"the Cast picture's iris: {ref}"
        return images, report
    ta, tb = ref[3]
    chroma = (ta ** 2 + tb ** 2) ** 0.5
    report["target"] = {"a": round(ta, 2), "b": round(tb, 2), "chroma": round(chroma, 2), "pixels": ref[4]}
    if chroma < GREY_CHROMA:
        report["skipped"] = f"the Cast's iris is grey (chroma {chroma:.1f} < {GREY_CHROMA:g}): no colour to keep"
        return images, report
    out = images.clone()
    shifts = []
    for i in range(len(images)):
        found = iris(images[i], masks[i].to(images.device))
        if isinstance(found, str):
            report["per_frame"].append({"frame": i, "touched": False, "why": found})
            continue
        (y0, y1, x0, x1), lab, weight, (a, b), n = found
        da, db = (ta - a) * strength, (tb - b) * strength
        shifted = lab.clone()
        shifted[..., 1] += weight * da
        shifted[..., 2] += weight * db
        # the change goes on as a difference of two conversions: a pixel with weight 0 (or strength 0) is left exactly as it was
        out[i, y0:y1, x0:x1, :3] = (images[i, y0:y1, x0:x1, :3] + (lab_to_rgb(shifted) - lab_to_rgb(lab)).to(images.dtype)).clamp(0, 1)
        shifts.append((da, db))
        report["per_frame"].append({"frame": i, "touched": True, "pixels": n, "from": [round(a, 2), round(b, 2)], "shift": [round(da, 2), round(db, 2)]})
    report["touched"] = len(shifts)
    if shifts:
        report["mean_shift"] = [round(sum(s[0] for s in shifts) / len(shifts), 2), round(sum(s[1] for s in shifts) / len(shifts), 2)]
    return out, report


class MAISnapEyeColour(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapEyeColour",
            display_name="Snap: Keep eye colour",
            category="MAINodes/snap",
            description="Re-tints the irises of a video's frames (or a still) toward the eye colour of a Cast front picture: "
                        "the iris pixels' Lab a/b shift toward the Cast's iris median, lightness untouched, so pupils, outlines "
                        "and highlights stay. Irises from SAM3 Detect; frames without one pass through untouched. Skips when "
                        "the Cast's iris is grey or not found. For after a stage 2 redraw, which can shift eye colour.",
            inputs=[io.Image.Input("images", tooltip="the frames"),
                    io.Mask.Input("masks", tooltip="SAM3 Detect on the frames, one mask per frame: the irises"),
                    io.Image.Input("reference", tooltip="the Cast front picture"),
                    io.Mask.Input("reference_mask", tooltip="SAM3 Detect on the Cast front: its irises"),
                    io.Float.Input("strength", default=1.0, min=0.0, max=1.0, step=0.05, tooltip="how far toward the Cast's colour: 1 = all the way")],
            outputs=[io.Image.Output(display_name="images"), io.String.Output(display_name="report", tooltip="JSON: the target, every frame touched or why not, the mean shift, or why it skipped")],
        )

    @classmethod
    def execute(cls, images, masks, reference, reference_mask, strength) -> io.NodeOutput:
        out, report = keep_eye_colour(images, masks, reference, reference_mask, strength)
        return io.NodeOutput(out, json.dumps(report))


NODE_CLASS_MAPPINGS = {"MAISnapEyeColour": MAISnapEyeColour}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapEyeColour": "Snap: Keep eye colour"}
