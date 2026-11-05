#!/usr/bin/env bash
# Opens Snap in a headless Chrome page so an agent can drive it through the bridge (snap_mcp.py, snapcall.py or curl).
# It returns once the page has registered with the bridge, and leaves the page running; --stop closes the pages it
# started for that ComfyUI (no pid or kill needed, U72 F13: an agent's sandbox may refuse kill).
# Each launch uses its own new Chrome profile, so a profile left locked by an earlier page that died never blocks it.
# When a Snap page of yours running the server's current code is already open, it says so and starts nothing (calls
# already go there); a page running older code doesn't count; --new starts another anyway. The page reaches only this machine and the ComfyUI host: other host names don't resolve.
# The page gets no pointer or key input, so it never uses the person's one-time onboarding (SNAP-R29).
# Its Chrome listens for DevTools on a free 127.0.0.1 port, which it tells the bridge, so `screenshot` on this page
# returns a picture of it with no gesture (anime dogfood F-A01); nothing outside this machine can reach that port.
# usage: snap_agent_page.sh [port or base URL, default 8188] [page URL, default <base>/?snap] [--new]
#        snap_agent_page.sh [port or base URL] --stop
#   e.g. snap_agent_page.sh 8188
#        SNAP_TOKEN=... snap_agent_page.sh http://127.0.0.1:8197 "http://127.0.0.1:8197/gate/login?token=$SNAP_TOKEN&next=/%3Fsnap"
# SNAP-R30 the agent front door · see docs/SNAP_RULES.md
set -eu
new=0; stop=0; rest=()
for a in "$@"; do case $a in --new) new=1 ;; --stop) stop=1 ;; *) rest+=("$a") ;; esac; done
where=${rest[0]:-8188}
case $where in *://*) base=${where%/} ;; *) base=http://127.0.0.1:$where ;; esac
url=${rest[1]:-$base/?snap}
host=${base#*://}; host=${host%%/*}; host=${host%:*}
auth=(); [ -n "${SNAP_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $SNAP_TOKEN")

# each page's profile folder keeps its Chrome's pid and the ComfyUI it opened; --stop ends those for this base
if [ $stop = 1 ]; then
  n=0
  for d in "${TMPDIR:-/tmp}"/snap-agent-chrome.*/; do
    [ -f "$d/pid" ] && [ "$(cat "$d/base" 2>/dev/null)" = "$base" ] || continue
    pid=$(cat "$d/pid")
    # only while that pid is still this profile's Chrome (a pid can be reused after it exits)
    if ps -o args= -p "$pid" 2>/dev/null | grep -qF -- "--user-data-dir=${d%/}"; then kill -- "-$pid" 2>/dev/null || kill "$pid"; n=$((n + 1)); fi
  done
  echo "Stopped $n Snap agent page(s) on $base."
  exit 0
fi

# the caller's open Snap pages, from the bridge's health listing: "<count> <seconds since the newest last answered or ->"
pages() {
  curl -s --max-time 10 "${auth[@]}" "$base/mainodes/snap/tools" | python3 -c '
import json, sys
try:
    p = json.load(sys.stdin).get("pages") or []
except ValueError:
    p = []
p = [x for x in p if x.get("code_current", True)]  # pages running older Snap code are left out (U72 F20)
last = [x["last_answer_s_ago"] for x in p if x.get("calls_go_here")]
print(len(p), last[0] if last and last[0] is not None else "-")'
}
curl -s --max-time 10 -o /dev/null "${auth[@]}" "$base/system_stats" || { echo "ComfyUI is not reachable at $base: start it first." >&2; exit 1; }
read -r before answered <<<"$(pages)"
if [ "$before" -gt 0 ] && [ $new = 0 ]; then
  echo "A Snap page of yours is already open on $base ($before open; the one calls go to last answered ${answered} s ago, - = not yet): calls go to it, nothing started. Pass --new to start another anyway."
  exit 0
fi

chrome=$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)
[ -n "$chrome" ] || { echo "No Chrome or Chromium found on PATH." >&2; exit 1; }
profile=$(mktemp -d "${TMPDIR:-/tmp}/snap-agent-chrome.XXXXXX")
cdp=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
setsid "$chrome" --headless=new --no-first-run --no-default-browser-check \
  --user-data-dir="$profile" --window-size=1600,1000 --remote-debugging-port="$cdp" \
  --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE $host" \
  --auto-accept-this-tab-capture --enable-features=WebMCP \
  "$url" >"$profile/chrome.log" 2>&1 </dev/null &
pid=$!
echo $pid >"$profile/pid"; echo "$base" >"$profile/base"
for _ in $(seq 90); do
  sleep 1
  kill -0 $pid 2>/dev/null || { echo "Chrome exited before the page registered; its log: $profile/chrome.log" >&2; tail -5 "$profile/chrome.log" >&2; exit 1; }
  read -r now _ <<<"$(pages)"
  if [ "$now" -gt "$before" ]; then
    curl -s --max-time 10 -o /dev/null "${auth[@]}" -X POST "$base/mainodes/snap/agent_page" -H 'Content-Type: application/json' -d "{\"cdp\": $cdp}"
    echo "Snap agent page is open on $base and registered (pid $pid, profile $profile). Calls go to it. Stop it with: $0 $where --stop"
    exit 0
  fi
done
echo "The page didn't register within 90 s (pid $pid still running; its log: $profile/chrome.log). Is MAINodes installed on $base? Stop it with: $0 $where --stop" >&2
exit 1
