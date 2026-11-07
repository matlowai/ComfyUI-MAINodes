"""Flow control package (spec docs/FLOW_CONTROL_SPEC.md, Phase 1).

Registration follows the contact-sheet idiom in the pack __init__: the V3
classes are merged into NODE_CLASS_MAPPINGS here, keyed by the schema's own
node_id, so the pack's generic module loop picks this package up like any
other module.
"""
from .llm import MAIFlowLLMChoose, MAIFlowLLMJudge
from .nodes import (MAIFlowCondition, MAIFlowFilter, MAIFlowGate,
                    MAIFlowPartition, MAIFlowProbe, MAIFlowSafeFunction,
                    MAIFlowSelect)

NODE_CLASSES = (MAIFlowGate, MAIFlowCondition, MAIFlowSelect,
                MAIFlowFilter, MAIFlowPartition, MAIFlowProbe,
                MAIFlowSafeFunction, MAIFlowLLMJudge, MAIFlowLLMChoose)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _cls in NODE_CLASSES:
    _schema = _cls.GET_SCHEMA()
    NODE_CLASS_MAPPINGS[_schema.node_id] = _cls
    if _schema.display_name is not None:
        NODE_DISPLAY_NAME_MAPPINGS[_schema.node_id] = _schema.display_name

__all__ = ["NODE_CLASSES", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
