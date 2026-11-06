"""The Snap gate's one config (the Python side of snaptest_config.js, same names): ports, test bases and local folders
come from the environment (tests/snap/.env.example; run_all.sh sources the file). A folder nobody set fails here, by
name, before a suite touches anything; ports default to the CPU units in README.md."""
import os
from pathlib import Path


def need(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"{name} is not set: copy tests/snap/.env.example to tests/snap/.env, fill it in, and run through run_all.sh (or source it first)")
    return v


PORT = os.environ.get("SNAP_TEST_PORT", "8195")
FRESH_PORT = os.environ.get("SNAP_TEST_FRESH_PORT", "8196")
GPU_PORT = os.environ.get("SNAP_TEST_GPU_PORT", "8194")
GATE_PORT = os.environ.get("SNAP_TEST_GATE_PORT", "8297")
GATETEST_PORT = os.environ.get("SNAP_TEST_GATETEST_PORT", "8199")
# systemd --user units of the servers, for the suites that restart one or read its log
UNIT = os.environ.get("SNAP_TEST_UNIT", "snap-test-cpu")
GATETEST_UNIT = os.environ.get("SNAP_TEST_GATETEST_UNIT", "snapbox-gatetest-cpu")
GATE_UNITS = os.environ.get("SNAP_TEST_GATE_UNITS", "snapbox-gatetest-gate snapbox-gatetest-off").split()
PYTHON = os.environ.get("SNAP_TEST_PYTHON", "python3")
NODE_PATH = os.environ.get("SNAP_TEST_NODE_PATH", os.environ.get("NODE_PATH", ""))
# the pack under test: the repo these tests live in, unless the servers load another checkout
PACK = Path(os.environ.get("SNAP_TEST_PACK") or Path(__file__).resolve().parents[2])


def base():
    return Path(need("SNAP_TEST_BASE"))


def gatetest_base():
    return Path(need("SNAP_TEST_GATETEST_BASE"))


def out(*p):
    """A path under the output folder (result json, .out, screenshots), its folder made."""
    f = Path(need("SNAP_TEST_OUT")).joinpath(*p)
    (f if not f.suffix else f.parent).mkdir(parents=True, exist_ok=True)
    return f


def fixture(*p):
    return Path(need("SNAP_TEST_FIXTURES")).joinpath(*p)
