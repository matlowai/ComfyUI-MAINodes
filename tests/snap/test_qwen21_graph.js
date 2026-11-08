// SNAP-R14/R71/R72: native Qwen 2.1 view wiring and first-reference canvas.
// CPU-only: node tests/snap/test_qwen21_graph.js
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const pack = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(pack, "web/snap/edits.js"), "utf8").replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const context = vm.createContext({ C: { kind() {} }, RT: { takeCandidate: {} }, M: { choice: async (_, __, file) => file } });
vm.runInContext(source, context);
const methods = JSON.parse(fs.readFileSync(path.join(pack, "snap_cards/methods.json"), "utf8"));
const entries = Array.isArray(methods) ? methods : methods.methods;
(async () => {
  const method = entries.find((m) => m.id === "qwen21_view");
  assert.equal(method.slot, "view");
  assert.deepEqual(entries.filter((m) => m.slot === "view").map((m) => m.id), ["ph3_view", "fizgig_still", "qwen21_view"]);
  const pics = [1, 2, 3].map((i) => ({ nodes: { [`c${i}`]: { class_type: "LoadImage", inputs: { image: `${i}.png` } } }, out: [`c${i}`, 0] }));
  context.args = [method.anchors, pics, { prompt: "Edit <image1> using <image2> and <image3>." }, 37, null, "snap_views/test"];
  const native = JSON.parse(JSON.stringify(await vm.runInContext("qwen21Graph(...args)", context)));
  assert.equal(native.p.inputs.prompt, context.args[2].prompt);
  assert.equal(native.p.inputs.resolution, 0);
  assert.equal(native.p.inputs.negative_prompt, "");
  for (const [i, pic] of pics.entries()) assert.deepEqual(native.p.inputs[`images.image_${i + 1}`], pic.out);
  assert.equal(native.q, undefined);
  assert.deepEqual(native.k.inputs, { model: ["4", 0], seed: 37, steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["p", 0], negative: ["p", 1], latent_image: ["p", 2], denoise: 1 });
  assert.deepEqual(native[4].inputs, { model: ["1", 0], device: "auto", dtype: "default" });
  assert.equal(native[2].inputs.type, "qwen_image");
  assert.equal(native[2].inputs.clip_name, method.anchors.clip);
  assert.equal(Object.values(native).some((n) => /Shift|ModelSampling|Empty.*Latent/.test(n.class_type)), false);
  context.args[4] = { width: 1920, height: 1088 };
  const sized = JSON.parse(JSON.stringify(await vm.runInContext("qwen21Graph(...args)", context)));
  assert.deepEqual(sized.q.inputs, { image: pics[0].out, upscale_method: "lanczos", width: 1920, height: 1088, crop: "disabled" });
  assert.deepEqual(sized.p.inputs["images.image_1"], ["q", 0]);
  assert.deepEqual(sized.p.inputs["images.image_2"], pics[1].out);
  assert.deepEqual(sized.k.inputs.latent_image, ["p", 2]);
  console.log("qwen21_graph PASS (native canvas, requested canvas, ordered refs, exact native sampling, unchanged prompt)");
})().catch((e) => { console.error(e); process.exitCode = 1; });
