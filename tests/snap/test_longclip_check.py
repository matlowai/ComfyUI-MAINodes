"""U46e part 3: the long-clip check reads detail at the saved frame's full resolution, not 416x240.

A synthetic 832x480 take of 6 segments (24 frames each, lossless): smooth shapes throughout; segments 4-6 grow a 1-px
mosaic in the middle (U46d's Standard failure is a fine texture like this), which a 2x2 area downscale to 416x240
averages away. Sound: clicks over a quiet floor (events) in segments 1-3, a sustained harmonic stack (the U46e drone) in
4-6. The check must flag texture on 4-6 at full res, the drone on 4-6, give every segment a row and print its
thresholds and units. No server, no GPU.
usage: comfyui_venv python -I test_longclip_check.py
"""
import json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import longclip_check as L
import snaptest_config as C  # noqa: E402

W, H, N, SEG, FPS = 832, 480, 6, 24, 24


def picture(k):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    g = 90 + 60 * np.sin(x / 70) * np.cos(y / 55) + 40 * np.exp(-((x - 300) ** 2 + (y - 200) ** 2) / 4000)
    g += 3 * np.random.default_rng(0).standard_normal((H, W))   # the same fine grain in every frame: a take's own detail
    if k >= 3:  # segments 4-6: a 1-px mosaic in the middle, growing (about 1.5x, 1.9x, 2.4x of the reference at full res)
        amp = 3 + (k - 3)
        m = np.where((np.add.outer(np.arange(H), np.arange(W)) % 2) == 0, amp, -amp).astype(np.float32)
        g[140:340, 266:566] += m[140:340, 266:566]
    return np.clip(g, 0, 255).astype(np.uint8)


def sound(k):
    t = np.arange(int(SEG / FPS * L.SR)) / L.SR
    rng = np.random.default_rng(k)
    x = 0.002 * rng.standard_normal(len(t))
    if k < 3:  # clicks every 0.25 s: footsteps
        for c in np.arange(0.05, t[-1], 0.25):
            i = int(c * L.SR); x[i:i + 240] += 0.3 * rng.standard_normal(min(240, len(x) - i)) * np.exp(-np.arange(min(240, len(x) - i)) / 60)
    else:      # the drone: a sustained harmonic stack
        x += sum(0.08 / h * np.sin(2 * np.pi * 220 * h * t) for h in range(1, 5))
    return x


def main():
    d = os.path.join(C.out(), "_debug", "longclip_fixture"); os.makedirs(d, exist_ok=True)   # rewritten each run
    wav, out = os.path.join(d, "sound.f32"), os.path.join(d, "take.mkv")
    np.concatenate([sound(k) for k in range(N)]).astype(np.float32).tofile(wav)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-f", "f32le", "-ar", str(L.SR), "-ac", "1", "-i", wav, "-c:v", "ffv1", "-c:a", "pcm_s16le", out], stdin=subprocess.PIPE)
    for k in range(N):
        p = picture(k).tobytes()
        for _ in range(SEG):
            enc.stdin.write(p)
    enc.stdin.close()
    assert enc.wait() == 0
    r = L.check(out, SEG, SEG)
    r3 = L.check(out, SEG, SEG, period=3)
    rows = r["segments"]
    # what U46d's 416x240 reading says about the same frames (2x2 area mean): the mosaic averages out
    small = []
    for s in rows:
        g = L.frame(out, s["middle_frame"], W, H)
        small.append(L.laplacian_var(g.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))))
    small_ratio = [v / small[0] for v in small]
    cli = subprocess.run([sys.executable, "-I", os.path.join(HERE, "longclip_check.py"), out, "--first", str(SEG), "--each", str(SEG)], capture_output=True, text=True)
    lines = cli.stdout.splitlines()
    c = {
        "detail measured at the saved size (832x480)": r["measured_at"].startswith("832x480"),
        "every segment has a row (6)": len(rows) == N and [s["frames"] for s in rows] == [[k * SEG, (k + 1) * SEG] for k in range(N)],
        "segments 1-3 read as the reference (detail 0.95-1.05, no flag)": all(0.95 <= s["detail_ratio"] <= 1.05 and not s["texture_flag"] for s in rows[:3]),
        "the mosaic in 4-6 is flagged at full res (detail >= 1.30)": r["texture_segments"] == [4, 5, 6],
        "the same frames at 416x240 stay under 1.10 (why full res)": all(v < 1.10 for v in small_ratio[3:]),
        "the drone in 4-6 is flagged, the clicks in 1-3 are not": r["drone_segments"] == [4, 5, 6],
        "period 3: segment 4 is compared with segment 1": [s["reference"] for s in r3["segments"]] == [1, 2, 3, 1, 2, 3],
        "the CLI prints its thresholds and units and a row per segment": cli.returncode == 0 and any(l.startswith("thresholds: texture_flag: detail_ratio >= 1.3") for l in lines)
            and any(l.startswith("units: ") for l in lines) and sum(1 for l in lines if l.split(" | ")[0].isdigit()) == N,
    }
    res = {"rows": rows, "small_ratio": small_ratio, "cli": cli.stdout, "cli_err": cli.stderr, "checks": c}
    json.dump(res, open(os.path.join(C.out(), "ui", "test_longclip_check_result.json"), "w"), indent=1)
    bad = [k for k, v in c.items() if not v]
    print(f"longclip {len(c) - len(bad)}/{len(c)} {'FAIL ' + json.dumps(bad) if bad else 'PASS'}")


if __name__ == "__main__":
    main()
