"""Snap's embedder: EmbeddingGemma 2 behind a tiny JSON server on 127.0.0.1, run in its own venv, never ComfyUI's.

snap_bridge.py starts it on demand and falls back to keyword search until it answers. CPU only, nice 19, 4 threads,
offline from the local HF cache:

    <venv>/bin/python -I tools/snap_embedder.py --port 8418

GET  /health -> {ready, dim, device}
POST /embed  {texts?: [str], images?: [absolute path]} -> {texts: [[float]], images: [[float]]}, L2-normalized, 256d.
Texts are embedded as given, so the caller adds the task prefixes ("task: search result | query: ...").
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.nice(19)  # before torch loads: heavy CPU at normal priority made the audio crackle

import torch
from sentence_transformers import SentenceTransformer

MODEL = "google/embeddinggemma-2"
REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"  # the cached snapshot; the cache has no refs/main
DIM = 256
CACHE_SIZE = 4096

model = None
loaded = threading.Event()
lock = threading.Lock()
cache = {}  # text or (path, mtime) -> vector


def load():
    global model
    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL, revision=REVISION, device="cpu", local_files_only=True, trust_remote_code=False, model_kwargs={"dtype": torch.float32})
    model.max_seq_length = 8192
    loaded.set()
    print(f"snap_embedder: {MODEL} loaded in {time.perf_counter() - t0:.1f} s", flush=True)


def embed(keys, inputs):
    out = [cache.get(k) for k in keys]
    missing = [i for i, v in enumerate(out) if v is None]
    if missing:
        loaded.wait()
        with lock:
            vectors = model.encode([inputs[i] for i in missing], truncate_dim=DIM, normalize_embeddings=True, convert_to_numpy=True, batch_size=8, show_progress_bar=False)
        if len(cache) + len(missing) > CACHE_SIZE:
            cache.clear()
        for i, v in zip(missing, vectors):
            out[i] = cache[keys[i]] = v.tolist()
    return out


class Handler(BaseHTTPRequestHandler):
    def answer(self, body, status=200):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/health":
            return self.answer({"error": "not found"}, 404)
        self.answer({"ready": loaded.is_set(), "dim": DIM, "device": "cpu"})

    def do_POST(self):
        if self.path != "/embed":
            return self.answer({"error": "not found"}, 404)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        texts, images = body.get("texts") or [], body.get("images") or []
        try:
            image_keys = [(p, os.stat(p).st_mtime) for p in images]
        except OSError as e:
            return self.answer({"error": f"cannot read image: {e}"}, 400)
        self.answer({"texts": embed(texts, texts), "images": embed(image_keys, [{"image": p} for p in images])})

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8418)
    args = parser.parse_args()
    torch.set_num_threads(4)
    parent = os.getppid()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"snap_embedder: listening on 127.0.0.1:{args.port}", flush=True)
    load()  # /health says ready: false until this returns; a failure exits the process
    while os.getppid() == parent:  # exit with the ComfyUI that started us, so a 5 GB process is not left behind
        time.sleep(5)


if __name__ == "__main__":
    main()
