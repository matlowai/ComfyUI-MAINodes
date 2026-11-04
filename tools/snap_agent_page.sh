#!/usr/bin/env bash
# Opens Snap in a headless Chrome page so an agent can drive it through the bridge (snap_mcp.py, snapcall.py or curl).
# It returns once the page has registered with the bridge, and leaves the page running; stop it with the kill it prints.
# Each launch uses its own new Chrome profile, so a profile left locked by an earlier page that died never blocks it.
# When a Snap page of yours is already open on that ComfyUI, it says so and starts nothing (calls already go there);
# --new starts another anyway. The page reaches only this machine and the ComfyUI host: other host names don't resolve.
# The page gets no pointer or key input, so it never uses the person's one-time onboarding (SNAP-R29).
# usage: snap_agent_page.sh [port or base URL, default 8188] [page URL, default <base>/?snap] [--new]
#   e.g. snap_agent_page.sh 8188
#        SNAP_TOKEN=... snap_agent_page.sh http://127.0.0.1:8197 "http://127.0.0.1:8197/gate/login?token=$SNAP_TOKEN&next=/%3Fsnap"
# SNAP-R30 the agent front door · see docs/SNAP_RULES.md
set -eu
new=0; rest=()
for a in "$@"; do if [ "$a" = "--new" ]; then new=1; else rest+=("$a"); fi; done
where=${rest[0]:-8188}
case $where in *://*) base=${where%/} ;; *) base=http://127.0.0.1:$where ;; esac
url=${rest[1]:-$base/?snap}
host=${base#*://}; host=${host%%/*}; host=${host%:*}
auth=(); [ -n "${SNAP_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $SNAP_TOKEN")

# the caller's open Snap pages, from the bridge's health listing: "<count> <seconds since the newest last answered or ->"
pages() {
  curl -s --max-time 10 "${auth[@]}" "$base/mainodes/snap/tools" | python3 -c '
import json, sys
try:
    p = json.load(sys.stdin).get("pages") or []
except ValueError:
    p = []
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
setsid "$chrome" --headless=new --no-first-run --no-default-browser-check \
  --user-data-dir="$profile" --window-size=1600,1000 \
  --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE $host" \
  --auto-accept-this-tab-capture --enable-features=WebMCP \
  "$url" >"$profile/chrome.log" 2>&1 </dev/null &
pid=$!
for _ in $(seq 90); do
  sleep 1
  kill -0 $pid 2>/dev/null || { echo "Chrome exited before the page registered; its log: $profile/chrome.log" >&2; tail -5 "$profile/chrome.log" >&2; exit 1; }
  read -r now _ <<<"$(pages)"
  if [ "$now" -gt "$before" ]; then
    echo "Snap agent page is open on $base and registered (pid $pid, profile $profile). Calls go to it. Stop it with: kill $pid"
    exit 0
  fi
done
echo "The page didn't register within 90 s (pid $pid still running; its log: $profile/chrome.log). Is MAINodes installed on $base? Stop it with: kill $pid" >&2
exit 1
