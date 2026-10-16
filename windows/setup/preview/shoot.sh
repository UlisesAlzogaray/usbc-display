#!/bin/bash
# Screenshots of every wizard step and branch, light and dark, plus extra
# frames mid-animation. Output: preview/shots/*.png (gitignored).
# Usage: preview/shoot.sh [filter]   (filter = substring of a shot name)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UI="$HERE/../ui/index.html"
OUT="$HERE/shots"
CHROME="${CHROME:-$HOME/.cache/chrome-headless-shell/mac_arm-152.0.7977.54/chrome-headless-shell-mac-arm64/chrome-headless-shell}"
FILTER="${1:-}"
mkdir -p "$OUT"

# name|query|size
LIST="$(mktemp)"
add() { echo "$1|$2|$3" >> "$LIST"; }

STEPS="welcome check install approve plug connect safari download move login screen access size picture find done"
n=0
for s in $STEPS; do
  n=$((n + 1)); p=$(printf '%02d' $n)
  add "${p}-${s}-light" "step=$s&theme=light&shot=1" 960,680
  add "${p}-${s}-dark" "step=$s&theme=dark&shot=1" 960,680
  add "${p}-${s}-small" "step=$s&theme=light&shot=1" 800,600
done

for sc in usb4-checking usb4-ok usb4-missing installing install-error not-admin elevation-pending elevation-refused elevation-failed elevation-tasks-failed \
  slow-plug slow-link mac-found url-not-ready safari-fallback-hint safari-fallback server-stuck mac-outdated downloading \
  notarized not-notarized not-notarized-late download-outdated moving move-failed login-disabled login-disabled-sent \
  screen-asked screen-sent screen-relaunch relaunch-late access-sent size-no-ax picture-starting picture-error \
  find-showing find-back unplugged mac-asleep; do
  add "sc-${sc}-light" "scenario=$sc&theme=light&shot=1" 960,680
  add "sc-${sc}-dark" "scenario=$sc&theme=dark&shot=1" 960,680
done
for sc in not-notarized slow-link unplugged move-failed login-disabled screen-relaunch; do
  add "sc-${sc}-small" "scenario=$sc&theme=light&shot=1" 800,600
done

# Mid-animation frames for the most animated steps.
for f in 0.16 0.4; do add "anim-safari-f$f" "step=safari&theme=light&f=$f" 960,680; done
for f in 0.27 0.46 0.58 0.75 0.9; do add "anim-not-notarized-f$f" "scenario=not-notarized&theme=light&f=$f" 960,680; done
for f in 0.3 0.5 0.66; do add "anim-picture-f$f" "step=picture&theme=light&f=$f" 960,680; done
for f in 0.18 0.5; do add "anim-move-f$f" "step=move&theme=dark&f=$f" 960,680; done
for f in 0.1 0.36; do add "anim-screen-f$f" "step=screen&theme=dark&f=$f" 960,680; done
for f in 0.3 0.6; do add "anim-plug-f$f" "step=plug&theme=light&f=$f" 960,680; done
add "anim-welcome-f0.5" "step=welcome&theme=dark&f=0.5" 960,680

shoot() {
  IFS='|' read -r name query size <<< "$1"
  local theme=light
  [[ "$query" == *theme=dark* ]] && theme=dark
  local extra=()
  [ "$theme" = dark ] && extra=(--force-dark-mode --blink-settings=preferredColorScheme=0)
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=4000 --window-size="$size" \
    "${extra[@]}" --screenshot="$OUT/$name.png" "file://$UI?$query" >/dev/null 2>&1 || echo "failed: $name"
}
export -f shoot
export CHROME UI OUT

grep -- "$FILTER" "$LIST" | while IFS= read -r line; do printf '%s\0' "$line"; done | xargs -0 -P 8 -I{} bash -c 'shoot "$@"' _ {}
rm -f "$LIST"
echo "wrote $(ls "$OUT"/*.png | wc -l | tr -d ' ') shots to $OUT"
