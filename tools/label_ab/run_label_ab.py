#!/usr/bin/env python3
"""The label-only A/B for H3 Cond Strength: does the timestep label matter?

THE QUESTION. Core gives a stream's guide rows and reference rows ONE
timestep label (`seg_t["cond"]` and `seg_t["ref_img"]`, both
`max(t, aug)`), so when the two kinds are conditioned at different strengths,
one of them is labelled at the other's noise level. H3 Cond Strength exposes
that as `label_follows` rather than hiding it. Whether it is worth a core
change to fix properly is a measurement, not an opinion - and this is the
measurement.

WHY THIS ISOLATES THE LABEL. Both arms of a pair use the SAME strengths, so
the condition rows' CONTENT is bit-identical (asserted offline in
tests/test_h3_cond_strength.py). Only `label_follows` differs, which moves
nothing but `visual_cond_noise_aug`, which core reads only when building its
timestep table. Same seed, same latents, same everything else. A difference
between the arms is the label and nothing else.

THE MATRIX. Guide pinned at core's own default, references swept down:

    guide / reference = 0.999/0.8, 0.999/0.5, 0.999/0.25, 0.999/0.0

The bound |max(t, a_label) - max(t, a_kind)| <= |a_label - a_kind| predicts
a DOSE RESPONSE: no difference at a zero split, growing with the gap, and
confined to the part of sampling before t overtakes both augmentations. If
the measured differences follow that shape, the label is doing semantic work.
If they are flat, or track nothing, it is not - and the honest widget stays.

    python3 tools/label_ab/run_label_ab.py --workflow examples/motion_pipeline_extend_api.json \\
        --host 127.0.0.1:8189 --out /mnt/work/ai/comfyui/output/label_ab

Offline first: `--dry-run` exercises the graph surgery and the metrics on
synthetic frames, with no ComfyUI and no GPU, so the plumbing is known good
before a GPU slot is spent.

OUTPUT. Per matrix row: both arms' clips, a metrics row (PSNR, SSIM, mean and
max absolute error), and a per-frame absolute-error curve. `metrics.csv` is
written keyed by clip stem, which is what tools/compare_deck/make_manifest.py
merges on, so the review page is two commands away.

NOT DONE HERE, and deliberately: LPIPS (needs weights this box should not
download on a whim) and the early/mid/late latent tap (needs a sampler-side
hook; `concept_lab`'s tap is the place to add it if the pixel result turns
out to be ambiguous).
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request

MATRIX = [(0.999, 0.8), (0.999, 0.5), (0.999, 0.25), (0.999, 0.0)]
ARMS = ("guides", "references")


# --------------------------------------------------------------------------
# graph surgery
# --------------------------------------------------------------------------

def model_chain(graph):
    """(consumers, source_of) for every node that takes a `model` input."""
    source_of = {}
    for nid, node in graph.items():
        src = node.get("inputs", {}).get("model")
        if isinstance(src, list) and src:
            source_of[nid] = str(src[0])
    return source_of


def _ancestors(nid, source_of):
    """The model-chain nodes between `nid` and the loader, nearest first."""
    out, seen = [], set()
    cur = source_of.get(nid)
    while cur is not None and cur not in seen:
        seen.add(cur)
        out.append(cur)
        cur = source_of.get(cur)
    return out


def find_injection_point(graph):
    """Where to splice the node, and which edges to repoint.

    NOT "the sampler". A real graph here runs the model through a stack of
    patch nodes and then FANS OUT: this pack's extend pipeline has two passes,
    each with its own BasicGuider and BasicScheduler, all fed from one shared
    chain. Intercepting one guider would patch one pass and leave the other
    rendering the control - an A/B that silently compares halves of different
    things.

    So the anchor is the DEEPEST node every guider descends from, and every
    consumer of that node is repointed at ours. That is what dropping the
    node into the patch chain by hand does, and it covers every pass.

    Returns (anchor_id, [consumer ids to repoint]).
    """
    source_of = model_chain(graph)
    if not source_of:
        raise SystemExit("no node in this graph takes a `model` input; "
                         "is it an API-format workflow?")
    # the nodes that actually RUN the model (a scheduler only wants sigmas)
    runners = [nid for nid in source_of
               if any(k in graph[nid].get("class_type", "").lower()
                      for k in ("guider", "sampler"))]
    if not runners:
        runners = [nid for nid in source_of if nid not in set(source_of.values())]
    chains = [set(_ancestors(nid, source_of)) | {nid} for nid in runners]
    common = set.intersection(*chains) if chains else set()
    common -= set(runners)
    if not common:
        raise SystemExit(
            "the %d model consumer(s) in this graph (%s) share no common "
            "ancestor, so one node cannot patch them all."
            % (len(runners), ", ".join(sorted(runners))))
    # deepest = furthest from the loader = closest to the runners
    anchor = max(common, key=lambda n: len(_ancestors(n, source_of)))
    repoint = [nid for nid, src in source_of.items() if src == anchor]
    return anchor, repoint


def inject_cond_strength(graph, guide, reference, label_follows, node_id="mainodes_cs"):
    """Splice H3CondStrength into the model chain ahead of every runner.

    Returns the modified graph. It is spliced, never appended: every consumer
    of the anchor must receive OUR model, or that pass silently renders the
    control.
    """
    graph = json.loads(json.dumps(graph))            # never mutate the caller's
    if node_id in graph:
        raise SystemExit("node id %r already present in the graph" % node_id)
    anchor, repoint = find_injection_point(graph)
    graph[node_id] = {
        "class_type": "H3CondStrength",
        "_meta": {"title": "H3 Cond Strength (label A/B)"},
        "inputs": {"model": [anchor, 0],
                   "guide_strength": guide,
                   "reference_strength": reference,
                   "reference_strengths": "",
                   "guide_audio_strength": -1.0,
                   "reference_audio_strength": -1.0,
                   "label_follows": label_follows},
    }
    for nid in repoint:
        graph[nid]["inputs"]["model"] = [node_id, 0]
    return graph


def set_seed(graph, seed):
    """Pin every seed/noise_seed widget in the graph. Both arms must draw the
    same noise or the comparison measures the sampler, not the label."""
    n = 0
    for node in graph.values():
        for key in ("seed", "noise_seed"):
            if key in node.get("inputs", {}) and not isinstance(node["inputs"][key], list):
                node["inputs"][key] = seed
                n += 1
    return n


def set_prefix(graph, prefix):
    """Give this arm its own filename_prefix so the two do not interleave."""
    hits = []
    for nid, node in graph.items():
        inputs = node.get("inputs", {})
        if "filename_prefix" in inputs and not isinstance(inputs["filename_prefix"], list):
            inputs["filename_prefix"] = prefix
            hits.append(nid)
    return hits


# --------------------------------------------------------------------------
# the ComfyUI API
# --------------------------------------------------------------------------

def post(host, path, payload):
    req = urllib.request.Request("http://%s%s" % (host, path),
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(host, path, timeout=30):
    with urllib.request.urlopen("http://%s%s" % (host, path), timeout=timeout) as r:
        return json.load(r)


def queue_and_wait(host, graph, poll=3.0, timeout=3600):
    """Queue one prompt, wait for it, return its history outputs."""
    resp = post(host, "/prompt", {"prompt": graph})
    pid = resp["prompt_id"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            hist = get(host, "/history/%s" % pid)
        except urllib.error.URLError as e:
            raise SystemExit("lost the ComfyUI at %s: %s" % (host, e))
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error" or status.get("completed") is False:
                raise SystemExit("render failed for %s: %s"
                                 % (pid, json.dumps(status)[:400]))
            return entry.get("outputs", {})
        time.sleep(poll)
    raise SystemExit("timed out after %ds waiting for %s" % (timeout, pid))


def output_files(outputs, out_root):
    """Absolute paths of everything the run wrote, videos and images alike."""
    paths = []
    for node_out in outputs.values():
        for key in ("images", "gifs", "videos", "audio"):
            for item in node_out.get(key, []) or []:
                sub = item.get("subfolder") or ""
                paths.append(os.path.join(out_root, item.get("type", "output"),
                                          sub, item["filename"]))
    return paths


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------

def load_frames(path):
    """[T, H, W, C] float32 in [0, 1] from a video or an image, via ffmpeg."""
    import subprocess

    import numpy as np
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0:s=,", path],
        capture_output=True, text=True)
    if probe.returncode != 0:
        raise SystemExit("ffprobe failed on %s: %s" % (path, probe.stderr.strip()))
    w, h = (int(v) for v in probe.stdout.strip().split(",")[:2])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True)
    if raw.returncode != 0:
        raise SystemExit("ffmpeg failed on %s: %s" % (path, raw.stderr.decode()[:300]))
    buf = np.frombuffer(raw.stdout, dtype=np.uint8)
    frames = buf.reshape(-1, h, w, 3).astype("float32") / 255.0
    return frames


def psnr(a, b):
    import numpy as np
    mse = float(((a - b) ** 2).mean())
    if mse == 0.0:
        return float("inf")
    return float(10.0 * np.log10(1.0 / mse))


def ssim(a, b):
    """Global SSIM per frame, averaged. Not windowed - this is a screening
    metric for "did anything move", not a perceptual score."""
    import numpy as np
    c1, c2 = (0.01 ** 2), (0.03 ** 2)
    out = []
    for fa, fb in zip(a, b):
        ma, mb = fa.mean(), fb.mean()
        va, vb = fa.var(), fb.var()
        cov = ((fa - ma) * (fb - mb)).mean()
        out.append(float(((2 * ma * mb + c1) * (2 * cov + c2))
                         / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))))
    return float(np.mean(out)) if out else float("nan")


def compare(path_a, path_b):
    """Metrics plus the per-frame absolute-error curve."""
    import numpy as np
    a, b = load_frames(path_a), load_frames(path_b)
    n = min(len(a), len(b))
    if n == 0:
        raise SystemExit("no frames decoded from %s / %s" % (path_a, path_b))
    a, b = a[:n], b[:n]
    diff = np.abs(a - b)
    curve = [float(d.mean()) for d in diff]
    return {"frames": n, "psnr": psnr(a, b), "ssim": ssim(a, b),
            "mean_abs": float(diff.mean()), "max_abs": float(diff.max()),
            "identical": bool(np.array_equal(a, b))}, curve


# --------------------------------------------------------------------------

def dry_run():
    """Validate the graph surgery and the metrics with no ComfyUI and no GPU."""
    import numpy as np
    print("dry run: graph surgery")
    graph = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {}},
             "2": {"class_type": "KSamplerAdvanced",
                   "inputs": {"model": ["1", 0], "noise_seed": 7}},
             "3": {"class_type": "SaveVideo",
                   "inputs": {"filename_prefix": "video/x", "video": ["2", 0]}}}
    g = inject_cond_strength(graph, 0.999, 0.5, "references")
    assert g["2"]["inputs"]["model"] == ["mainodes_cs", 0], "runner not intercepted"
    assert g["mainodes_cs"]["inputs"]["model"] == ["1", 0], "node not spliced in"
    assert g["mainodes_cs"]["inputs"]["label_follows"] == "references"
    assert graph["2"]["inputs"]["model"] == ["1", 0], "caller's graph was mutated"

    # the shape that actually matters: a patch chain that FANS OUT to two
    # passes. Every runner must end up behind our node, not just the first.
    fan = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {}},
           "p": {"class_type": "PathchSageAttentionKJ", "inputs": {"model": ["1", 0]}},
           "l": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["p", 0]}},
           "gA": {"class_type": "BasicGuider", "inputs": {"model": ["l", 0]}},
           "gB": {"class_type": "BasicGuider", "inputs": {"model": ["l", 0]}},
           "sch": {"class_type": "BasicScheduler", "inputs": {"model": ["l", 0]}}}
    anchor, repoint = find_injection_point(fan)
    assert anchor == "l", ("anchor should be the deepest shared node", anchor)
    gf = inject_cond_strength(fan, 0.999, 0.5, "guides")
    assert gf["gA"]["inputs"]["model"] == ["mainodes_cs", 0]
    assert gf["gB"]["inputs"]["model"] == ["mainodes_cs", 0], "second pass left unpatched"
    assert gf["sch"]["inputs"]["model"] == ["mainodes_cs", 0]
    assert gf["mainodes_cs"]["inputs"]["model"] == ["l", 0]
    assert set_seed(g, 1234) == 1 and g["2"]["inputs"]["noise_seed"] == 1234
    assert set_prefix(g, "video/ab") == ["3"]
    # both arms must differ ONLY in label_follows
    ga = inject_cond_strength(graph, 0.999, 0.5, "guides")
    gb = inject_cond_strength(graph, 0.999, 0.5, "references")
    da, db = ga["mainodes_cs"]["inputs"], gb["mainodes_cs"]["inputs"]
    diff = [k for k in da if da[k] != db[k]]
    assert diff == ["label_follows"], ("the arms differ in more than the label", diff)
    print("   ok: sampler intercepted, seeds pinned, arms differ only in label_follows")

    print("dry run: metrics")
    rng = np.random.default_rng(0)
    a = rng.random((4, 8, 8, 3), dtype="float32")
    assert psnr(a, a) == float("inf") and abs(ssim(a, a) - 1.0) < 1e-6
    b = a.copy(); b[2, 0, 0, 0] += 0.5
    assert psnr(a, b) < 100 and ssim(a, b) < 1.0
    print("   ok: psnr/ssim behave at identity and under a single-pixel change")
    print("\nDRY RUN OK - the plumbing is good; a GPU slot is what is missing.")


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workflow", help="API-format workflow with a guide AND references")
    p.add_argument("--host", default="127.0.0.1:8189")
    p.add_argument("--out", default="label_ab", help="where to write metrics + curves")
    p.add_argument("--comfy-output", default="/mnt/work/ai/comfyui/output",
                   help="the ComfyUI output root, for resolving result paths")
    p.add_argument("--seed", type=int, default=15988)
    p.add_argument("--dry-run", action="store_true",
                   help="validate surgery + metrics offline, render nothing")
    a = p.parse_args()

    if a.dry_run:
        dry_run()
        return 0
    if not a.workflow:
        p.error("--workflow is required unless --dry-run")

    with open(a.workflow) as fh:
        base = json.load(fh)
    if "nodes" in base and "links" in base:
        p.error("this is a UI workflow; export the API format "
                "(tools/ltx25/ui2api.py converts one)")
    os.makedirs(a.out, exist_ok=True)

    rows, curves = [], {}
    for guide, reference in MATRIX:
        clips = {}
        for arm in ARMS:
            stem = "label_ab_g%s_r%s_%s" % (guide, reference, arm)
            g = inject_cond_strength(base, guide, reference, arm)
            set_seed(g, a.seed)
            set_prefix(g, "video/%s" % stem)
            print("rendering %s ..." % stem, flush=True)
            outs = output_files(queue_and_wait(a.host, g), a.comfy_output)
            vids = [f for f in outs if f.lower().endswith((".mp4", ".webm", ".mov"))]
            if not vids:
                raise SystemExit("no video came back for %s (got %s)" % (stem, outs))
            clips[arm] = vids[0]
        m, curve = compare(clips[ARMS[0]], clips[ARMS[1]])
        key = "g%s_r%s" % (guide, reference)
        m.update({"pair": key, "guide": guide, "reference": reference,
                  "split": round(guide - reference, 4),
                  "clip_guides": clips["guides"], "clip_references": clips["references"]})
        rows.append(m)
        curves[key] = curve
        print("   %s: psnr %.2f  ssim %.5f  mean|d| %.5f  identical=%s"
              % (key, m["psnr"], m["ssim"], m["mean_abs"], m["identical"]))

    with open(os.path.join(a.out, "metrics.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(a.out, "curves.json"), "w") as fh:
        json.dump(curves, fh, indent=1)

    print("\nDOSE RESPONSE (the bound predicts this grows with the split, and "
          "that a zero split is identical):")
    for r in sorted(rows, key=lambda r: r["split"]):
        print("   split %.3f -> mean|d| %.6f   psnr %.2f   %s"
              % (r["split"], r["mean_abs"], r["psnr"],
                 "IDENTICAL" if r["identical"] else ""))
    print("\nwrote %s and curves.json" % os.path.join(a.out, "metrics.csv"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
