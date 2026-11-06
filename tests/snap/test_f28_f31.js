// U72 F28/F30/F31 (run 7) on the CPU test server: an edit decision's painted frames as pictures an agent can see, the
// spread of take_frames, and argument errors that name what a tool takes. A decision with two ready candidates (their
// pictures are files in output/) is written straight into the candidates store; no GPU.
// - F28: list_candidates gives each candidate's pictures with their path; candidate_frames returns them as pictures
//   (images, the take_frames shape) labelled by candidate and frame, with paths;
// - F31: list_candidates {decision} finds one decision; an unknown argument is refused naming every argument it takes;
// - F30: take_frames with no frames gives 5 spread over the clip (first, quarter, middle, three quarters, last) and says
//   to compare them across the clip before judging motion.
// usage: node test_f28_f31.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
(async () => {
  fs.mkdirSync(path.join(base, "output", "snaptest_f28"), { recursive: true });
  for (const [n, c] of [["c1_f36", "0x993333"], ["c2_f36", "0x333399"]]) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=96x54`, "-frames:v", "1", path.join(base, "output", "snaptest_f28", `${n}.png`)]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=96x54:r=24:d=4", "-pix_fmt", "yuv420p", path.join(base, "output", "snaptest_f28", "clip.mp4")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
    Object.assign(R, await page.evaluate(async () => {
      const X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"), C = await import("/extensions/ComfyUI-MAINodes/snap/candidates.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      await import("/extensions/ComfyUI-MAINodes/snap/edits.js");
      const pic = (n) => ({ label: "frame 36", frame: 36, media: { filename: `${n}_f36.png`, subfolder: "snaptest_f28", type: "output" } });
      const d = await C.create({ kind: "edit", target: "take-f28", title: "Recast · Viggle Remake (Mara → Lio) of take 1", take: "take-f28", method: "remake_swap", options: {}, clip: { frames: 73 } },
        [{ seed: 1, frame: [36], pictures: [pic("c1")] }, { seed: 2, frame: [36], pictures: [pic("c2")] }]);
      const call = (n, a) => X.callTool(n, a).catch((e) => ({ error: e.message }));
      const check = (n, a) => { try { X.checkArgs(n, a); return null; } catch (e) { return e.message; } };
      const listed = await call("list_candidates", { decision: d.id });
      const frames = await call("candidate_frames", { decision: d.id });
      const one = await call("candidate_frames", { decision: d.id, candidate: "c2" });
      // a 4 s take with a video, for take_frames' default spread
      T.all().push({ id: "take-f28clip", number: 1, group: "f28", media: [{ kind: "video", filename: "clip.mp4", subfolder: "snaptest_f28", type: "output" }], notes: [], created: Date.now() });
      const spread = await call("take_frames", { take: "take-f28clip" });
      return { decision: d.id, listed, frames: frames.error ? frames : { ...frames, images: frames.images?.map(({ data, ...x }) => ({ ...x, bytes: data?.length ?? 0 })) },
        one: one.error ? one : { n: one.images?.length, labels: one.images?.map((x) => x.label) }, unknownArg: check("list_candidates", { id: d.id }),
        spread: spread.error ? spread : { frames: spread.frames?.map((x) => x.frame), note: spread.look ?? null } };
    }));
    R.errors = errs;
    const d = R.listed?.[0], c = {
      "F28: list_candidates {decision} gives that decision, each candidate's picture with its path": Array.isArray(R.listed) && R.listed.length === 1 && d?.id === R.decision && d.candidates[0].pictures?.[0]?.path === "output/snaptest_f28/c1_f36.png" && d.candidates[0].pictures[0].label === "frame 36",
      "F28: candidate_frames returns every candidate's pictures, labelled, with paths": R.frames?.images?.length === 2 && R.frames.images.every((x) => x.mimeType === "image/jpeg" && x.bytes > 100) && R.frames.images[0].label === "c1 · frame 36" && R.frames.images[1].path === "output/snaptest_f28/c2_f36.png",
      "F28: candidate_frames with candidate gives only that one": R.one?.n === 1 && R.one.labels[0] === "c2 · frame 36",
      "F31: an unknown argument is refused naming every argument the tool takes": /list_candidates doesn't take id; it takes kind, target, open, decision/.test(R.unknownArg ?? ""),
      "F30: take_frames gives 5 frames spread over the clip by default, and says to compare them before judging motion": JSON.stringify(R.spread?.frames) === JSON.stringify([0, 24, 48, 71, 95]) && /across the clip/.test(R.spread?.note ?? ""),
      "no page errors": !errs.length,
    };
    R.checks = c;
    fs.writeFileSync(path.join(out, "test_f28_f31_result.json"), JSON.stringify(R, null, 1));
    const bad = Object.keys(c).filter((k) => !c[k]);
    console.log(`f28f31   ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  } finally { await b.close(); }
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
