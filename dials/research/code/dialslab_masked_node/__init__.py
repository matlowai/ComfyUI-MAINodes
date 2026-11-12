"""Research node for Dials T5 (copy this folder into custom_nodes/ to use it). Apply one dial with a row mask:
  all        - every context row (should equal the Dial Rack's plain post-refiner row; parity-checked)
  text_only  - only rows tagged text (tag 1); vision rows (reference/first-frame pictures, tag 0) unshifted
Uses MAINodes' dial loader; wraps DIFFUSION_MODEL like MAINodes ContextShift, reading minimax_payload["text_token_tags"].
"""
import logging
import torch
import comfy.patcher_extension

log = logging.getLogger("DialsLab")


def _core():
    import sys
    for name, mod in sys.modules.items():
        if name.endswith("ComfyUI-MAINodes.dials.core"):
            return mod
    raise RuntimeError("ComfyUI-MAINodes dials.core not loaded")


class MaskedShift:
    def __init__(self, shift, mode):
        self.shift, self.mode = shift, mode

    def __call__(self, executor, x, timestep, context, transformer_options, **kwargs):
        context = executor.class_obj.preprocess_text_embeds(context)
        shift = self.shift.to(device=context.device, dtype=context.dtype)
        if self.mode == "all":
            return executor(x, timestep, context + shift, transformer_options, **kwargs)
        tags = (kwargs.get("minimax_payload") or {}).get("text_token_tags")
        if tags is None or tags.numel() != context.shape[-2]:
            log.warning("DialsLab: no matching token tags (%s vs %d rows); applying to all rows",
                        None if tags is None else tags.numel(), context.shape[-2])
            return executor(x, timestep, context + shift, transformer_options, **kwargs)
        mask = (tags.view(-1) == 1).to(device=context.device, dtype=context.dtype)
        log.info("DialsLab: %s, %d of %d rows shifted", self.mode, int(mask.sum()), mask.numel())
        return executor(x, timestep, context + shift * mask[:, None], transformer_options, **kwargs)

    def to(self, device_or_dtype):
        if isinstance(device_or_dtype, torch.device):
            self.shift = self.shift.to(device_or_dtype)
        return self


class DialsLabApplyMasked:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",), "dial": ("STRING", {"default": "dials/h3_motion.safetensors"}),
                             "strength": ("FLOAT", {"default": 1.0, "min": -20, "max": 20, "step": 0.01}),
                             "mask": (["all", "text_only"],)}}
    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply"
    CATEGORY = "DialsLab (research)"

    def apply(self, model, dial, strength, mask):
        d = _core().load_dial(dial)
        if d["mode"] != "post":
            raise ValueError("DialsLab: post-refiner (hook) dials only")
        m = model.clone()
        if strength != 0:
            m.add_wrapper_with_key(comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL, "dialslab_masked",
                                   MaskedShift(d["vec"] * strength, mask))
        return (m,)


NODE_CLASS_MAPPINGS = {"DialsLabApplyMasked": DialsLabApplyMasked}
NODE_DISPLAY_NAME_MAPPINGS = {"DialsLabApplyMasked": "DialsLab Apply Dial (masked, research)"}
