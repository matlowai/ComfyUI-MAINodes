"""Opt-in, isolated RelayVSR block-loop research runtime.

This package is imported in the dedicated LightX2V worker, never when ComfyUI starts.
"""

from .spec import LoopSpec, StageSpec, parse_block_indices

__all__ = ["LoopSpec", "StageSpec", "parse_block_indices"]
