// The Snap gate's one config: ports, test bases and local folders come from the environment (tests/snap/.env.example,
// run_all.sh sources the file). snaptest_config.py reads the same names; each side carries only the fields its suites
// use. A folder nobody set fails here, by name, before a suite touches anything; ports default to the units in README.md.
const fs = require("fs"), path = require("path");

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: copy tests/snap/.env.example to tests/snap/.env, fill it in, and run through run_all.sh (or source it first)`);
  return v;
};
const C = {
  port: process.env.SNAP_TEST_PORT || "8195",
  freshPort: process.env.SNAP_TEST_FRESH_PORT || "8196",
  gatePort: process.env.SNAP_TEST_GATE_PORT || "8297",
  // the fresh server's systemd --user unit (test_g1_window restarts it)
  freshUnit: process.env.SNAP_TEST_FRESH_UNIT || "snap-fresh-cpu",
  chrome: process.env.SNAP_TEST_CHROME || "/usr/bin/google-chrome",
  python: process.env.SNAP_TEST_PYTHON || "python3",
  // the pack under test: the repo these tests live in, unless the servers load another checkout
  pack: process.env.SNAP_TEST_PACK || path.resolve(__dirname, "..", ".."),
  get base() { return need("SNAP_TEST_BASE"); },
  get gatetestBase() { return need("SNAP_TEST_GATETEST_BASE"); },
  get out() { const d = need("SNAP_TEST_OUT"); for (const s of ["ui", "_debug", "snapbox"]) fs.mkdirSync(path.join(d, s), { recursive: true }); return d; },
  fixture: (...p) => path.join(need("SNAP_TEST_FIXTURES"), ...p),
  critic: (...p) => path.join(need("SNAP_CRITIC_FIXTURES"), ...p),
};
module.exports = C;
