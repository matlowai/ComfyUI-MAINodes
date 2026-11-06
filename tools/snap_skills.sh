#!/usr/bin/env bash
# The Snap skills in Claude Code outside the pack (SNAP-R94): link puts a symlink per skill into ~/.claude/skills/
# (~/.claude/skills/snap-core -> <pack>/.claude/skills/snap-core), so a session started anywhere lists them; the files
# stay the pack's, one copy. unlink takes away only the links that point into this pack; status says what is where.
# A folder of the same name that isn't such a link is left alone and named. The person's own versions of skills are
# records served by read_skill, not these files.
# usage: bash tools/snap_skills.sh link | unlink | status
set -u
pack="$(cd "$(dirname "$0")/.." && pwd)"
src="$pack/.claude/skills"
dst="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
action="${1:-status}"
case "$action" in link|unlink|status) ;; *) echo "usage: bash $0 link | unlink | status"; exit 2;; esac
[ -d "$src" ] || { echo "no skills folder at $src"; exit 1; }
mkdir -p "$dst"
for d in "$src"/*/; do
  name="$(basename "$d")"; here="$dst/$name"; want="$src/$name"
  if [ -L "$here" ]; then
    to="$(readlink "$here")"
    if [ "$to" = "$want" ]; then
      case "$action" in
        link) echo "$name: linked already";;
        unlink) rm "$here" && echo "$name: link taken away";;
        status) echo "$name: linked -> $want";;
      esac
    else
      echo "$name: $here links elsewhere ($to): left alone"
    fi
  elif [ -e "$here" ]; then
    echo "$name: $here is a folder of your own: left alone (move it aside to link the pack's)"
  else
    case "$action" in
      link) ln -s "$want" "$here" && echo "$name: linked -> $want";;
      unlink|status) echo "$name: not linked";;
    esac
  fi
done
