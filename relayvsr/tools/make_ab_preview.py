#!/usr/bin/env python3
"""Create a frame-synchronized side-by-side baseline/experiment MP4 for visual review."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import subprocess


def probe(path):
    cmd=[shutil.which('ffprobe'),'-v','error','-select_streams','v:0','-show_entries',
         'stream=width,height,avg_frame_rate,nb_frames','-of','json',str(path)]
    streams=json.loads(subprocess.check_output(cmd,text=True))['streams']
    if not streams:
        raise RuntimeError('No video stream: '+str(path))
    return streams[0]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline',type=Path)
    p.add_argument('experiment',type=Path)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--column-width',type=int,default=640)
    args=p.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        p.error('FFmpeg and ffprobe must be on PATH')
    a=args.baseline.expanduser().resolve();b=args.experiment.expanduser().resolve()
    m1,m2=probe(a),probe(b)
    for field in ('width','height','avg_frame_rate'):
        if m1.get(field)!=m2.get(field):
            p.error(f'Mismatched {field}; fix your A/B settings before reviewing')
    if m1.get('nb_frames') and m2.get('nb_frames') and m1['nb_frames']!=m2['nb_frames']:
        p.error('Frame counts differ; cannot compare these videos directly')
    target=args.output.expanduser().resolve();target.parent.mkdir(parents=True,exist_ok=True)
    graph=(f'[0:v]scale={args.column_width}:-2:flags=lanczos[left];'
           f'[1:v]scale={args.column_width}:-2:flags=lanczos[right];'
           f'[left][right]hstack=inputs=2[out]')
    cmd=[shutil.which('ffmpeg'),'-hide_banner','-v','error','-nostdin','-y','-i',str(a),'-i',str(b),
         '-filter_complex',graph,'-map','[out]','-map','0:a:0?','-c:v','libx264','-crf','17',
         '-preset','medium','-c:a','aac','-pix_fmt','yuv420p','-shortest',str(target)]
    subprocess.run(cmd,check=True)
    print(f'A/B preview (LEFT baseline | RIGHT experiment): {target}')
    return 0


if __name__=='__main__':
    raise SystemExit(main())
