"""Snap's voice note on takes (G1b): does a take's voice keep the Cast voice reference it cited? Two measurements per
clip, the page compares them with thresholds from the model graph:
- the timbre: a WavLM-SV x-vector (microsoft/wavlm-base-plus-sv, one safetensors file in models/audio_encoders) of the
  clip at 16 kHz mono. Our short03 voices: the same speaker 0.89-1.00, Maren against Liesl (two young women) 0.81-0.95,
  against Brann 0.39-0.65, so the note gives numbers and a margin, never "the same person";
- the pitch: the median F0 of the loud voiced frames (YIN), in Hz. A cut that cites a reference stays within 1-8 Hz of it.
WavLM's TDNN head runs here as conv1d over the module's own weights: transformers' TDNNLayer imports peft lazily, and a
peft that doesn't match the installed transformers breaks that import. Notes only, never a block (SNAP-R23).
SNAP-R18 local only · SNAP-R23 checks are notes · SNAP-R114 the voice note · see docs/SNAP_RULES.md"""
import torch
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


NODE_CLASS_MAPPINGS = {"MAISnapVoiceModelLoader": MAISnapVoiceModelLoader, "MAISnapVoice": MAISnapVoice}
NODE_DISPLAY_NAME_MAPPINGS = {"MAISnapVoiceModelLoader": "Load Voice Model (Snap)", "MAISnapVoice": "Voice (Snap)"}
