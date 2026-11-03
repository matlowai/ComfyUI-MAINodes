"""Usage: python -m relay_looping.launch -- <normal lightx2v.infer arguments>.

Spawned by ComfyUI's separate LightX2V Python, not the ComfyUI interpreter.
On success, checks that requested loops EXECUTED (not just matched a name).
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import runpy
import sys
import traceback

from .runtime import BlockLoopRuntime
from .spec import LoopSpec


def main():
    spec_path = os.environ.get("RELAYVSR_LOOP_SPEC_PATH")
    report_path = os.environ.get("RELAYVSR_LOOP_REPORT_PATH")
    if not spec_path or not report_path:
        raise RuntimeError("Loop launcher requires RELAYVSR_LOOP_SPEC_PATH and RELAYVSR_LOOP_REPORT_PATH")
    spec = LoopSpec.from_value(json.loads(Path(spec_path).read_text(encoding="utf8")))
    if spec.mode == "experiment" and os.environ.get("RELAYVSR_LOOP_RUNTIME_ACK") != "experimental-stateful-hooks-v1":
        raise RuntimeError("Loop experiment requires explicit, isolated-worker research acknowledgement")
    args = sys.argv[1:]
    if args and args[0] == "--":
        args = args[1:]
    sys.argv = ["lightx2v.infer", *args]
    runtime = BlockLoopRuntime(spec)
    error = ""
    try:
        runtime.activate()
        try:
            runpy.run_module("lightx2v.infer", run_name="__main__", alter_sys=False)
        except SystemExit as exc:
            if exc.code not in (0, None):
                raise
        runtime.verify()
        return 0
    except BaseException as exc:
        error = "%s: %s" % (type(exc).__name__, exc)
        print("[RelayLoop] FAILED " + error, file=sys.stderr, flush=True)
        traceback.print_exc(limit=12)
        return 1
    finally:
        runtime.close()
        runtime.save(report_path, error=error)


if __name__ == "__main__":
    raise SystemExit(main())
