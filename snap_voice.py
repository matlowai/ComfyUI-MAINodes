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
Words (SNAP-R227): a Whisper (one safetensors file in models/audio_encoders, its config and tokenizer beside it, read from
disk only) times the take's words with the voice note: [[start, end, word]] in the take's own seconds.
SNAP-R18 local only · SNAP-R23 checks are notes · SNAP-R114 the voice note · SNAP-R143 a take's sound becomes a Cast's voice ·
SNAP-R227 a take with a line gets its words timed · see docs/snap/SNAP_RULES.md"""
import asyncio
import os
import re
import subprocess

import torch
from aiohttp import web
from server import PromptServer
from transformers import GenerationConfig, WavLMConfig, WavLMForXVector, WhisperConfig, WhisperForConditionalGeneration, WhisperProcessor

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


# ---- words (SNAP-R227): a Whisper from one safetensors file in models/audio_encoders times a take's words -------------
WordsModel = io.Custom("WORDS_MODEL")


def beside(path):
    """the folder that holds the safetensors' config.json, generation config and tokenizer: the file's own folder, or the
    folder a link to it names (a link into a Hugging Face snapshot), one link at a time"""
    while True:
        folder = os.path.dirname(path)
        if os.path.isfile(os.path.join(folder, "config.json")):
            return folder
        if not os.path.islink(path):
            raise FileNotFoundError(f"{path}: Whisper needs config.json, generation_config.json and its tokenizer files beside the safetensors (as its Hugging Face folder has them)")
        path = os.path.join(folder, os.readlink(path))


class MAISnapWordsModelLoader(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapWordsModelLoader",
            display_name="Load Words Model (Snap)",
            category="MAINodes/snap",
            description="Loads a Whisper (e.g. whisper-large-v3: one safetensors file in models/audio_encoders, its config and tokenizer beside it) for Snap's word timing.",
            inputs=[io.Combo.Input("model_name", options=folder_paths.get_filename_list("audio_encoders"))],
            outputs=[WordsModel.Output()],
        )

    @classmethod
    def execute(cls, model_name) -> io.NodeOutput:
        path = folder_paths.get_full_path_or_raise("audio_encoders", model_name)
        folder, device = beside(path), comfy.model_management.get_torch_device()
        net = WhisperForConditionalGeneration(WhisperConfig.from_pretrained(folder)).eval()
        missing, unexpected = net.load_state_dict(comfy.utils.load_torch_file(path, safe_load=True), strict=False)
        if set(missing) - {"proj_out.weight"} or unexpected:  # proj_out is tied to the decoder's embedding, so the file has none
            raise ValueError(f"{model_name} isn't a Whisper checkpoint for this config: missing {missing}, unexpected {unexpected}")
        net.tie_weights()
        net.generation_config = GenerationConfig.from_pretrained(folder)
        net.to(torch.float16 if comfy.model_management.should_use_fp16(device) else torch.float32)
        holder = torch.nn.Module()  # the patcher sets .device, which transformers' model keeps read-only
        holder.whisper, holder.processor = net, WhisperProcessor.from_pretrained(folder)
        return io.NodeOutput(comfy.model_patcher.CoreModelPatcher(holder, load_device=device, offload_device=comfy.model_management.unet_offload_device()))


def words_of(model, wave):
    """[[start s, end s, word]] and the whole text of one 16 kHz mono clip: Whisper's token timestamps (cross-attention
    alignment), a word starting at each token that opens with a space"""
    net, processor = model.whisper, model.processor
    feats = processor(wave.cpu().numpy(), sampling_rate=RATE, return_tensors="pt", return_attention_mask=True)
    out = net.generate(feats.input_features.to(net.device, net.dtype), attention_mask=feats.attention_mask.to(net.device), return_token_timestamps=True, task="transcribe")
    tokens, times, special = out["sequences"][0].tolist(), out["token_timestamps"][0].tolist(), set(processor.tokenizer.all_special_ids)
    words = []
    for i, t in enumerate(tokens):
        if t in special or t >= processor.tokenizer.convert_tokens_to_ids("<|0.00|>"):
            continue
        piece = processor.tokenizer.decode([t])
        end = round(times[i + 1] if i + 1 < len(times) else times[i], 3)
        if piece.startswith(" ") or not words:
            words.append([round(times[i], 3), end, piece.strip()])
        else:
            words[-1][1], words[-1][2] = end, words[-1][2] + piece
    words = [w for w in words if w[2]]
    # Whisper's alignment starts the first word at the window's start (0 s) whatever silence comes before it; its start is
    # where the sound first gets loud (the voice note's loudness rule) before that word ends
    if words:
        frame = RATE // 50
        rms = wave[: wave.shape[0] // frame * frame].view(-1, frame).pow(2).mean(-1).sqrt()
        loud = (rms > 0.3 * torch.quantile(rms, 0.95)).nonzero().flatten().tolist() if rms.numel() else []
        onset = next((k / 50 for k in loud if k / 50 >= words[0][0]), None)
        if onset is not None and onset < words[0][1]:
            words[0][0] = round(onset, 3)
    return words, processor.tokenizer.decode(tokens, skip_special_tokens=True).strip()


class MAISnapWords(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAISnapWords",
            display_name="Words (Snap)",
            category="MAINodes/snap",
            description="One clip's words with their times (Whisper word timestamps at 16 kHz mono), for Snap's voice note and the Cut's dialogue lane.",
            inputs=[WordsModel.Input("words_model"), io.Audio.Input("audio")],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, words_model, audio) -> io.NodeOutput:
        comfy.model_management.load_model_gpu(words_model)
        wave = comfy.audio.resample(audio["waveform"][0].float().mean(0), audio["sample_rate"], RATE)
        words, text = words_of(words_model.model, wave)
        return io.NodeOutput(ui={"words": words, "text": [text]})


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


NODE_CLASS_MAPPINGS = {"MAISnapVoiceModelLoader": MAISnapVoiceModelLoader, "MAISnapVoice": MAISnapVoice, "MAISnapWordsModelLoader": MAISnapWordsModelLoader, "MAISnapWords": MAISnapWords}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapVoiceModelLoader": "Load Voice Model (Snap)", "MAISnapVoice": "Voice (Snap)", "MAISnapWordsModelLoader": "Load Words Model (Snap)", "MAISnapWords": "Words (Snap)"}
