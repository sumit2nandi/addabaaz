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
  inner=$((s * 86 / 100)); fg_inner=$((fg * 86 / 100))
  # Keep the earlier white rounded-square tile; enlarge the circular mark to 86% of the icon canvas.
  convert "$SRC" -resize "${inner}x${inner}" -background white -gravity center -extent "${s}x${s}" -alpha remove -alpha off -strip -depth 8 "PNG32:$OUT/$d/ic_launcher.png"
  cp "$OUT/$d/ic_launcher.png" "$OUT/$d/ic_launcher_round.png"
  convert "$SRC" -resize "${fg_inner}x${fg_inner}" -background none -gravity center -extent "${fg}x${fg}" -strip -depth 8 "PNG32:$OUT/$d/ic_launcher_foreground.png"
done
convert "$SRC" -resize 440x440 -background white -gravity center -extent 512x512 -alpha remove -alpha off -strip -depth 8 "PNG32:$OUT/ic_launcher_playstore.png"
# Branded splash (ADDABAAZ red + centred round logo): matches the HTML launch screen and
# replaces the stock white Capacitor tile that flashes on launch; stamped by patch-android.mjs.
mkdir -p "$OUT/splash"
for spec in "mdpi 320" "hdpi 480" "xhdpi 640" "xxhdpi 960" "xxxhdpi 1280"; do
  set -- $spec; d=$1; s=$2; l=$((s * 40 / 100)); c=$((l / 2))
  convert -size "${l}x${l}" xc:none -fill white -draw "circle $c,$c $c,0" "/tmp/round-mask-$l.png"
  convert -size "${s}x${s}" xc:"#b80000" \( "$SRC" -resize "${l}x${l}" "/tmp/round-mask-$l.png" -compose DstIn -composite \) -compose Over -gravity center -composite -depth 8 "$OUT/splash/$d.png"
done
identify "$OUT"/*/ic_launcher.png "$OUT"/*/ic_launcher_round.png "$OUT/ic_launcher_playstore.png" "$OUT"/splash/*.png | cut -c1-130
