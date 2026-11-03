"""Submit the H3ContactSheet parity-test graph to :8188 and wait for it."""
import json
import sys
import time
import urllib.request

API = "http://127.0.0.1:8188"
REF = "/path/to/your_reference.png"
SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 512
LORA = "minimax_h3_five_view_512_s1500.safetensors"  # a1500

# stage the ref into ComfyUI's input dir
import shutil, os
shutil.copyfile(REF, "<your ComfyUI>/input/cs_test_ref.png")

g = {
    "u": {"class_type": "UNETLoader", "inputs": {
        "unet_name": "minimax_h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        "weight_dtype": "default"}},
    "lo": {"class_type": "LoraLoaderModelOnly", "inputs": {
        "lora_name": LORA, "strength_model": 1.0, "model": ["u", 0]}},
    "c": {"class_type": "CLIPLoader", "inputs": {
        "clip_name": "minimax_h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        "type": "minimax", "device": "default"}},
    "v": {"class_type": "VAELoader", "inputs": {
        "vae_name": "minimax_h3/minimax_h3_video_vae_fp16.safetensors"}},
    "img": {"class_type": "LoadImage", "inputs": {"image": "cs_test_ref.png"}},
    "cs": {"class_type": "H3ContactSheet", "inputs": {
        "clip": ["c", 0], "vae": ["v", 0],
        "prompt": "the camera orbits the subject of <Picture 1> ninety degrees clockwise",
        "ref_image": ["img", 0], "size": SIZE}},
    "g": {"class_type": "BasicGuider", "inputs": {
        "model": ["lo", 0], "conditioning": ["cs", 0]}},
    "sch": {"class_type": "BasicScheduler", "inputs": {
        "model": ["lo", 0], "scheduler": "simple", "steps": 28, "denoise": 1.0}},
    "ks": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
    "n": {"class_type": "RandomNoise", "inputs": {"noise_seed": 42}},
    "s": {"class_type": "SamplerCustomAdvanced", "inputs": {
        "noise": ["n", 0], "guider": ["g", 0], "sampler": ["ks", 0],
        "sigmas": ["sch", 0], "latent_image": ["cs", 1]}},
    "dec": {"class_type": "H3ContactSheetDecode", "inputs": {
        "vae": ["v", 0], "samples": ["s", 0]}},
    "save": {"class_type": "SaveImage", "inputs": {
        "images": ["dec", 1], "filename_prefix": "cs_node_test"}},
    "save2": {"class_type": "SaveImage", "inputs": {
        "images": ["dec", 0], "filename_prefix": "cs_node_test_views"}},
}

req = urllib.request.Request(API + "/prompt",
                             data=json.dumps({"prompt": g, "client_id": "cs-test"}).encode(),
                             headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req))
pid = r.get("prompt_id")
print("queued", pid, r.get("node_errors") or "")
t0 = time.time()
while True:
    time.sleep(5)
    h = json.load(urllib.request.urlopen(f"{API}/history/{pid}"))
    if pid in h:
        st = h[pid]["status"]
        print("status:", st.get("status_str"), f"{time.time()-t0:.0f}s")
        if st.get("status_str") == "error":
            for m in st.get("messages", []):
                if m[0] == "execution_error":
                    print(json.dumps(m[1], indent=1)[:2000])
        else:
            for nid, out in h[pid].get("outputs", {}).items():
                for im in out.get("images", []):
                    print("output:", im["filename"])
        break
    if time.time() - t0 > 900:
        print("TIMEOUT")
        break
