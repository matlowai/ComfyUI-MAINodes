#!/bin/bash
# grid4.sh <out.jpg> [<label> <ctl> <a> <b> <ab>]...   one row per group: middle frame (2.9 s) of control | a | b | a+b
out=$1; shift; T=$(mktemp -d); rows=""; r=0
while [ $# -gt 0 ]; do
  lab=$1; shift; i=0
  for p in "$1" "$2" "$3" "$4"; do ffmpeg -nostdin -v error -y -ss 2.9 -i "${p}_00001_.mp4" -frames:v 1 -vf "scale=384:-2" "$T/c${r}_${i}.png"; i=$((i+1)); done
  shift 4
  ffmpeg -nostdin -v error -y -i "$T/c${r}_0.png" -i "$T/c${r}_1.png" -i "$T/c${r}_2.png" -i "$T/c${r}_3.png" -filter_complex "hstack=4,drawtext=text='${lab}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6" "$T/r${r}.png"
  rows="$rows -i $T/r${r}.png"; r=$((r+1))
done
ffmpeg -nostdin -v error -y $rows -filter_complex "vstack=$r" -q:v 3 "$out"; rm -rf "$T"; echo "$out"
