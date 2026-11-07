"""A sandboxed ComfyUI for the flow acceptance gates (spec 11).

The custom_nodes directory of the installed ComfyUI is live: whatever sits
there is what the next restart loads. So this harness never touches it. It
makes a private temp root, symlinks THIS worktree in under a lab-only name,
points an extra-model-paths file at that directory, and starts a CPU server
with --disable-all-custom-nodes plus a whitelist for that one name. The
/object_info assertion in ready() is the proof that nothing else loaded.

No websocket client is used or needed: /prompt returns a prompt_id and
/history/<id> answers once the run is done. Execution counts come from the
Flow Probe files under the sandbox's own output directory.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMFY_ROOT = "/mnt/work/ai/apps/ComfyUI"
VENV_PYTHON = "/mnt/work/ai/venvs/comfyui-cu132/bin/python"
PACK_NAME = "MAINodesFlowLab"
PORT_START = 8397
# live surfaces on this box; a lab never binds any of them
FORBIDDEN_PORTS = {8188, 8189, 8190, 8191, 8777, 8791, 8801}
# nodes that exist only in OTHER installed packs: seeing one means
# --disable-all-custom-nodes did not take
FOREIGN_SENTINELS = ("VHS_VideoCombine", "GetImageSizeAndCount", "ImageBatchMulti")


def free_port(start: int = PORT_START, limit: int = 60) -> int:
    for port in range(start, start + limit):
        if port in FORBIDDEN_PORTS:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise RuntimeError(f"no free port in [{start}, {start + limit})")


class FlowLab:
    def __init__(self, memory_max: str = "12G", env: dict | None = None):
        self.memory_max = memory_max
        # extra environment for the server process. systemd-run --scope runs
        # the command as its own child, so the scope inherits this too, which
        # is how a lab gets its own MAINODES_FLOW_POLICY without any file
        # being written inside the pack.
        self.env = dict(os.environ, **(env or {}))
        self.port = free_port()
        self.root = tempfile.mkdtemp(prefix="flowlab-")
        self.output = os.path.join(self.root, "output")
        self.proc: subprocess.Popen | None = None
        self.fenced = True
        self.log_path = os.path.join(self.root, "server.log")

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        # teardown is unconditional: a failed assertion mid-run must not
        # leave a server behind, which is exactly how five of them survived
        self.stop()
        return False

    # ---------------------------------------------------------------- setup
    def _layout(self) -> str:
        nodes_dir = os.path.join(self.root, "custom_nodes")
        os.makedirs(nodes_dir, exist_ok=True)
        os.makedirs(self.output, exist_ok=True)
        os.makedirs(os.path.join(self.root, "temp"), exist_ok=True)
        os.makedirs(os.path.join(self.root, "user"), exist_ok=True)
        # the symlink lives in the temp dir, never inside the repo
        os.symlink(REPO, os.path.join(nodes_dir, PACK_NAME))
        paths = os.path.join(self.root, "lab_paths.yaml")
        with open(paths, "w", encoding="utf-8") as fh:
            fh.write(f"lab:\n    custom_nodes: {nodes_dir}\n")
        return paths

    def _command(self, paths: str) -> list[str]:
        return [
            VENV_PYTHON, "main.py", "--cpu", "--listen", "127.0.0.1",
            "--port", str(self.port),
            "--output-directory", self.output,
            "--temp-directory", os.path.join(self.root, "temp"),
            "--user-directory", os.path.join(self.root, "user"),
            "--disable-all-custom-nodes",
            "--whitelist-custom-nodes", PACK_NAME,
            "--extra-model-paths-config", paths,
        ]

    def start(self):
        paths = self._layout()
        command = self._command(paths)
        fence = ["systemd-run", "--user", "--scope", "-q", f"--unit=flowlab-{self.port}",
                 "-p", f"MemoryMax={self.memory_max}", "-p", "MemorySwapMax=0"]
        self.log = open(self.log_path, "w", encoding="utf-8")
        try:
            self.proc = subprocess.Popen(fence + command, cwd=COMFY_ROOT, stdout=self.log,
                                         stderr=subprocess.STDOUT, start_new_session=True,
                                         env=self.env)
            self._wait_ready()
        except Exception as first:
            # the memory fence is preferred, not blocking: fall back only when
            # systemd-run itself refused, never to paper over a server error
            log = self.tail(200)
            if not (isinstance(first, FileNotFoundError) or "systemd-run" in log
                    or "Failed to " in log):
                self.stop()
                raise
            self.fenced = False
            # _terminate, not stop: the sandbox layout must survive the retry
            self._terminate()
            self.log = open(self.log_path, "w", encoding="utf-8")
            self.proc = subprocess.Popen(command, cwd=COMFY_ROOT, stdout=self.log,
                                         stderr=subprocess.STDOUT, start_new_session=True,
                                         env=self.env)
            self._wait_ready()
        return self

    def _wait_ready(self, cap: float = 90.0):
        deadline = time.time() + cap
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"server exited early ({self.proc.returncode}):\n{self.tail()}")
            try:
                self.get("/system_stats")
                return
            except Exception:
                time.sleep(0.5)
        raise RuntimeError(f"server not ready in {cap}s:\n{self.tail()}")

    def tail(self, lines: int = 60) -> str:
        try:
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as fh:
                return "".join(fh.readlines()[-lines:])
        except OSError:
            return "(no server log)"

    # ------------------------------------------------------------------ api
    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def get(self, path: str):
        with urllib.request.urlopen(self.url(path), timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))

    def post(self, path: str, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(self.url(path), data=data,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise AssertionError(f"POST {path} -> {e.code}: "
                                 f"{e.read().decode('utf-8', 'replace')}") from None

    def object_info(self) -> dict:
        return self.get("/object_info")

    def assert_isolated(self):
        info = self.object_info()
        assert "MAIFlowGate" in info, "the lab pack did not load; see the server log"
        module = info["MAIFlowGate"].get("python_module", "")
        assert PACK_NAME in module, f"MAIFlowGate came from {module!r}, not the lab symlink"
        intruders = [n for n in FOREIGN_SENTINELS if n in info]
        assert not intruders, f"other custom node packs loaded: {intruders}"
        return info

    # ---------------------------------------------------------------- runs
    def run(self, prompt: dict, timeout: float = 120.0, expect: str = "success") -> dict:
        response = self.post("/prompt", {"prompt": prompt})
        errors = response.get("node_errors") or {}
        assert not errors and "error" not in response, f"queue refused the prompt: {response}"
        prompt_id = response["prompt_id"]
        deadline = time.time() + timeout
        while time.time() < deadline:
            history = self.get(f"/history/{prompt_id}")
            entry = history.get(prompt_id)
            if entry and entry.get("status", {}).get("completed") is not None:
                status = entry["status"]
                assert status.get("status_str") == expect, \
                    f"run status {status.get('status_str')!r}, expected {expect!r}: " \
                    f"{json.dumps(status, indent=2)[:4000]}\n{self.tail()}"
                return entry
            time.sleep(0.5)
        raise AssertionError(f"prompt {prompt_id} did not finish in {timeout}s:\n{self.tail()}")

    # -------------------------------------------------------------- probes
    def probe_path(self, name: str) -> str:
        return os.path.join(self.output, "flow_probe", f"{name}.count")

    def probe_text(self, name: str) -> str:
        try:
            with open(self.probe_path(name), "r", encoding="utf-8") as fh:
                return fh.read()
        except FileNotFoundError:
            return ""

    def probe_count(self, name: str) -> int:
        return len([x for x in self.probe_text(name).splitlines() if x.strip()])

    def probe_digests(self, name: str) -> list[str]:
        return [line.split("\t")[-1] for line in self.probe_text(name).splitlines() if line.strip()]

    # ------------------------------------------------------------ teardown
    def stop(self):
        """Kill the server AND reap the sandbox root. Idempotent."""
        self._terminate()
        # the temp root holds a symlink into the worktree; leaving it behind
        # is how fourteen /tmp/flowlab-* trees accumulated on this box
        shutil.rmtree(self.root, ignore_errors=True)

    def _terminate(self):
        """Kill the server by pid identity, leaving the sandbox root in place."""
        if self.proc is not None and self.proc.poll() is None:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.proc.wait(timeout=15)
        subprocess.run(["systemctl", "--user", "stop", f"flowlab-{self.port}.scope"],
                       capture_output=True)
        try:
            self.log.close()
        except Exception:
            pass
        self.proc = None

    def survivors(self) -> list[str]:
        """Pids still bound to this port, by pid identity rather than pattern.

        pgrep matches its own command line and any stale shell wrapper, so
        only pids whose argv0 is the venv python count.
        """
        found = subprocess.run(["pgrep", "-f", f"port {self.port}"], capture_output=True, text=True)
        out = []
        for pid in found.stdout.split():
            cmd = subprocess.run(["ps", "-o", "cmd=", "-p", pid],
                                 capture_output=True, text=True).stdout.strip()
            if cmd.startswith(VENV_PYTHON):
                out.append(f"{pid} {cmd}")
        return out
