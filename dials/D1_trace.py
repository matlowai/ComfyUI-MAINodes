"""Read-only H3 refiner diagnostics for study node D1 (no global call state)."""
import json

import torch
from comfy_api.latest import io, ui

from . import core


def _values(value):
    if value is None:
        return None
    if torch.is_tensor(value):
        return value.detach().float().cpu().flatten().tolist()
    return list(value)


class RefinerTrace:
    """One model clone owns this collector; forwarding leaves the tensor untouched."""

    def __init__(self, forward, label):
        self.forward = forward
        self.label = label
        self.calls = []

    def __call__(self, x, *args, **kwargs):
        opts = kwargs.get("transformer_options", args[0] if args else {}) or {}
        sigmas = _values(opts.get("sigmas"))
        schedule = _values(opts.get("sample_sigmas"))
        step = None
        distance = None
        if sigmas and schedule:
            step = min(range(len(schedule)), key=lambda i: abs(schedule[i] - sigmas[0]))
            distance = abs(schedule[step] - sigmas[0])
        record = {
            "call": len(self.calls), "sigmas": sigmas, "sample_sigmas": schedule,
            "nearest_schedule_index": step, "schedule_distance": distance,
            "cond_or_uncond": opts.get("cond_or_uncond"),
            "input_shape": list(x.shape), "input_dtype": str(x.dtype),
            "option_types": {str(k): type(v).__name__ for k, v in opts.items()},
        }
        self.calls.append(record)
        out = self.forward(x, *args, **kwargs)
        record["output_shape"] = list(out.shape)
        record["completed"] = True
        return out

    def report(self):
        return {"format": "MAINodes D1 refiner trace", "version": 1,
                "label": self.label, "call_count": len(self.calls), "calls": self.calls}


def install_trace(model, label):
    names, _, _ = core.text_modules(model)
    name = f"diffusion_model.{names[1]}.forward"
    clone = model.clone()
    trace = RefinerTrace(clone.get_model_object(name), label)
    clone.add_object_patch(name, trace)
    return clone, trace


Trace = io.Custom("MAI_D1_REFINER_TRACE")


class D1TraceRefiner(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAID1TraceRefiner", display_name="Trace H3 Refiner (study D1)",
            category="MAINodes/Dials/diagnostics",
            inputs=[io.Model.Input("model"), io.String.Input("label", default="D1")],
            outputs=[io.Model.Output(), Trace.Output()],
        )

    @classmethod
    def execute(cls, model, label):
        return io.NodeOutput(*install_trace(model, label))

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # A repeated prompt must collect a new trace instead of reusing mutable state.
        return float("nan")


class D1RefinerTraceReport(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MAID1RefinerTraceReport", display_name="Refiner Trace Report (study D1)",
            category="MAINodes/Dials/diagnostics",
            inputs=[Trace.Input("trace"), io.Latent.Input("samples")],
            outputs=[io.Latent.Output()], is_output_node=True,
        )

    @classmethod
    def execute(cls, trace, samples):
        # The latent dependency ensures that all sampler calls happened before reporting.
        return io.NodeOutput(samples, ui=ui.PreviewText(json.dumps(trace.report(), indent=2)))
