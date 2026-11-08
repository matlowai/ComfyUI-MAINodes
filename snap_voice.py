"""Snap's voice note on takes (G1b): does a take's voice keep the Cast voice reference it cited? Two measurements per
clip, the page compares them with thresholds from the model graph:
- the timbre: a WavLM-SV x-vector (microsoft/wavlm-base-plus-sv, one safetensors file in models/audio_encoders) of the
  clip at 16 kHz mono. Our short03 voices: the same speaker 0.89-1.00, Maren against Liesl (two young women) 0.81-0.95,
  against Brann 0.39-0.65, so the note gives numbers and a margin, never "the same person";
- the pitch: the median F0 of the loud voiced frames (YIN), in Hz. A cut that cites a reference stays within 1-8 Hz of it.
WavLM's TDNN head runs here as conv1d over the module's own weights: transformers' TDNNLayer imports peft lazily, and a
peft that doesn't match the installed transformers breaks that import. Notes only, never a block (SNAP-R23).
POST /mainodes/snap/take_voice cuts a take's sound into input/snap/voice/ for use_take {as: "voice"} (F-F06): a stretch
of the take, 48 kHz mono wav, the Cast's next voice reference. A take kept encrypted is refused (its sound would land
in input/ in the clear; privacy fails closed).
Words and the Voice QA (SNAP-R227, R240) come from the AudioCPP fork's nodes (Nemotron Transcribe, H3 Voice QA) that the
page queues; GET /mainodes/snap/gpus names the cards (nvidia-smi -L) and ComfyUI's own, so the QA's server runs on the
other card by default.
SNAP-R18 local only · SNAP-R23 checks are notes · SNAP-R114 the voice note · SNAP-R143 a take's sound becomes a Cast's voice ·
SNAP-R227 a take with a line gets its words timed · SNAP-R240 the Voice QA · see docs/snap/SNAP_RULES.md"""
import asyncio
import os
import re
import subprocess

import torch
from aiohttp import web
from server import PromptServer
from transformers import WavLMConfig, WavLMForXVector

import comfy.audio
import comfy.model_management
import comfy.model_patcher
import comfy.utils
import folder_paths
from comfy_api.latest import io

VoiceModel = io.Custom("VOICE_MODEL")
RATE = 16000


class MAISnapVoiceModelLoader(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapVoiceModelLoader",
            display_name="Load Voice Model (Snap)",
            category="MAINodes/snap",
            description="Loads WavLM-SV (wavlm-base-plus-sv, one safetensors file) from models/audio_encoders, for Snap's voice note.",
            inputs=[io.Combo.Input("model_name", options=folder_paths.get_filename_list("audio_encoders"))],
            outputs=[VoiceModel.Output()],
        )

    @classmethod
    def execute(cls, model_name) -> io.NodeOutput:
        sd = comfy.utils.load_torch_file(folder_paths.get_full_path_or_raise("audio_encoders", model_name), safe_load=True)
        # wavlm-base-plus-sv's config where it differs from WavLMConfig's defaults (the speaker head's label count is the file's)
        net = WavLMForXVector(WavLMConfig(use_weighted_layer_sum=True, num_labels=sd["objective.weight"].shape[1])).eval()
        net.load_state_dict(sd)
        holder = torch.nn.Module()  # the patcher sets .device, which transformers' model keeps read-only
        holder.sv = net
        return io.NodeOutput(comfy.model_patcher.CoreModelPatcher(holder, load_device=comfy.model_management.get_torch_device(), offload_device=comfy.model_management.unet_offload_device()))


def xvector(net, wave):
    """The speaker embedding of one 16 kHz mono clip, L2-normalised: WavLMForXVector's forward, its TDNN layers as conv1d."""
    hidden = torch.stack(net.wavlm(wave[None], output_hidden_states=True).hidden_states, dim=1)
    x = net.projector((hidden * torch.softmax(net.layer_weights, dim=-1).view(-1, 1, 1)).sum(dim=1))
    for t in net.tdnn:
        w = t.kernel.weight.view(t.out_conv_dim, t.kernel_size, t.in_conv_dim).transpose(1, 2)
        x = torch.relu(torch.nn.functional.conv1d(x.transpose(1, 2), w, t.kernel.bias, dilation=t.dilation).transpose(1, 2))
    e = net.feature_extractor(torch.cat([x.mean(dim=1), x.std(dim=1)], dim=-1))
    return torch.nn.functional.normalize(e, dim=-1)[0]


def pitch(wave, fmin=70, fmax=500, frame=1024, hop=256, threshold=0.15):
    """Median F0 in Hz of the loud voiced frames (YIN: the first dip of the cumulative mean normalised difference under
    `threshold`, refined to its local minimum; loud = RMS above 0.3x the 95th percentile); None when nothing is voiced."""
    if wave.shape[0] < frame:
        return None
    frames = wave.unfold(0, frame, hop)
    lo, hi = RATE // fmax, RATE // fmin
    span = frame - hi
    d = torch.stack([((frames[:, :span] - frames[:, tau:tau + span]) ** 2).sum(-1) for tau in range(1, hi + 1)], dim=1)
    cmnd = d * torch.arange(1, hi + 1, device=d.device) / d.cumsum(dim=1).clamp_min(1e-12)
    rms = frames.pow(2).mean(-1).sqrt()
    loud = (rms > 0.3 * torch.quantile(rms, 0.95)).tolist()
    found = []
    for row, keep in zip(cmnd.tolist(), loud):
        if not keep:
            continue
        tau = next((k for k in range(lo - 1, hi) if row[k] < threshold), None)
        if tau is None:
            continue
        while tau + 1 < hi and row[tau + 1] < row[tau]:
            tau += 1
        found.append(RATE / (tau + 1))
    return round(float(torch.tensor(found).median()), 1) if found else None


class MAISnapVoice(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapVoice",
            display_name="Voice (Snap)",
            category="MAINodes/snap",
            description="One clip's voice for Snap's voice note: its WavLM-SV speaker embedding and the median F0 (Hz) of its loud "
                        "voiced frames, at 16 kHz mono.",
            inputs=[VoiceModel.Input("voice_model"), io.Audio.Input("audio")],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, voice_model, audio) -> io.NodeOutput:
        comfy.model_management.load_model_gpu(voice_model)
        wave = comfy.audio.resample(audio["waveform"][0].float().mean(0), audio["sample_rate"], RATE).to(voice_model.load_device)
        e = xvector(voice_model.model.sv, wave)
        return io.NodeOutput(ui={"voices": [[round(v, 5) for v in e.tolist()]], "f0": [pitch(wave)], "seconds": [round(wave.shape[0] / RATE, 2)]})


# ---- the Voice QA's GPU (SNAP-R240): the cards on this computer and the one ComfyUI computes on, by UUID --------------
def gpu_list():
    """[{index, name, uuid}] from nvidia-smi -L (none without it), and ComfyUI's own card as GPU-<uuid> (None off CUDA)"""
    try:
        r = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return [], None
    cards = [{"index": int(m[1]), "name": m[2], "uuid": m[3]} for m in re.finditer(r"GPU (\d+): (.*?) \(UUID: (GPU-[0-9a-f-]+)\)", r.stdout)]
    device = comfy.model_management.get_torch_device()
    return cards, f"GPU-{torch.cuda.get_device_properties(device).uuid}" if device.type == "cuda" else None


@PromptServer.instance.routes.get("/mainodes/snap/gpus")
async def gpus(request):
    cards, comfy_gpu = await asyncio.to_thread(gpu_list)
    return web.json_response({"gpus": cards, "comfy": comfy_gpu})


try:
    from . import snap_vault_server
except ImportError:  # no `cryptography`: nothing is sealed on this install
    snap_vault_server = None


@PromptServer.instance.routes.post("/mainodes/snap/take_voice")
async def take_voice(request):
    """{video: an annotated take file, at: start s, length: s, name} -> {file: snap/voice/<name>.wav, seconds}"""
    q = await request.json()
    path = folder_paths.get_annotated_filepath(str(q.get("video") or ""))
    if not os.path.isfile(path):
        return web.json_response({"error": f"{q.get('video')} isn't on this server"}, status=400)
    if snap_vault_server is not None and snap_vault_server.snap_vault.sealed(path):
        return web.json_response({"error": "this take is kept encrypted: its sound can't be written into input/ in the clear (cut it from a take that isn't private, or save the voice file yourself)"}, status=400)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(q.get("name") or "voice")).strip("_") or "voice"
    out_dir = os.path.join(folder_paths.get_input_directory(), "snap", "voice")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{name}.wav")
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(float(q.get("at") or 0)), "-i", path, *(["-t", str(float(q["length"]))] if q.get("length") else []), "-vn", "-ac", "1", "-ar", "48000", out]
    r = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
    if r.returncode or not os.path.isfile(out) or os.path.getsize(out) < 1000:
        return web.json_response({"error": f"no sound came out of {q.get('video')} at {q.get('at') or 0} s: {r.stderr.strip() or 'the take has no audio track there'}"}, status=400)
    seconds = (os.path.getsize(out) - 44) / 96000
    return web.json_response({"file": f"snap/voice/{name}.wav", "seconds": round(seconds, 2)})


NODE_CLASS_MAPPINGS = {"MAISnapVoiceModelLoader": MAISnapVoiceModelLoader, "MAISnapVoice": MAISnapVoice}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapVoiceModelLoader": "Load Voice Model (Snap)", "MAISnapVoice": "Voice (Snap)"}
