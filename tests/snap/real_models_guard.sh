#!/usr/bin/env bash
# U90-1: test servers never write into the operator's real model folders (LESSONS "Batch A").
#   real_models_guard.sh before <stamp> <real models> <test models dir>...
#     writes the stamp; fails when a test models dir links a folder into the real models (a test's save would land there)
#   real_models_guard.sh after <stamp> <real models>
#     fails, naming every one, when a file or folder under <real models>/loras changed after the stamp
# One summary line like run_all's (`realmodels N/N PASS|FAIL`); exit 1 on a failure.
set -u
mode=$1 stamp=$2 real=$(readlink -f "$3"); shift 3
if [ "$mode" = before ]; then
  mkdir -p "$(dirname "$stamp")"; touch "$stamp"
  bad=()
  for d in "$@"; do
    while IFS= read -r l; do
      t=$(readlink -f "$l")
      case "$t" in "$real"|"$real"/*) [ -d "$t" ] && bad+=("$l -> $t") ;; esac
    done < <(find "$d" -type l 2>/dev/null)
  done
  if [ ${#bad[@]} -eq 0 ]; then echo "realmodels 1/1 PASS (no test folder links into the real models)"; exit 0; fi
  echo "realmodels 0/1 FAIL: a test server's folder links into the real models; give it a folder of its own:"
  printf '  %s\n' "${bad[@]}"; exit 1
fi
changed=$(find "$real/loras" \( -newer "$stamp" -o -cnewer "$stamp" \) -print 2>/dev/null)
if [ -z "$changed" ]; then echo "realmodels 1/1 PASS (nothing under the real models/loras changed during the run)"; exit 0; fi
echo "realmodels 0/1 FAIL: changed under the real models/loras during the run (a test, or the person's own server):"
printf '%s\n' "$changed" | sed 's/^/  /'; exit 1
