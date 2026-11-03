#!/usr/bin/env python3
"""Static upstream inspection. Useful when live discovery cannot find block modules."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re

PATTERN = re.compile(r"relayvsr|\bModuleList\b|\bblocks\b|\bflash\b|\bwan\b|register_module_forward", re.I)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True,type=Path)
    p.add_argument('--output',type=Path)
    args=p.parse_args()
    root=args.root.expanduser().resolve()
    if not (root/'lightx2v'/'infer.py').is_file():
        p.error('Not a LightX2V checkout; missing lightx2v/infer.py')
    found=[]
    for file in (root/'lightx2v').rglob('*.py'):
        if any(part in {'.venv','build','__pycache__'} for part in file.parts):
            continue
        rel=str(file.relative_to(root))
        if re.search(r'relayvsr|refvsr|vr\b|restor',rel,re.I):
            try:
                lines=file.read_text(encoding='utf8',errors='replace').splitlines()
            except OSError:
                continue
            matches=[]
            for n,line in enumerate(lines,1):
                if PATTERN.search(line) and len(matches)<60:
                    matches.append({'line':n,'text':line.strip()[:180]})
            found.append({'path':rel,'lines':len(lines),'matches':matches})
    report={'root':str(root),'files':found,
            'note':'Static hints only. Live discovery reports actual torch module lists at execution time.'}
    payload=json.dumps(report,indent=2)
    if args.output:
        args.output.expanduser().resolve().write_text(payload+'\n',encoding='utf8')
        print(f'Wrote {args.output} ({len(found)} candidate files)')
    else:
        print(payload[:25000])
    return 0


if __name__=='__main__':
    raise SystemExit(main())
