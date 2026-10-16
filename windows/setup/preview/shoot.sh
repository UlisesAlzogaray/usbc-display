#!/bin/bash
# Screenshots of the setup window for review (SPEC §9 WP6, §10), with a headless Chromium browser.
#
#   subs/       every [screen, sub] of D.SUBS (steps.js), light and dark, 800 x 600 at ?mpt=1
#   variants/   the §10.1 / §10.4 variants: standard account, signed, notarized, update, keyboard
#               row, edge, pointer, the Mac's copy (?mac=1, pixel identity with ready/starting), inactive,
#               the un-notarized open-app screen with rows 1-2 done (?settings=1), and every Learn
#               More… sheet the page has over the screen that opens it
#   accents/    every picture sub-state with the Purple and the Blue accent (the default shots take the
#               accent as the host would know it: none from Safari, the Mac's once the app answers)
#   frames/     every picture sub-state frozen at f=0.3 and f=0.6, light and dark; the un-notarized
#               open-app screen (one story in four chapters) at f=0.1…0.9, and with rows 1-2 done
#   scenarios/  every §10.3 scenario played to its end (?scenario=…&play=1, on virtual time):
#               <name>.png is the last frame, <name>.json the mock's log; summary.txt says which
#               ended where they must, with no backward flash and none of the mock's checks failed
#               (problems: a permission screen going from settings to prompt; a hand-off hold that
#               still asks for Yes after No; a status check whose work hasn't completed; a place
#               the scenario must never show; a screen built before this PC is checked, a first
#               frame that fades in, or 'shown' before that frame is whole; the un-notarized open-app
#               screen changing its sub or its rows' wording, or unchecking a row)
#   fit/        D.debug.fit() for every sub-state at --mpt 1.25 and 1.5 (§10.2.5): fit-*.json, fit.txt
#   safari/     the Safari download page (web/index.html), states a-d, light and dark
#   kit/        preview/macos-kit.html: every Mac scene in band framing; a story scene (tl.chapters)
#               also near the start, at the middle and at the end of each chapter, and played from
#               its last chapter on
#   index.html  all of the above on one page
#
# Usage:  preview/shoot.sh [--only subs,variants,accents,frames,scenarios,fit,safari,kit] [filter]
#         filter = a substring of the shot names to keep (e.g. "ready", "dark", "first-run").
# Env:    CHROME  a Chromium browser (found by itself: Edge or Chrome on Windows; chrome-headless-shell
#                 (~/.cache), Chrome or Edge on macOS)
#         OUT     output folder (default preview/shots, which git ignores)
#         SCALE   device scale factor (default 1; 2 for the §10.1 comparison with the 2x Apple renders)
#         JOBS    browsers at once (default 6)
#         MPT     the Mac point in CSS px for subs/variants/frames (default 1)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SETUP="$(cd "$HERE/.." && pwd)"
OUT="${OUT:-$HERE/shots}"
SCALE="${SCALE:-1}"
JOBS="${JOBS:-6}"
MPT="${MPT:-1}"
ONLY="subs,variants,accents,frames,scenarios,fit,safari,kit"
FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) FILTER="$1"; shift ;;
  esac
done
want() { case ",$ONLY," in *",$1,"*) return 0 ;; esac; return 1; }

# ---------- Platform and browser ----------
WIN=0
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; esac
if [ -z "${CHROME:-}" ]; then
  for c in \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "$(ls -d "$HOME"/.cache/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
if [ -z "${CHROME:-}" ] || [ ! -x "$CHROME" ]; then echo "No Chromium browser found. Set CHROME=/path/to/chrome." >&2; exit 1; fi
# A path as the browser wants it (Windows paths on Windows), and a file:// URL for it.
native() { if [ "$WIN" = 1 ]; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
url() { if [ "$WIN" = 1 ]; then printf 'file:///%s' "$(cygpath -m "$1")"; else printf 'file://%s' "$1"; fi; }
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 120"; elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT="gtimeout 120"; fi

mkdir -p "$OUT"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/usbc-shoot.XXXXXX")"
trap 'rm -rf "$TMP" 2>/dev/null' EXIT
UI="$(url "$SETUP/ui/index.html")"
KIT="$(url "$HERE/macos-kit.html")"

# One browser run. mode: shot (a PNG) or dom (the page after the run, for the mock's <pre> output).
# Each run gets its own profile, so runs can go side by side.
run1() {
  local name="$1" mode="$2" target="$3" size="$4" budget="$5" dark="$6"
  local prof; prof="$(mktemp -d "$TMP/prof.XXXXXX")"
  local hl=--headless=new
  case "$CHROME" in *chrome-headless-shell*) hl=--headless ;; esac   # the shell is the old headless only
  local args=($hl --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check
    --force-device-scale-factor="$SCALE" --window-size="$size" --user-data-dir="$(native "$prof")"
    --allow-file-access-from-files --virtual-time-budget="$budget" --run-all-compositor-stages-before-draw)
  if [ "$dark" = dark ]; then args+=(--force-dark-mode --blink-settings=preferredColorScheme=0); else args+=(--blink-settings=preferredColorScheme=1); fi
  mkdir -p "$(dirname "$OUT/$name")"
  if [ "$mode" = shot ]; then
    $TIMEOUT "$CHROME" "${args[@]}" --screenshot="$(native "$OUT/$name.png")" "$target" >/dev/null 2>&1 || echo "failed: $name" >&2
  else
    $TIMEOUT "$CHROME" "${args[@]}" --dump-dom "$target" > "$prof/dom.html" 2>/dev/null || echo "failed: $name" >&2
    cp "$prof/dom.html" "$OUT/$name.dom.html" 2>/dev/null
  fi
  rm -rf "$prof" 2>/dev/null   # a helper process may still hold a file; the trap cleans up at the end
}
export -f run1 native
export CHROME SCALE OUT TMP WIN TIMEOUT

# Jobs: name|mode|url|size|budget|dark
JOBLIST="$TMP/jobs.txt"
: > "$JOBLIST"
add() { echo "$1|$2|$3|$4|$5|$6" >> "$JOBLIST"; }
runall() {
  local n; n=$(grep -c -- "$FILTER" "$JOBLIST" || true)
  [ "$n" -gt 0 ] || return 0
  echo "  $n browser runs, $JOBS at a time…"
  # One job line per bash (no -I: BSD xargs caps replaced arguments at 255 bytes).
  grep -- "$FILTER" "$JOBLIST" | tr '\n' '\0' | xargs -0 -n 1 -P "$JOBS" bash -c 'IFS="|" read -r a b c d e f <<< "$1"; run1 "$a" "$b" "$c" "$d" "$e" "$f"' _
  : > "$JOBLIST"
}
# The <pre id=…> text of a dumped page (HTML entities undone).
pretext() { sed -n "s/.*<pre id=\"$2\"[^>]*>\\([^<]*\\)<\\/pre>.*/\\1/p" "$1" | sed 's/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&amp;/\&/g'; }

# ---------- Every [screen, sub] (D.SUBS, from the page itself) ----------
SUBS="$TMP/subs.txt"
run1 "_subs" dom "$UI?list=subs" 800,600 3000 light
# The text of <pre id="$1"> in the dumped page $2, one line per entry.
prelist() { [ -f "$2" ] && tr -d '\r' < "$2" | tr '\n' '\v' | sed "s/.*<pre id=\"$1\"[^>]*>\\([^<]*\\)<\\/pre>.*/\\1/" | tr '\v' '\n'; }
prelist mock-subs "$OUT/_subs.dom.html" | grep -E '^[a-z-]+ [a-z-]+$' > "$SUBS" || true
SHEETS="$(prelist mock-sheets "$OUT/_subs.dom.html" | grep -E '^[a-z0-9-]+$' | tr '\n' ' ')"
# The un-notarized open-app screen: one sub from the download to the Mac app's answer.
STORY="$(prelist mock-story "$OUT/_subs.dom.html" | grep -E '^[a-z-]+$' | head -1)"
rm -f "$OUT/_subs.dom.html"
if [ ! -s "$SUBS" ]; then
  echo "The page didn't list D.SUBS; using SPEC §3." >&2
  cat > "$SUBS" <<'EOF'
welcome idle
unsupported idle
incomplete idle
install-error in-use
install-error other
allow-pc installing
allow-pc waiting
allow-pc pending
allow-pc pending-hint
allow-pc working
allow-pc done
allow-pc ask
allow-pc refused
allow-pc failed
connect cable
connect cable-hint
connect no-cable
connect reconnect
connect finding
connect no-mac
connect no-server
connect port-busy
unreachable waiting
unreachable help
get-app address
get-app address-hint
get-app address-ip
get-app download
get-app download-hint
get-app allow-downloads
get-app downloading
open-app downloads
open-app confirm
open-app setting-up
open-app setting-up-late
move idle
move moving
move failed
login settings
login asking
allow-screen prompt
allow-screen settings
allow-screen reopen
allow-screen reopen-late
allow-screen off
keyboard offer
allow-control prompt
allow-control settings
allow-control off
ready starting
ready cut
ready showing
ready hidden
ready manual
ready elsewhere
ready error
ready error-files
EOF
fi
[ -n "$STORY" ] || STORY="$(awk '$1 == "open-app" && $2 !~ /^(downloads|confirm|setting-up|setting-up-late)$/ { print $2; exit }' "$SUBS")"
[ -n "$STORY" ] || STORY=downloads
[ -n "$SHEETS" ] || SHEETS="permission cable mac-connect mac-respond safari screen control desktop"
echo "$(wc -l < "$SUBS" | tr -d ' ') sub-states; un-notarized open-app: $STORY; sheets: $SHEETS"
picture() { case "$1" in get-app|open-app|login|allow-screen|allow-control) return 0 ;; esac; return 1; }
Q="mpt=$MPT&shot=1"

if want subs; then
  echo "subs/"
  while read -r s u; do
    for th in light dark; do add "subs/$s--$u--$th" shot "$UI?step=$s&sub=$u&theme=$th&$Q" 800,600 3000 "$th"; done
  done < "$SUBS"
  runall
fi

if want variants; then
  echo "variants/"
  v() { add "variants/$1--$3" shot "$UI?$2&theme=$3&$Q" 800,600 3000 "$3"; }
  for th in light dark; do
    v welcome--standard "step=welcome&sub=idle&acct=standard" $th
    v allow-pc--waiting--standard "step=allow-pc&sub=waiting&acct=standard" $th
    v allow-pc--pending--standard "step=allow-pc&sub=pending&acct=standard" $th
    v allow-pc--pending--signed "step=allow-pc&sub=pending&signed=1" $th
    v get-app--address--update "step=get-app&sub=address&update=1" $th
    v get-app--download--update "step=get-app&sub=download&update=1" $th
    v open-app--downloads--notarized "step=open-app&sub=downloads&notarized=1" $th
    v open-app--confirm--notarized "step=open-app&sub=confirm&notarized=1" $th
    v "open-app--$STORY--settings" "step=open-app&sub=$STORY&settings=1" $th
    v ready--starting--input "step=ready&sub=starting&input=1" $th
    v ready--cut--mac "step=ready&sub=cut&mac=1" $th
    v ready--cut--mac--input "step=ready&sub=cut&mac=1&input=1" $th
    v ready--showing--mac "step=ready&sub=showing&mac=1" $th
    v ready--showing--mac--input "step=ready&sub=showing&mac=1&input=1" $th
    v ready--showing--mac--edge-left "step=ready&sub=showing&mac=1&edge=left" $th
    v ready--showing--mac--edge-unknown "step=ready&sub=showing&mac=1&edge=unknown" $th
    v ready--showing--mac--pointer "step=ready&sub=showing&mac=1&pointer=1" $th
    v ready--showing--mac--inactive "step=ready&sub=showing&mac=1&inactive=1" $th
    v welcome--inactive "step=welcome&sub=idle&inactive=1" $th
    v keyboard--offer--inactive "step=keyboard&sub=offer&inactive=1" $th
    v allow-pc--ask--standard "step=allow-pc&sub=ask&acct=standard" $th
    v allow-pc--refused--standard "step=allow-pc&sub=refused&acct=standard" $th
    v connect--no-server--standard "step=connect&sub=no-server&acct=standard" $th
    v ready--showing--inactive "step=ready&sub=showing&inactive=1" $th
    # Every Learn More… sheet the page has, over the screen that opens it (the permission sheet
    # also signed; the open-app ones over the un-notarized screen, before and after Open
    # Privacy & Security).
    for id in $SHEETS; do
      case "$id" in
        permission) v sheet--permission "step=allow-pc&sub=pending&sheet=permission" $th
                    v sheet--permission--signed "step=allow-pc&sub=pending&signed=1&sheet=permission" $th ;;
        cable) v sheet--cable "step=connect&sub=cable&sheet=cable" $th ;;
        mac-connect) v sheet--mac-connect "step=connect&sub=no-mac&sheet=mac-connect" $th ;;
        mac-respond) v sheet--mac-respond "step=unreachable&sub=help&sheet=mac-respond" $th ;;
        safari) v sheet--safari "step=get-app&sub=address-hint&sheet=safari" $th ;;
        gatekeeper) v sheet--gatekeeper "step=open-app&sub=$STORY&sheet=gatekeeper" $th ;;
        open-anyway) v sheet--open-anyway "step=open-app&sub=$STORY&settings=1&sheet=open-anyway" $th ;;
        screen) v sheet--screen "step=allow-screen&sub=prompt&sheet=screen" $th
                v sheet--screen--inactive "step=allow-screen&sub=prompt&sheet=screen&inactive=1" $th ;;
        control) v sheet--control "step=keyboard&sub=offer&sheet=control" $th ;;
        desktop) v sheet--desktop "step=ready&sub=error&sheet=desktop" $th ;;
        *) [ "$th" = light ] && echo "  sheet $id: no screen known for it here, shot over the un-notarized open-app screen" >&2
           v "sheet--$id" "step=open-app&sub=$STORY&sheet=$id" $th ;;
      esac
    done
  done
  runall
fi

if want accents; then
  echo "accents/"
  while read -r s u; do
    picture "$s" || continue
    for ac in purple blue; do for th in light dark; do
      add "accents/$s--$u--$ac--$th" shot "$UI?step=$s&sub=$u&theme=$th&accent=$ac&$Q" 800,600 3000 "$th"
    done; done
  done < "$SUBS"
  runall
fi

if want frames; then
  echo "frames/"
  while read -r s u; do
    picture "$s" || continue
    fs="0.3 0.6"
    # The un-notarized open-app story: four chapters in one loop, so more frames.
    [ "$s" = open-app ] && [ "$u" = "$STORY" ] && fs="0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9"
    for f in $fs; do for th in light dark; do
      add "frames/$s--$u--f$f--$th" shot "$UI?step=$s&sub=$u&theme=$th&f=$f&mpt=$MPT&shot=1" 800,600 3000 "$th"
    done; done
  done < "$SUBS"
  # ... and with rows 1-2 done, when only the last chapter plays.
  for f in 0.2 0.5 0.8; do for th in light dark; do
    add "frames/open-app--$STORY--settings--f$f--$th" shot "$UI?step=open-app&sub=$STORY&settings=1&theme=$th&f=$f&mpt=$MPT&shot=1" 800,600 3000 "$th"
  done; done
  runall
fi

SCENARIOS="first-run first-run-standard uac-refused rerun-downloaded cable-late mac-not-found unplug-blip search-page
  allow-downloads move-to-trash back-to-safari done-focus focus-noise focus-noise-cleared download-again mac-ping notarized relaunch relaunch-late prompt-closed keyboard-yes keyboard-no
  mac-asleep ready-inactive ctrl-alt-esc display-error refused-black second-mac outdated-mac incomplete unsupported returning
  install-error login-off move uac-failed tasks-failed rerun-downloaded-ready handoff-hold handoff-hold-inactive"
if want scenarios; then
  echo "scenarios/ (played on the browser's virtual clock: minutes take a second)"
  for sc in $SCENARIOS; do
    add "scenarios/$sc" dom "$UI?scenario=$sc&play=1&log=1&mpt=$MPT" 800,600 400000 dark
    add "scenarios/$sc" shot "$UI?scenario=$sc&play=1&mpt=$MPT" 800,600 400000 dark
  done
  runall
  SUM="$OUT/scenarios/summary.txt"
  : > "$SUM"
  for sc in $SCENARIOS; do
    d="$OUT/scenarios/$sc.dom.html"
    [ -f "$d" ] || continue
    j="$(pretext "$d" mock-log)"
    printf '%s\n' "$j" > "$OUT/scenarios/$sc.json"
    rm -f "$d"
    end="$(printf '%s' "$j" | grep -o '"end":"[^"]*"' | head -1 | cut -d'"' -f4)"
    exp="$(printf '%s' "$j" | grep -o '"expected":"[^"]*"' | head -1 | cut -d'"' -f4)"
    ok="$(printf '%s' "$j" | grep -o '"ok":[a-z]*' | head -1 | cut -d: -f2)"
    fl="$(printf '%s' "$j" | grep -o '"flashes":\[[^]]*\]' | head -1 | sed 's/"flashes":\[\(.*\)\]/\1/')"
    wa="$(printf '%s' "$j" | grep -o '"welcomeAfterStart":[a-z]*' | cut -d: -f2)"
    path="$(printf '%s' "$j" | grep -o '"transitions":\[[^]]*\]' | head -1 | grep -o '"place":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' ')"
    pr="$(printf '%s' "$j" | grep -o '"problems":\[[^]]*\]' | head -1 | sed 's/"problems":\[\(.*\)\]/\1/')"
    verdict=PASS
    { [ "$ok" = true ] && [ -z "$fl" ] && [ "$wa" != true ] && [ -z "$pr" ]; } || verdict=FAIL
    printf '%-20s %s  end %-24s expected %-20s%s%s%s\n    %s\n' "$sc" "$verdict" "${end:-?}" "${exp:-?}" \
      "${fl:+  flashes: $fl}" "$( [ "$wa" = true ] && echo '  WELCOME AFTER CONTINUE')" "${pr:+  problems: $pr}" "$path" >> "$SUM"
  done
  cat "$SUM"
fi

if want fit; then
  echo "fit/ (D.debug.fit at --mpt 1.25 and 1.5, light and dark)"
  for m in 1.25 1.5; do add "fit/fit-$m" dom "$UI?step=welcome&fit=all&mpt=$m&shot=1" 1200,900 60000 light; done
  runall
  : > "$OUT/fit/fit.txt"
  for m in 1.25 1.5; do
    d="$OUT/fit/fit-$m.dom.html"
    [ -f "$d" ] || continue
    pretext "$d" mock-fit > "$OUT/fit/fit-$m.json"
    rm -f "$d"
    tr '}' '\n' < "$OUT/fit/fit-$m.json" | grep '"ok":false' | sed 's/^[,[{]*//' | sed "s/^/mpt $m: /" >> "$OUT/fit/fit.txt"
  done
  n=$(grep -c . "$OUT/fit/fit.txt" || true)
  echo "  $n frames don't fit (fit/fit.txt)"; head -20 "$OUT/fit/fit.txt"
fi

if want safari; then
  echo "safari/"
  W="$TMP/web"; mkdir -p "$W"
  cp "$SETUP/web/icon.png" "$W/" 2>/dev/null
  page() { sed -e "s/{{HAS_APP}}/$1/; s/{{NOTARIZED}}/$2/; s/{{SIZE}}/$3/; s/{{VERSION}}/5/" "$SETUP/web/index.html" > "$W/$4.html"; }
  page true false "0.7 MB" un
  page true true "0.7 MB" nt
  page false false "" none
  for th in light dark; do
    add "safari/a--$th" shot "$(url "$W/un.html")" 1000,700 3000 $th
    add "safari/b--$th" shot "$(url "$W/un.html")?state=b" 1000,700 3000 $th
    add "safari/b-notarized--$th" shot "$(url "$W/nt.html")?state=b" 1000,700 3000 $th
    add "safari/c--$th" shot "$(url "$W/un.html")?state=c" 1000,700 3000 $th
    add "safari/d--$th" shot "$(url "$W/none.html")" 1000,700 3000 $th
  done
  runall
fi

if want kit; then
  echo "kit/"
  run1 "_kit" dom "$KIT" 800,600 4000 light
  NAMES="$(prelist kit-names "$OUT/_kit.dom.html" | grep -E '^[a-z0-9-]+$' || true)"
  # Scenes told in chapters ("name count"), such as the un-notarized open-app story.
  CHAPTERS="$(prelist kit-chapters "$OUT/_kit.dom.html" | grep -E '^[a-z0-9-]+ [0-9]+$' || true)"
  rm -f "$OUT/_kit.dom.html"
  # The whole grid (k=0.5: Dark and Light, Purple and Blue), at the poster frames and mid-loop.
  add "kit/all--poster" shot "$KIT?poster=1&theme=dark" 1900,3300 8000 dark
  add "kit/all--f0.3" shot "$KIT?f=0.3&theme=dark" 1900,3300 8000 dark
  add "kit/all--f0.6" shot "$KIT?f=0.6&theme=dark" 1900,3300 8000 dark
  # Each scene at full size.
  for n in $NAMES; do
    add "kit/$n--dark-purple" shot "$KIT?scene=$n&cols=dark:purple&poster=1&theme=dark" 1080,470 4000 dark
    add "kit/$n--light-blue" shot "$KIT?scene=$n&cols=light:blue&poster=1&theme=light" 1080,470 4000 light
  done
  # Each chapter of a story scene near its start, at its middle and at its end (the click's result
  # still showing), and the scene played from its last chapter only (opt.fromChapter, 0-based in
  # tl.chapters: what the window plays once the earlier rows are done).
  while read -r n c; do
    [ -n "$n" ] || continue
    for i in $(seq 1 "$c"); do
      for at in 0.15 0.5 0.9; do
        add "kit/$n--ch$i-$at--dark-purple" shot "$KIT?scene=$n&cols=dark:purple&chapter=$i&at=$at&theme=dark" 1080,470 4000 dark
      done
      add "kit/$n--ch$i-0.5--light-blue" shot "$KIT?scene=$n&cols=light:blue&chapter=$i&at=0.5&theme=light" 1080,470 4000 light
    done
    last=$((c - 1))
    for f in 0.2 0.5 0.8; do
      add "kit/$n--from$last-f$f--dark-purple" shot "$KIT?scene=$n&cols=dark:purple&from=$last&f=$f&theme=dark" 1080,470 4000 dark
    done
  done <<< "$CHAPTERS"
  runall
fi

# ---------- One page with everything ----------
{
  echo '<!doctype html><meta charset="utf-8"><title>USB-C Display Setup shots</title>'
  echo '<style>body{font:13px/1.4 -apple-system,system-ui,sans-serif;margin:20px;background:#f4f4f4}h2{margin:28px 0 8px}'
  echo '.g{display:flex;flex-wrap:wrap;gap:14px}figure{margin:0}figure img{display:block;width:400px;border:1px solid #ccc;background:#fff}'
  echo 'figcaption{max-width:400px;word-break:break-all;color:#555}pre{background:#fff;padding:10px;white-space:pre-wrap}</style>'
  for dir in subs variants accents frames scenarios safari kit; do
    [ -d "$OUT/$dir" ] || continue
    ls "$OUT/$dir"/*.png >/dev/null 2>&1 || continue
    echo "<h2>$dir</h2>"
    [ -f "$OUT/$dir/summary.txt" ] && { echo '<pre>'; sed 's/&/\&amp;/g; s/</\&lt;/g' "$OUT/$dir/summary.txt"; echo '</pre>'; }
    echo '<div class="g">'
    for f in "$OUT/$dir"/*.png; do b="$(basename "$f")"; echo "<figure><a href=\"$dir/$b\"><img loading=\"lazy\" src=\"$dir/$b\"></a><figcaption>${b%.png}</figcaption></figure>"; done
    echo '</div>'
  done
  [ -f "$OUT/fit/fit.txt" ] && { echo '<h2>fit</h2><pre>'; sed 's/&/\&amp;/g; s/</\&lt;/g' "$OUT/fit/fit.txt"; echo '</pre>'; }
} > "$OUT/index.html"
echo "Wrote $(find "$OUT" -name '*.png' | wc -l | tr -d ' ') shots to $OUT (index.html)."
