#!/usr/bin/env python3
"""Splice LTX-2.5 window de-ropes back into one full-length, frame-aligned clip.

LTX cannot exceed 57 source frames per pass at d=16 (positional_embedding_max_pos
[0]=20 with the time coordinate in absolute seconds), so full coverage of a
124-frame clip means three overlapping windows. This joins them.

Alignment is the whole job, so it is CHECKED, not assumed: adjacent windows share
20+ source frames, and those frames are the same source content rendered twice.
The script reports PSNR between the two renderings across each overlap before it
blends. A low number there means the windows are misaligned and the splice would
be silently wrong.

Audio comes from the SOURCE, not the windows: a de-rope's exact recovery restores
the world clock frame for frame, so the original track still lines up, and each
window's own audio is a 57-frame fragment with its own offset.

    python3 splice_windows.py --out panrun_ltx_d070_full \
        --source .../panrun_baseline_00001_.mp4 \
        --win 0:.../panrun_full_d070_w0_00001_.mp4 \
        --win 33:.../panrun_full_d070_w33_00001_.mp4 \
        --win 67:.../panrun_full_d070_w67_00001_.mp4
"""
import argparse, os, subprocess, sys
import numpy as np

FF = ["nice", "-n", "10", "ffmpeg", "-v", "error", "-threads", "4"]
OUT = os.environ.get("LTX25_OUT", os.getcwd())   # where the window renders live


def probe(p):
    o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,nb_frames", "-of", "csv=p=0", p],
                       capture_output=True, text=True).stdout.strip().split(",")
    return int(o[0]), int(o[1]), int(o[2])


def frames(p, w, h):
    raw = subprocess.run(FF + ["-i", p, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True).stdout
    n = len(raw) // (w * h * 3)
    return np.frombuffer(raw[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)


def psnr(a, b):
    mse = float(((a.astype(np.float32) - b.astype(np.float32)) ** 2).mean())
    return 99.0 if mse < 1e-9 else 10 * np.log10(255.0 ** 2 / mse)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--source", required=True, help="full-length clip: audio and frame count")
    ap.add_argument("--win", action="append", required=True, metavar="START:PATH")
    ap.add_argument("--blend", type=int, default=8, help="crossfade frames at each join")
    ap.add_argument("--fps", type=int, default=24)
    a = ap.parse_args()

    wins = []
    for spec in a.win:
        s, p = spec.split(":", 1)
        wins.append((int(s), p))
    wins.sort()
    W, H, NSRC = probe(a.source)
    canvas = np.zeros((NSRC, H, W, 3), np.float32)
    weight = np.zeros((NSRC, 1, 1, 1), np.float32)

    loaded = []
    for start, p in wins:
        f = frames(p, W, H)
        loaded.append((start, f))
        print(f"  window {start:3d}..{start + len(f) - 1:3d}  {len(f)} frames  {os.path.basename(p)}")

    # ALIGNMENT CHECK before blending
    ok = True
    for i in range(len(loaded) - 1):
        s0, f0 = loaded[i]
        s1, f1 = loaded[i + 1]
        lo, hi = s1, min(s0 + len(f0), s1 + len(f1))
        if hi <= lo:
            print(f"  GAP between window {s0} and {s1} - not full coverage")
            ok = False
            continue
        A = f0[lo - s0:hi - s0]
        B = f1[lo - s1:hi - s1]
        d = psnr(A, B)
        print(f"  overlap {lo}..{hi-1} ({hi-lo} frames) between w{s0} and w{s1}: {d:.2f} dB")
        if d < 12:
            print("    ^ LOW: the two windows disagree about the same source frames.")
            print("      Either they are misaligned, or the denoise is high enough that")
            print("      the two renderings genuinely diverge. Check before trusting the join.")
            ok = False

    # ramped blend across the overlaps
    for start, f in loaded:
        n = len(f)
        w = np.ones(n, np.float32)
        b = min(a.blend, n // 2)
        if b > 0:
            ramp = np.linspace(0, 1, b + 2)[1:-1]
            if start > 0:
                w[:b] = ramp
            if start + n < NSRC:
                w[-b:] = ramp[::-1]
        canvas[start:start + n] += f.astype(np.float32) * w[:, None, None, None]
        weight[start:start + n] += w[:, None, None, None]

    if (weight == 0).any():
        print(f"  UNCOVERED frames: {int((weight == 0).sum())} - refusing")
        sys.exit(1)
    out = np.clip(canvas / weight, 0, 255).astype(np.uint8)

    dst = f"{OUT}/{a.out}_00001_.mp4"
    pr = subprocess.Popen(FF + ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                                "-r", str(a.fps), "-i", "-", "-i", a.source,
                                "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "14",
                                "-preset", "veryfast", "-pix_fmt", "yuv420p",
                                "-c:a", "aac", "-ar", "48000", "-b:a", "192k",
                                "-movflags", "+faststart", "-shortest", "-y", dst],
                          stdin=subprocess.PIPE)
    pr.stdin.write(out.tobytes())
    pr.stdin.close()
    pr.wait()
    print(f"  wrote {dst}  ({len(out)} frames, source audio at 48 kHz)")
    print("  alignment: OK" if ok else "  alignment: SUSPECT - see above")


if __name__ == "__main__":
    main()
