# Post-crash audit — 2026-11-08, 12:58–13:01 EST

Read-only runtime inspection; no server restart, stop, queue cancellation or source change performed. Full targeted command outputs are alongside this report.

## Established evidence

- The machine did not reboot: uptime is 29 days, 8 hours. The desktop shell did crash. User journal records GNOME Shell PID 4785 crashing with signal 11 at 12:49:07, followed by `status=11/SEGV` and `Failed with result core-dump` at 12:49:08. A new GNOME session/shell started at 12:55:21.
- The exact shell crash record contains only a short GJS context trace naming `resource:///org/gnome/shell/ui/init.js:21`; it does not establish what caused the segmentation fault. The old shell unit recorded 8.9G memory peak and 9.8G swap peak over its lifetime, which alone does not establish OOM.
- Targeted kernel journal scan since 08:00 finds no OOM, killed-process, NVIDIA NVRM/Xid, AMD GPU, GPU-reset or segfault signatures. This is absence of matching records, not proof that every possible failure was excluded.
- `snap-live.service` is active, PID 2496646, started 2026-11-07 21:49:28, NRestarts=0. It survived the desktop incident. Its log records completed prompts through 12:50:48. Current memory approximately 6.0GB; recorded lifetime memory peak approximately 48.3GB.
- `snap-qwen21-lab.service` is active, PID 1588137, started 12:48:55, NRestarts=0, about 1.24GB current memory. It started before the shell incident; the previous lab PID was stopped at 12:30:44. Neither event is evidence of a crash.
- Both `http://127.0.0.1:8193/queue` and `http://127.0.0.1:8291/queue` returned empty running and pending arrays, checked twice. No pending render on either target server.
- Elevated NVIDIA status works: driver 595.91.07, CUDA 13.2; both RTX 5090 GPUs idle at 0%, about 3.0/3.2GiB VRAM used, 33/47C. Sandbox NVIDIA failure was an access limitation, not evidence of a failed driver.
- GPU compute contexts also survive on Comfy ports 8194, 8288, 8289 and 8198. They were identified by their PIDs and arguments, but their queues were outside this audit. Both GPUs were idle at observation time.
- RAM is 91GiB total with about 40GiB available and 38GiB swap occupied. Short vmstat samples show zero swap-in/out and 88–91% CPU idle after the first cumulative row. Current memory PSI avg10 is 0.00. Occupied swap is not current swap thrashing.

## Assessment and serial recovery

The recorded immediate failure was a GNOME desktop-shell segmentation fault. The underlying cause is not determined. Current evidence does not show a host reboot, kernel OOM, GPU-driver reset or Comfy failure.

Retain the surviving Comfy services. Restore the visible agent browser/control connection, inspect saved experiment outputs and logs, then resume one bounded task at a time after confirming its queue remains empty. Avoid launching duplicate workers or parallel model loads during recovery. No hardware/server-health blocker was found for that serial recovery; lost browser/agent control state belongs to the coordinator recovery work.

Raw evidence: `desktop_crash.txt`, `kernel_signatures.txt`, `gpu_health.txt`, `services.txt`, `queues.json`, `memory.txt`, `vmstat.txt`, `uptime.txt`.
