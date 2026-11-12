#!/usr/bin/env python3
"""Whisper word error rate of rendered dialogue clips against the scripted lines (dial audio check).

usage: dial_dialogue_wer.py "<reference text>" <label=clip.mp4> ...
Model: openai/whisper-large-v3-turbo from the local HF cache (transformers pipeline, English, greedy), audio extracted
with ffmpeg to 16 kHz mono. WER = word-level Levenshtein distance / reference words, after lowercasing and stripping
punctuation. Also prints integrated loudness (ebur128 LUFS) for the same clip.
"""
import re
import subprocess
import sys

import numpy as np
import torch
from transformers import pipeline


def norm(t):
    return re.sub(r"[^a-z0-9' ]+", " ", t.lower()).split()


def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = np.arange(len(h) + 1)
    for i, rw in enumerate(r, 1):
        prev, d[0] = d.copy(), i
        for j, hw in enumerate(h, 1):
            d[j] = min(prev[j] + 1, d[j - 1] + 1, prev[j - 1] + (rw != hw))
    return d[len(h)] / max(len(r), 1)


def audio(mp4):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", mp4, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def lufs(mp4):
    out = subprocess.run(["ffmpeg", "-nostats", "-i", mp4, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", out)
    return float(m[-1]) if m else float("nan")


def main():
    ref, clips = sys.argv[1], sys.argv[2:]
    asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", torch_dtype=torch.float16,
                   device="cuda:0" if torch.cuda.is_available() else "cpu")
    for c in clips:
        label, mp4 = c.split("=", 1)
        hyp = asr({"raw": audio(mp4), "sampling_rate": 16000}, generate_kwargs={"language": "english", "task": "transcribe"})["text"].strip()
        print(f"{label:22} WER {wer(ref, hyp):.2f}  LUFS {lufs(mp4):6.1f} | {hyp}")


if __name__ == "__main__":
    main()
