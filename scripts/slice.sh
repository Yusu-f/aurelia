#!/bin/bash
# Slice raw 4K clips into scroll-scrub JPEG frame sequences + manifest.
# bash 3.2-safe (no assoc arrays). Usage: scripts/slice.sh
set -e
cd "$(dirname "$0")/.."

WIDTH=1600
FPS=24
QUALITY=3

MANIFEST="public/frames/manifest.json"
mkdir -p public/frames
printf '{\n' > "$MANIFEST"

first=1
for src in raw/hero-4k.mp4 raw/dome-4k.mp4 raw/cabin-4k.mp4; do
  name=$(basename "$src" | sed 's/-4k\.mp4//')
  out="public/frames/$name"
  rm -rf "$out"
  mkdir -p "$out"
  ffmpeg -v error -i "$src" -vf "fps=$FPS,scale=$WIDTH:-2" -q:v $QUALITY "$out/f_%04d.jpg" -y
  count=$(ls "$out" | wc -l | tr -d ' ')
  # poster = first frame at higher quality
  ffmpeg -v error -i "$src" -frames:v 1 -vf "scale=$WIDTH:-2" -q:v 2 "$out/poster.jpg" -y
  if [ $first -eq 0 ]; then printf ',\n' >> "$MANIFEST"; fi
  printf '  "%s": {"count": %d, "pattern": "frames/%s/f_%%04d.jpg"}' "$name" "$count" "$name" >> "$MANIFEST"
  first=0
  echo "sliced $name: $count frames"
done
printf '\n}\n' >> "$MANIFEST"
echo "wrote $MANIFEST"
