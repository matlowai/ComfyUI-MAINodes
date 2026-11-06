#!/bin/bash
# sheet.sh <out.jpg> <label=video.mp4>...   one row per video: frames at 0.5 / 2.917 / 5.333 s, labelled
OUT=$1; shift; T=$(mktemp -d); i=0
for arg in "$@"; do lab=${arg%%=*}; v=${arg#*=}
  for t in 0.5 2.917 5.333; do ffmpeg -loglevel error -y -ss $t -i "$v" -frames:v 1 -vf "scale=448:-2" $T/r${i}_$t.png; done
  ffmpeg -loglevel error -y -i $T/r${i}_0.5.png -i $T/r${i}_2.917.png -i $T/r${i}_5.333.png -filter_complex "hstack=3,drawtext=text='$lab':x=8:y=8:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.6" $T/row$i.png
  i=$((i+1)); done
ins=""; for j in $(seq 0 $((i-1))); do ins="$ins -i $T/row$j.png"; done
if [ $i -gt 1 ]; then ffmpeg -loglevel error -y $ins -filter_complex "vstack=$i" -q:v 3 "$OUT"; else cp $T/row0.png "${OUT%.jpg}.png"; ffmpeg -loglevel error -y -i $T/row0.png -q:v 3 "$OUT"; fi
rm -rf $T; echo "$OUT"
