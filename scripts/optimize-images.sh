#!/usr/bin/env bash
# Generates web/app-friendly WebP renditions of the original artwork into media/.
# Originals (BTS/, UpcomingReleases/, images/) are never modified.
# Requires ImageMagick (`convert`). Re-run after adding new artwork, then update data/catalog.json.
#
#   media/<group>/<slug>-sm.webp   grid / rail cards   (600px wide)
#   media/<group>/<slug>-lg.webp   detail / lightbox   (1600px wide, never upscaled)
#
# Card art is rendered at 600px (was 400px) so a 2x phone screen — where most viewing happens — gets a
# genuinely sharp poster instead of an upscaled one, and everything is encoded at quality 84 with
# webp:method=6 (the slow, smallest-for-that-quality setting). `${w}x>` still only ever shrinks, so a
# group's large rendition is the source's own resolution when that is smaller. If artwork arrives soft,
# the fix is a bigger original: nothing here can invent detail the source does not carry.
# Stop at the first error, treat unset variables as errors, and fail a pipeline if any part fails.
set -euo pipefail
cd "$(dirname "$0")/.."

slug() { # "UTTRAN BTS (16).png" -> "uttran-bts-16"
  local b; b="$(basename "$1")"; b="${b%.*}"
  echo "$b" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

# render <source> <folder> <name> <small width> <large width> [quality]: writes -sm / -lg WebP files; `${w}x>` only ever shrinks (never enlarges) an image.
# webp:method=6 spends a little longer encoding for a smaller file at the same quality (or better detail at the same size).
render() { # src group slug small large [quality]
  local src="$1" group="$2" name="$3" sm="$4" lg="$5" q="${6:-84}"
  mkdir -p "media/$group"
  [ -n "$sm" ] && convert "$src" -auto-orient -strip -resize "${sm}x>" -quality "$q" -define webp:method=6 "media/$group/$name-sm.webp"
  [ -n "$lg" ] && convert "$src" -auto-orient -strip -resize "${lg}x>" -quality "$q" -define webp:method=6 "media/$group/$name-lg.webp"
  return 0
}

# Show posters
render images/Shahid.webp        shows shahid       600 1600
render images/laughBite.webp     shows laugh-bite   600 1600
render images/FaltuKatha.webp    shows faltu-kotha  600 1600
render "images/কিছু কথা কিছু ইতিহাস.webp" shows kichu-kotha-kichu-itihas 600 1600

# Upcoming posters, BTS
for f in UpcomingReleases/*.png; do render "$f" upcoming "$(slug "$f")" 600 1600; done
for f in BTS/*.png BTS/*.jpeg;   do render "$f" bts      "$(slug "$f")" 600 1600; done

# Team portraits
for f in images/Team/*.png; do render "$f" team "$(slug "$f")" 480 ""; done

# Brand / PWA / native-app icons
mkdir -p media/icons
for s in 48 72 96 128 144 152 180 192 256 384 512; do
  convert images/addabaaz-logo.png -resize "${s}x${s}" -strip "media/icons/icon-$s.png"
done
# Maskable icon: logo at ~70% on the brand background (safe-zone friendly)
convert -size 512x512 xc:'#050505' \( images/addabaaz-logo.png -resize 360x360 \) -gravity center -composite -strip media/icons/maskable-512.png
convert -size 192x192 xc:'#050505' \( images/addabaaz-logo.png -resize 134x134 \) -gravity center -composite -strip media/icons/maskable-192.png
convert images/addabaaz-logo.png -resize 96x96 -strip -quality 80 media/icons/logo-96.webp
# Master art for native icon/splash generation (@capacitor/assets, run via `npm --prefix mobile run assets`).
# Keep the round mark's transparent corners; a black square baked into icon-only.png shows in Android's system sheets.
mkdir -p resources
convert -size 512x512 xc:none -fill white -draw 'circle 256,256 256,0' /tmp/round-mask.png
convert images/addabaaz-logo.png -resize 512x512 -alpha set /tmp/round-mask.png -compose DstIn -composite -strip -depth 8 -define png:compression-level=9 PNG32:resources/icon-only.png
convert -size 1024x1024 xc:'#050505' resources/icon-background.png
convert -size 2732x2732 xc:'#b80000' \( resources/icon-only.png -resize 620x620 \) -gravity center -composite -strip -define png:compression-level=9 resources/splash.png
echo "done"; du -sh media resources
