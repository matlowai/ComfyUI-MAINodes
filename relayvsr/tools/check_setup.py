#!/usr/bin/env python3
"""Check that required RelayVSR files and separate Python are present without downloading anything."""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True,type=Path)
    p.add_argument('--weights',required=True,type=Path)
    p.add_argument('--python',required=True,type=Path)
    p.add_argument('--variant',choices=['X2','X4'],default='X2')
    a=p.parse_args()
    root=a.root.expanduser().resolve();weights=a.weights.expanduser().resolve();python=a.python.expanduser().resolve()
    checks={"lightx2v_infer":(root/'lightx2v'/'infer.py').is_file(),
            "base_config":(root/'configs'/'relayvsr'/f'relayvsr_{a.variant.lower()}.json').is_file(),
            "helper_python":python.is_file(),
            "ffmpeg":shutil.which('ffmpeg') is not None,
            "ffprobe":shutil.which('ffprobe') is not None}
    names=['wan_x2.safetensors','flash_x2.safetensors'] if a.variant=='X2' else ['wan.safetensors','flash.safetensors']
    for name in names:
        chk=weights/name
        checks[name]=chk.is_file() and chk.stat().st_size>128
    info={"root":str(root),"weights":str(weights),"python":str(python),"checks":checks}
    if checks['helper_python']:
        try:
            result=subprocess.run([str(python),'-c','import sys; print(sys.version); import torch; print("torch",torch.__version__,"cuda",torch.cuda.is_available())'],
                                  capture_output=True,text=True,timeout=30)
            info['helper_environment']={"exit_code":result.returncode,"stdout":result.stdout.strip()[-2000:],"stderr":result.stderr.strip()[-800:]}
        except (OSError,subprocess.TimeoutExpired) as exc:
            info['helper_environment']={"error":str(exc)}
    print(json.dumps(info,indent=2))
    return 0 if all(checks.values()) else 1


if __name__=='__main__':
    raise SystemExit(main())
