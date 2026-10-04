#!/usr/bin/env bash
# Regenerates mobile/android-icons/ (launcher icons stamped into the APK by patch-android.mjs)
# from the website logo (media/icons/icon-512.png). Run from the repo root:
#   bash mobile/scripts/gen-launcher-icons.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=media/icons/icon-512.png
OUT=mobile/android-icons
rm -rf "$OUT"; mkdir -p "$OUT"/{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}
for spec in "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
  set -- $spec; d=$1; s=$2; fg=$3
  # The launcher icon needs a full-bleed dark tile: Android fills transparent legacy-icon corners with white.
  # The adaptive foreground uses the full circular artwork so it stays large inside the system's rounded mask.
  convert -size "${s}x${s}" xc:"#050505" "$SRC" -resize "${s}x${s}" -gravity center -compose Over -composite -strip -depth 8 "PNG32:$OUT/$d/ic_launcher.png"
  cp "$OUT/$d/ic_launcher.png" "$OUT/$d/ic_launcher_round.png"
  convert "$SRC" -resize "${fg}x${fg}" -strip -depth 8 "PNG32:$OUT/$d/ic_launcher_foreground.png"
done
convert -size 512x512 xc:"#050505" "$SRC" -resize 512x512 -gravity center -compose Over -composite -strip -depth 8 "PNG32:$OUT/ic_launcher_playstore.png"
# Branded splash (dark bg + centred round logo): replaces the stock white Capacitor tile that
# flashes on launch; stamped over res/drawable*/splash.png by patch-android.mjs.
mkdir -p "$OUT/splash"
for spec in "mdpi 320" "hdpi 480" "xhdpi 640" "xxhdpi 960" "xxxhdpi 1280"; do
  set -- $spec; d=$1; s=$2; l=$((s * 40 / 100)); c=$((l / 2))
  convert -size "${l}x${l}" xc:none -fill white -draw "circle $c,$c $c,0" "/tmp/round-mask-$l.png"
  convert -size "${s}x${s}" xc:"#050505" \( "$SRC" -resize "${l}x${l}" "/tmp/round-mask-$l.png" -compose DstIn -composite \) -compose Over -gravity center -composite -depth 8 "$OUT/splash/$d.png"
done
identify "$OUT"/*/ic_launcher.png "$OUT"/*/ic_launcher_round.png "$OUT/ic_launcher_playstore.png" "$OUT"/splash/*.png | cut -c1-130
