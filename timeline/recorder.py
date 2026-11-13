"""The flight recorder: one local JSON line per render, nothing phones home.

Why it exists: layer (b) of the price meter must never predict minutes from
GPU specs. It predicts from the user's OWN history — s/step against work
units, keyed per device AND per model/quant so new hardware or a new quant
starts a fresh curve.

Peaks come from IN-PROCESS torch counters, deliberately not nvidia-smi:
per-process readout lies on some cards (the Max-Q lesson, GPU1 here).

Least-invasive hook: a pair of nodes the user drops at the front and back of
a graph. H3RecordStart resets the counters and passes its input through;
H3RecordStop reads them, times the gap, and appends the line. No monkey
patching of ComfyUI's executor, nothing that survives a failed run and
poisons the next one.

The 'streamed' flag is read from ComfyUI's own partial-load log lines when a
log path is reachable, else null — never guessed. The window read is bounded
by the BYTE OFFSET captured at start(), so a partial-load line emitted by the
PREVIOUS run can never be attributed to this one.

TODO(T2) — THE CRASH JOURNAL. This pair records successes. A run that OOMs,
is interrupted, or dies mid-VAE never reaches stop(), so it silently leaves
no record — and those are exactly the runs that locate the VRAM cliff, so
their absence CENSORS the calibration set toward optimism (only survivors
are sampled). The fix is not a bigger record, it is a different hook:
executor-level STAGE EVENTS (queued / model loaded / sampling / decoding /
finished|failed) journalled as they happen, so an aborted run leaves a
partial line with its stage and its last known peak. Wants a ComfyUI
execution callback rather than a node pair; deliberately not attempted
tonight, because a hook that survives a crash is exactly the kind of thing
that must not break the pack when it does not.
"""
import json
import os
import time

DEFAULT_PATH = os.path.join(os.path.expanduser("~"), ".cache", "mainodes",
                            "flight_recorder.jsonl")

_STATE = {}


def _torch():
    try:
        import torch
        return torch if torch.cuda.is_available() else None
    except Exception:
        return None


def _log_size(log_path):
    try:
        return os.path.getsize(log_path) if log_path else None
    except OSError:
        return None


def start(key="default", device_index=None, log_path=None):
    t = _torch()
    dev = None
    if t is not None:
        i = t.cuda.current_device() if device_index is None else int(device_index)
        t.cuda.reset_peak_memory_stats(i)
        dev = t.cuda.get_device_name(i)
    _STATE[key] = {"t0": time.time(), "device": dev, "index": device_index,
                   # only log bytes written AFTER this point belong to this run
                   "log_offset": _log_size(log_path), "log_path": log_path}
    return _STATE[key]


def stop(key="default", work_units=0, steps=1, pixels=0, frames=0,
         model="unknown", path=None, log_path=None, extra=None):
    """Append one record. Returns the record (also for the node's report)."""
    st = _STATE.pop(key, None) or {"t0": time.time(), "device": None,
                                   "index": None, "log_offset": None,
                                   "log_path": None}
    log_path = log_path or st.get("log_path")
    wall = time.time() - st["t0"]
    t = _torch()
    peak = None
    if t is not None:
        i = (t.cuda.current_device() if st.get("index") is None
             else int(st["index"]))
        peak = int(t.cuda.max_memory_allocated(i))
    rec = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "device": st.get("device"),
        "model": str(model),
        "work_units": int(work_units),
        "steps": int(steps),
        "pixels": int(pixels),
        "frames": int(frames),
        "wall_s": round(wall, 3),
        "s_per_step": round(wall / max(1, int(steps)), 4),
        "peak_bytes": peak,
        "streamed": read_streamed_flag(log_path, since=st.get("log_offset")),
        "log_offset": st.get("log_offset"),
    }
    if extra:
        rec.update(dict(extra))
    p = os.path.abspath(path or DEFAULT_PATH)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return rec


def read_streamed_flag(log_path, tail_bytes=200000, since=None):
    """ComfyUI says so itself when it cannot fit the weights ('loaded
    partially', 'lowvram'). None when we cannot see a log — an unknown is
    reported as unknown, never as False.

    `since` is the byte offset captured at start(): reading from there is
    what stops the previous run's partial-load line from being read as this
    run's (the misattribution the crash-journal TODO is also about)."""
    if not log_path or not os.path.isfile(log_path):
        return None
    try:
        with open(log_path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            end = fh.tell()
            lo = int(since) if since is not None else max(0, end - tail_bytes)
            fh.seek(min(lo, end))
            tail = fh.read().decode(errors="replace").lower()
    except OSError:
        return None
    return ("loaded partially" in tail or "lowvram" in tail
            or "weight streaming" in tail)


def read(path=None, device=None, model=None):
    out = []
    try:
        with open(os.path.abspath(path or DEFAULT_PATH), encoding="utf-8") as fh:
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
                out.append(r)
    except OSError:
        pass
    return out
