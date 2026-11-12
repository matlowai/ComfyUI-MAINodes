"""Long-clip check (U46e part 3): drift per segment of one long take, read from the saved file.

Detail is the Laplacian variance of each segment's middle frame at the file's own resolution, as a ratio to the reference
segment (segment 1, or the same phase of the first loop with --period). It is measured at full resolution on purpose:
U46d's 416x240 reading said 1.22x where full res said 1.63x and a 100% crop showed Standard's mosaic texture. Audio per
segment: RMS level, spectral flatness and centroid (STFT 1024 / hop 512, bins from 50 Hz, medians over frames), and the
U46e drone test (flatness < 0.03 and centroid < 800 Hz: a sustained harmonic stack, not events).
Every segment gets a row; nothing is cut. Thresholds and units are printed with the table.

usage: comfyui_venv python -I longclip_check.py <video> [--first N] [--each N] [--period P] [--json out.json]
  --first  frames in segment 1 (an extended take: the take's frames - 17; default = --each)
  --each   frames in every later segment (default 102, what one extend clip adds); the last segment takes the rest
  --period compare each segment with the same phase of the first loop (U46d's loops of 3 prompts); default 1
"""
import argparse, json, subprocess, sys
import numpy as np
from scipy import signal

SR = 24000
DETAIL_FLAG = 1.30   # U46d: Standard's mosaic was visible from 1.25-1.35x; Long stayed at or under 1.10x on a locked shot
DRONE_FLATNESS, DRONE_CENTROID_HZ = 0.03, 800.0   # U46e_AUDIO_CHECK


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames,r_frame_rate",
                        "-of", "json", path], capture_output=True, check=True, text=True)
    s = json.loads(r.stdout)["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), int(s["nb_read_frames"]), float(num) / float(den)


def frame(path, n, w, h):
    """frame n as gray float32 at the file's own size (no scaling)"""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, np.uint8)[: w * h].reshape(h, w).astype(np.float32)


def laplacian_var(g):
    """variance of the 4-neighbour Laplacian (cv2.Laplacian ksize 1), border pixels left out"""
    lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4 * g[1:-1, 1:-1]
    return float(lap.var())


def audio(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.int16).astype(np.float64) / 32768 if r.returncode == 0 else np.zeros(0)


def sound(x):
    if len(x) < 1024:
        return {"db": None, "flatness": None, "centroid_hz": None, "drone": None}
    f, _, Z = signal.stft(x, SR, nperseg=1024, noverlap=512)
    P = np.abs(Z) ** 2 + 1e-14
    fr, ff = P[f >= 50], f[f >= 50]
    flat = float(np.median(np.exp(np.log(fr).mean(0)) / fr.mean(0)))
    cen = float(np.median((ff[:, None] * fr).sum(0) / fr.sum(0)))
    return {"db": float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)), "flatness": flat, "centroid_hz": cen, "drone": flat < DRONE_FLATNESS and cen < DRONE_CENTROID_HZ}


def segments(total, first, each):
    out = [[0, min(first, total)]]
    while out[-1][1] < total:
        a = out[-1][1]
        b = a + each
        if total - b < each:
            b = total   # the last extend clip keeps more frames (119 for 102): it takes the rest
        out.append([a, b])
    return out


def check(path, first=None, each=102, period=1):
    w, h, total, fps = probe(path)
    segs, x = segments(total, first or each, each), audio(path)
    rows = []
    for k, (a, b) in enumerate(segs):
        mid = (a + b) // 2
        rows.append({"segment": k + 1, "frames": [a, b], "seconds": [round(a / fps, 2), round(b / fps, 2)], "middle_frame": mid,
                     "lap_var": laplacian_var(frame(path, mid, w, h)), **sound(x[int(a / fps * SR): int(b / fps * SR)])})
    for k, r in enumerate(rows):
        ref = rows[k % period]
        r["reference"] = ref["segment"]
        r["detail_ratio"] = r["lap_var"] / ref["lap_var"] if ref["lap_var"] else None
        r["texture_flag"] = r["detail_ratio"] is not None and r["detail_ratio"] >= DETAIL_FLAG
    return {"file": path, "size": [w, h], "frames": total, "fps": fps, "measured_at": f"{w}x{h} (the saved frame, no scaling)",
            "thresholds": {"texture_flag": f"detail_ratio >= {DETAIL_FLAG} (Laplacian variance of the middle frame / the reference segment's)",
                           "drone": f"spectral flatness < {DRONE_FLATNESS} and centroid < {DRONE_CENTROID_HZ:.0f} Hz"},
            "units": {"lap_var": "grey levels^2 (0-255 scale)", "db": "dBFS RMS, 24 kHz mono", "flatness": "0-1 (1 = white noise)", "centroid_hz": "Hz"},
            "segments": rows, "texture_segments": [r["segment"] for r in rows if r["texture_flag"]], "drone_segments": [r["segment"] for r in rows if r["drone"]]}


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("video")
    p.add_argument("--first", type=int)
    p.add_argument("--each", type=int, default=102)
    p.add_argument("--period", type=int, default=1)
    p.add_argument("--json")
    a = p.parse_args()
    r = check(a.video, a.first, a.each, a.period)
    if a.json:
        json.dump(r, open(a.json, "w"), indent=1)
    print(f"{r['file']}: {r['frames']} frames at {r['fps']:g} fps, detail measured at {r['measured_at']}")
    print("thresholds: " + "; ".join(f"{k}: {v}" for k, v in r["thresholds"].items()))
    print("units: " + "; ".join(f"{k}: {v}" for k, v in r["units"].items()))
    print("seg | frames | seconds | ref | lap_var | detail | texture | dB | flatness | centroid Hz | drone")
    fmt = lambda v, f: "-" if v is None else format(v, f)
    for s in r["segments"]:
        print(f"{s['segment']} | {s['frames'][0]}-{s['frames'][1]} | {s['seconds'][0]}-{s['seconds'][1]} | {s['reference']} | {s['lap_var']:.1f} | {fmt(s['detail_ratio'], '.2f')} | "
              f"{'TEXTURE' if s['texture_flag'] else 'ok'} | {fmt(s['db'], '.1f')} | {fmt(s['flatness'], '.3f')} | {fmt(s['centroid_hz'], '.0f')} | {'DRONE' if s['drone'] else 'ok' if s['drone'] is not None else '-'}")
    print(f"texture segments: {r['texture_segments'] or 'none'}; drone segments: {r['drone_segments'] or 'none'}")


if __name__ == "__main__":
    sys.exit(main())
