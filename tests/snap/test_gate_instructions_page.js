// The page half of test_gate_instructions.py: the member's stack with the install layer, and the member's own off.
// Prints one JSON line. usage: node test_gate_instructions_page.js [port 8290]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port;
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const { page } = await F.open(b, port);
    const out = await page.evaluate(async () => {
      const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"), X = window.__X;
      await I.load();
      await I.save(null, { scope: "global", text: "Member note: show options side by side." }, { by: "person" });
      const st = I.resolve({ tool: null, bricks: [], methods: [], pins: [], scene: null, shot: null, take: null }).stack;
      const i = st.findIndex((r) => r.ref === "install:gi-admin/gi-shared@1"), row = st[i];
      const between = i > st.findLastIndex((r) => r.layer === "pack") && i < st.findIndex((r) => r.layer === "person");
      await I.setOff("install:gi-admin/gi-shared@1", true);
      const offHidden = !I.resolve({ tool: null, bricks: [], methods: [], pins: [], scene: null, shot: null, take: null }).refs.includes("install:gi-admin/gi-shared@1");
      const listed = (await X.callTool("list_instructions", { layer: "install" })).notes.find((n) => n.ref === "install:gi-admin/gi-shared@1")?.status;
      await I.setOff("install:gi-admin/gi-shared@1", false);
      return { layer: row?.layer, from: row?.from, between, offHidden, listed };
    });
    console.log(JSON.stringify(out));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
