#!/usr/bin/env bash
# The agents' window (SNAP-R83): ONE visible Chrome on this machine that agents drive, reload and restart, never headless
# (the operator, 2026-11-06), with the profile ~/.config/snap-agent-chrome and DevTools on 127.0.0.1:9222. It tells the ComfyUI
# it serves where it listens, so the bridge finds its Snap tab (a tab that sees: calls go there by default, beside a
# person's tab with "Let agents see" on), captures it for screenshot and reloads it after an update (the chrome tool). It
# can be the person's main tab. Whatever answers on 9222 is that window: it is attached to, never started a second time.
# Set SNAP_CHROME_SOFTWARE=1 to opt into software rendering/video decode when GPU pressure causes stalls.
#   start    (default) attach to it when it answers on 9222; open it on <base>/?snap only when nothing does; wait for its
#            Snap tab. A window with no tab on this ComfyUI gets none by itself: another tab is the person's call (new)
#   status   whether it runs, its port and its tabs
#   reload   reload its Snap tabs through the bridge (after the ComfyUI restarted) and wait until they registered again
#   restart  close every process of its profile, then start it again
#   stop     close it
#   new      another Snap tab in the same window: only when the person said yes (pass --asked)
# --extra "<purpose>": the same actions on an extra window for this ComfyUI only (the operator, 2026-11-06: fine "if you are doing
# some things on one gpu and some things on another or doing non gpu contention things"), e.g. GPU checks on a second
# server while 9222 serves the person's: its own profile (~/.config/snap-agent-chrome-<server port>) and DevTools port, the
# purpose as its window name. Never a duplicate: refused while 9222 already has a tab on this ComfyUI. Close it (stop
# --extra) when that work ends.
# It starts under systemd-run --user when there is one (outside the caller's process tree, so a ComfyUI restart never
# takes the window with it; stopping the unit ends every process), else in its own session. The window resolves only
# this machine and the ComfyUI host. "Let agents see" in it shares without a prompt (the tab-capture flags), though its
# tab needs no press: the bridge already counts it as a tab that sees.
# env: SNAP_TOKEN (a gate's account token). Tests only: SNAP_CHROME_PORT, SNAP_CHROME_PROFILE and SNAP_CHROME_BIN point
# the start path at a fake launcher (never a second real window)
# usage: snap_agent_page.sh [port or base URL, default 8188] [start|status|reload|restart|stop|new [--asked]] [--extra "<purpose>"] [page URL]
# SNAP-R30 the agent front door · SNAP-R83 the agents' window · see docs/snap/SNAP_RULES.md
set -eu
action=start; asked=0; extra=; rest=(); args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do a=${args[i]}; case $a in start|status|reload|restart|stop|new) action=$a ;; --asked) asked=1 ;; --extra) i=$((i + 1)); extra=${args[i]:-} ;; *) rest+=("$a") ;; esac; done
where=${rest[0]:-8188}
case $where in *://*) base=${where%/} ;; *) base=http://127.0.0.1:$where ;; esac
url=${rest[1]:-$base/?snap}
host=${base#*://}; host=${host%%/*}; host=${host%:*}
profile=${SNAP_CHROME_PROFILE:-$HOME/.config/snap-agent-chrome}
port=${SNAP_CHROME_PORT:-9222}
main=$port
if [ -n "$extra" ]; then
  serve=${base##*:}; serve=${serve%%/*}
  profile=$profile-$serve; mkdir -p "$profile"
  [ -s "$profile/snap_cdp_port" ] || python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])' >"$profile/snap_cdp_port"
  port=$(cat "$profile/snap_cdp_port")
fi
unit=snap-chrome-$port
auth=(); [ -n "${SNAP_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $SNAP_TOKEN")

up() { curl -sf --max-time 2 "http://127.0.0.1:$port/json/version" >/dev/null; }
mine="$profile(/| |\$)"  # this profile's processes, not those of a profile whose path merely starts the same
alive() { pgrep -f -- "$mine" >/dev/null; }
# the window's Snap tabs on this base: "<DevTools id> <url>" per line
tabs() { curl -s --max-time 3 "http://127.0.0.1:$port/json/list" | python3 -c 'import json, sys
for t in json.load(sys.stdin):
    if t.get("type") == "page" and t.get("url", "").startswith(sys.argv[1]):
        print(t["id"], t["url"])' "$base"; }
attach() { curl -s --max-time 10 -o /dev/null "${auth[@]}" -X POST "$base/mainodes/snap/chrome" -H 'Content-Type: application/json' -d "{\"cdp\": $port, \"profile\": \"$profile\"}"; }
call() { curl -s --max-time 60 "${auth[@]}" -X POST "$base/mainodes/snap/call" -H 'Content-Type: application/json' -d "{\"tool\": \"chrome\", \"args\": $1}"; }
# the newest registered page in the window: "<id> <code_current>", or nothing yet
managed() { curl -s --max-time 10 "${auth[@]}" "$base/mainodes/snap/tools" | python3 -c 'import json, sys
p = [x for x in json.load(sys.stdin).get("pages") or [] if x.get("managed")]
print(p[-1]["id"], p[-1]["code_current"]) if p else None'; }

stop() {
  if command -v systemctl >/dev/null && systemctl --user is-active --quiet "$unit" 2>/dev/null; then systemctl --user stop "$unit"; fi
  pkill -f -- "--user-data-dir=$mine" 2>/dev/null || true
  for _ in $(seq 40); do alive || return 0; sleep 0.25; done
  pkill -9 -f -- "$mine" 2>/dev/null || true  # what didn't exit by itself (a helper of a window that hung)
  sleep 0.5; ! alive || { echo "Chrome processes of $profile are still running: $(pgrep -f -- "$mine" | tr '\n' ' ')" >&2; return 1; }
}

start() {
  curl -s --max-time 10 -o /dev/null "${auth[@]}" "$base/system_stats" || { echo "ComfyUI is not reachable at $base: start it first." >&2; return 1; }
  if [ -n "$extra" ] && [ -n "$(port=$main tabs 2>/dev/null)" ]; then
    echo "The agents' window (127.0.0.1:$main) already has a tab on $base: use it; an extra window never duplicates a server." >&2; return 1
  fi
  if up; then
    [ -n "$(tabs)" ] || { attach; echo "The agents' window is open (DevTools 127.0.0.1:$port) but has no tab on $base, and opens none by itself: another tab needs the person's yes (then $0 $where new --asked)." >&2; return 1; }
  else
    [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || { echo "No display here (DISPLAY and WAYLAND_DISPLAY are empty): the agents' window is a visible window and never runs headless. Run this from the person's desktop session." >&2; return 1; }
    if alive; then echo "A Chrome of the agents' profile runs but nothing answers on 127.0.0.1:$port (it hung?): $0 $where restart closes it and opens it again." >&2; return 1; fi
    chrome=${SNAP_CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)}
    [ -n "$chrome" ] || { echo "No Chrome or Chromium found on PATH." >&2; return 1; }
    mkdir -p "$profile"
    # SNAP-R83: software rendering is a local fallback, not a default for every machine.
    flags=(--user-data-dir="$profile" --remote-debugging-port="$port" --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --new-window
      --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE $host"
      --auto-accept-this-tab-capture --auto-select-tab-capture-source-by-title=Snap --enable-features=WebMCP ${extra:+"--window-name=$extra"} "$url")
    if [ "${SNAP_CHROME_SOFTWARE:-0}" = 1 ]; then flags=(--disable-gpu --disable-accelerated-video-decode "${flags[@]}"); fi
    if command -v systemd-run >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
      env=(); for v in DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS; do [ -n "${!v:-}" ] && env+=(-E "$v=${!v}"); done
      systemctl --user reset-failed "$unit" 2>/dev/null || true
      systemd-run --user --quiet --collect --unit "$unit" "${env[@]}" "$chrome" "${flags[@]}"
    else
      setsid "$chrome" "${flags[@]}" >"$profile.log" 2>&1 </dev/null &
    fi
    for _ in $(seq 40); do up && break; sleep 0.5; done
    up || { echo "Chrome started but its DevTools port $port doesn't answer (is the port taken?)" >&2; return 1; }
  fi
  attach
  for _ in $(seq 90); do
    read -r id current <<<"$(managed)" || true
    if [ -n "${id:-}" ]; then
      echo "The agents' window is open on $base (Snap page $id, code_current $current; DevTools 127.0.0.1:$port, profile $profile). Calls go to it by default; screenshot, reload and restart work on it (chrome tool, or $0 $where status|reload|restart)."
      return 0
    fi
    sleep 1
  done
  echo "The window is open, but no Snap tab in it registered within 90 s. Is MAINodes installed on $base? $0 $where status lists its tabs." >&2
  return 1
}

case $action in
  start) start ;;
  stop) stop && echo "Closed the agents' window ($profile)." ;;
  restart) stop && start ;;
  status) if up; then attach; echo "The agents' window runs (DevTools 127.0.0.1:$port, profile $profile). Its Snap tabs on $base:"; tabs; else echo "The agents' window isn't running (profile $profile). Start it: $0 $where"; fi ;;
  reload) up || { echo "The agents' window isn't running: $0 $where" >&2; exit 1; }; attach; call '{"action": "reload"}'; echo ;;
  new)
    [ $asked = 1 ] || { echo "Agents drive the person's main tab by default (SNAP-R83). Another tab needs the person's yes: ask them, then run $0 $where new --asked. It opens visible in the agents' window, never headless." >&2; exit 1; }
    up || { echo "The agents' window isn't running: start it first ($0 $where)." >&2; exit 1; }
    curl -s --max-time 10 -X PUT "http://127.0.0.1:$port/json/new?$url" | python3 -c 'import json, sys; print("Opened another Snap tab in the agents\x27 window:", json.load(sys.stdin)["id"])' ;;
esac
