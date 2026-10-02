#!/usr/bin/env bash
# Regenerates mobile/android-icons/ (launcher icons stamped into the APK by patch-android.mjs)
# from the website logo (media/icons/icon-512.png). Run from the repo root:
#   bash mobile/scripts/gen-launcher-icons.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=media/icons/icon-512.png
OUT=mobile/android-icons
rm -rf "$OUT"; mkdir -p "$OUT"/{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}
for spec in "mdpi 48" "hdpi 72" "xhdpi 96" "xxhdpi 144" "xxxhdpi 192"; do
  set -- $spec; d=$1; s=$2; c=$((s / 2))
  convert -size "${s}x${s}" xc:none -fill white -draw "circle $c,$c $c,0" /tmp/round-mask.png
  # the round logo on the site's near-black (#050505), no white corners
  convert -size "${s}x${s}" xc:"#050505" \( "$SRC" -resize "${s}x${s}" /tmp/round-mask.png -compose DstIn -composite \) -compose Over -composite -depth 8 "$OUT/$d/ic_launcher.png"
  convert "$OUT/$d/ic_launcher.png" /tmp/round-mask.png -compose DstIn -composite -depth 8 "$OUT/$d/ic_launcher_round.png"
done
convert -size 512x512 xc:none -fill white -draw "circle 256,256 256,0" /tmp/round-mask.png
convert -size 512x512 xc:"#050505" \( "$SRC" -resize 512x512 /tmp/round-mask.png -compose DstIn -composite \) -compose Over -composite -depth 8 "$OUT/ic_launcher_playstore.png"
identify "$OUT"/*/ic_launcher.png "$OUT"/*/ic_launcher_round.png "$OUT/ic_launcher_playstore.png" | cut -c1-130
