// Node Shelf (web/node_shelf.js) in a real ComfyUI page: the rule, the dialog, what ComfyUI offers afterwards, the
// keyboard and the names assistive technology reads. It WRITES the NodeShelf.Hidden setting, so run it against a
// throwaway server (its own --base-directory), never a person's:
//   NODE_PATH=<playwright's node_modules> node tests/web/test_node_shelf.js <port> [screenshot folder]
const { chromium } = require("playwright");
const port = process.argv[2], shots = process.argv[3];
if (!port) { console.error("usage: node test_node_shelf.js <port of a throwaway ComfyUI> [screenshot folder]"); process.exit(2); }
// NS_EXT: the folder the file is served from; NS_PACK / NS_NODE / NS_QUERY: the pack to hide, one of its nodes, words that find it
const EXT = process.env.NS_EXT || "ComfyUI-MAINodes", PACK = process.env.NS_PACK || "ComfyUI-MAINodes", NODE = process.env.NS_NODE || "MAIDialRack", QUERY = process.env.NS_QUERY || "Dial Rack";
(async () => {
  const b = await chromium.launch({ executablePath: process.env.SNAP_TEST_CHROME || "/usr/bin/google-chrome", headless: true });
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [], R = {};
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const load = async () => { await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow && window.NodeShelf, null, { timeout: 90000 }); await page.waitForTimeout(2500); await page.keyboard.press("Escape"); };
  const offered = () => page.evaluate(async ([pack, node, ext, query]) => { const m = await import(`/extensions/${ext}/node_shelf.js`), s = app.extensionManager._p._s.get("nodeDef"); const mine = (d) => m.packOf(d) === pack;
    return { visible: s.visibleNodeDefs.filter(mine).length, all: s.nodeDefs.filter(mine).length, search: s.nodeSearchService.searchNode(query).some((d) => d.name === node), tree: JSON.stringify(s.nodeTree).includes(`"name":"${node}"`), title: m.packTitle(pack),
      menu: LiteGraph.getNodeTypesInCategory(LiteGraph.registered_node_types[node].category).some((t) => t.type === node), snap: window.NodeShelf.hidden(node), registered: !!LiteGraph.registered_node_types[node], setting: app.extensionManager.setting.get("NodeShelf.Hidden"),
      copies: [app.extensions.filter((e) => e.name === "NodeShelf").length, s.nodeDefFilters.filter((f) => f.id === "nodeshelf.hidden").length] }; }, [PACK, NODE, EXT, QUERY]);
  const status = () => page.textContent("dialog.mns [role=status]");
  const openIt = () => page.evaluate(() => app.extensionManager.command.execute("NodeShelf.Open"));
  await load();
  await page.evaluate(() => app.extensionManager.setting.set("NodeShelf.Hidden", {})); await load();
  R.rule = await page.evaluate(async (ext) => { const m = await import(`/extensions/${ext}/node_shelf.js`), names = ["a", "b", "c"]; let r = {};
    const out = { supported: m.supported(), fresh: m.hiddenBy(r, "p", "a") };
    r = m.flipNode(r, "p", "a", names); out.one = [m.hiddenBy(r, "p", "a"), m.hiddenBy(r, "p", "b"), m.hiddenBy(r, "p", "new"), JSON.stringify(r)];
    r = m.flipNode(m.flipNode(r, "p", "b", names), "p", "c", names); out.all = [JSON.stringify(r), m.hiddenBy(r, "p", "new")];
    r = m.flipNode(r, "p", "b", names); out.back = [m.hiddenBy(r, "p", "b"), m.hiddenBy(r, "p", "a"), JSON.stringify(r)];
    out.cleared = JSON.stringify(m.flipNode(m.flipNode({}, "p", "a", names), "p", "a", names));
    out.packs = [m.packOf({ python_module: "custom_nodes.X.sub" }), m.packOf({ python_module: "nodes" }), m.packOf({ python_module: "comfy_extras.nodes_x" }), m.packOf({ python_module: "comfy_api_nodes.y" }), m.packOf({ python_module: "blueprint" }), m.packOf({})];
    return out; }, EXT);
  R.before = await offered();
  await page.evaluate(() => document.body.focus()); await openIt(); await page.waitForSelector("dialog.mns[open]");
  R.dialog = await page.evaluate(() => { const d = document.querySelector("dialog.mns"); return { modal: d.matches(":modal"), labelled: document.getElementById(d.getAttribute("aria-labelledby"))?.textContent, described: !!document.getElementById(d.getAttribute("aria-describedby")), focus: document.activeElement?.getAttribute("aria-label"), status: d.querySelector("[role=status]").textContent, reset: d.querySelector(".mns-sum button").disabled, groups: [...d.querySelectorAll("h3")].map((x) => x.textContent) }; });
  const names = () => page.evaluate(() => [...document.querySelectorAll("dialog.mns input, dialog.mns button, dialog.mns select")].filter((e) => !(e.getAttribute("aria-label") || e.labels?.[0]?.textContent.trim() || e.textContent.trim())).length);
  R.unnamed = await names();
  if (shots) await page.screenshot({ path: `${shots}/ns_1_open.png` });
  await page.check(`#mns-p-${PACK}`.replace(/[^\w#-]/g, "_"), { force: true }).catch(() => {});
  const packBox = `[data-key="mns-p-${PACK}"]`;
  await page.focus(packBox); await page.keyboard.press("Space"); await page.waitForTimeout(400); // the keyboard, not the mouse
  R.hidPack = { ...(await offered()), status: await status(), focusKept: await page.evaluate((s) => document.activeElement === document.querySelector(s), packBox), count: await page.textContent(`#mns-p-${PACK}-count`), reset: await page.evaluate(() => document.querySelector(".mns-sum button").disabled) };
  await page.focus(`[data-key="mns-p-${PACK}-tw"]`); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  R.expanded = await page.evaluate((pack) => { const tw = document.querySelector(`[data-key="mns-p-${pack}-tw"]`), list = document.getElementById(tw.getAttribute("aria-controls")); return { aria: tw.getAttribute("aria-expanded"), rows: list?.querySelectorAll(".mns-node").length, note: list?.querySelector(".mns-note")?.textContent, focusKept: document.activeElement === tw }; }, PACK);
  await page.focus(`[data-key="mns-n-${PACK}-${NODE}"]`); await page.keyboard.press("Space"); await page.waitForTimeout(400);
  R.oneBack = { ...(await offered()), status: await status(), mixed: await page.evaluate((s) => document.querySelector(s).indeterminate, packBox), count: await page.textContent(`#mns-p-${PACK}-count`) };
  if (shots) await page.screenshot({ path: `${shots}/ns_2_pack_hidden_one_shown.png` });
  await page.fill("dialog.mns input[type=search]", "ksampler"); await page.waitForTimeout(300);
  R.search = await page.evaluate(() => ({ packs: [...document.querySelectorAll(".mns-pack b")].map((x) => x.textContent), rows: document.querySelectorAll(".mns-node").length, allMatch: [...document.querySelectorAll(".mns-node")].every((x) => /ksampler/i.test(x.textContent)) }));
  await page.fill("dialog.mns input[type=search]", "zzzz-nothing"); await page.waitForTimeout(200); R.none = await page.textContent(".mns-empty");
  await page.fill("dialog.mns input[type=search]", ""); await page.check('dialog.mns input[name=show][value=hidden]', { force: true }); await page.waitForTimeout(300);
  R.onlyHidden = await page.evaluate(() => [...document.querySelectorAll(".mns-pack b")].map((x) => x.textContent));
  if (shots) await page.screenshot({ path: `${shots}/ns_3_hidden_filter.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  R.closed = await page.evaluate(() => ({ gone: !document.querySelector("dialog.mns") }));
  await load(); R.afterReload = await offered();
  await openIt(); await page.waitForSelector("dialog.mns[open]"); R.reopened = await status();
  await page.click(".mns-sum button"); await page.waitForTimeout(400);
  R.reset = { ...(await offered()), status: await status() };
  await page.keyboard.press("Escape");
  const c = {
    "the filter list is there on this ComfyUI": R.rule.supported === true,
    "rule: nothing is hidden with no rules": R.rule.fresh === false,
    "rule: hiding one node hides it, not its siblings, and a later node shows": R.rule.one[0] === true && R.rule.one[1] === false && R.rule.one[2] === false,
    "rule: hiding every node turns into a hidden pack, so a later node is hidden": R.rule.all[0] === '{"p":{"hidden":true,"except":[]}}' && R.rule.all[1] === true,
    "rule: one node back in a hidden pack is an exception": R.rule.back[0] === false && R.rule.back[1] === true,
    "rule: a flip and its undo leave no rule": R.rule.cleared === "{}",
    "packs: custom pack by folder, core and extras together, API, blueprints, interface": JSON.stringify(R.rule.packs) === '["X","core","core","api","blueprint","frontend"]',
    "before: the pack's nodes are offered (all but any ComfyUI's own filters hide)": R.before.visible > 20 && R.before.visible / R.before.all > 0.9 && R.before.search && R.before.menu && !R.before.snap,
    "the dialog is modal, named and described, and focus starts in the search box": R.dialog.modal && R.dialog.labelled === "Node Shelf" && R.dialog.described && R.dialog.focus === "Search packs and nodes",
    "it opens saying everything is shown, with Show everything disabled": /^All [\d,]+ nodes from \d+ packs are shown\.$/.test(R.dialog.status) && R.dialog.reset === true,
    "installed packs and ComfyUI's own nodes are separate groups": R.dialog.groups.length === 2 && /Node packs you installed/.test(R.dialog.groups[0]) && /ComfyUI itself/.test(R.dialog.groups[1]),
    "every control has a name": R.unnamed === 0,
    "Space on a pack hides all of it: search, library tree, Add Node menu and Snap": R.hidPack.visible === 0 && !R.hidPack.search && !R.hidPack.tree && !R.hidPack.menu && R.hidPack.snap === true,
    "the nodes stay registered (workflows still load)": R.hidPack.registered === true,
    "the change is announced with the new total, and focus stays on the box": /is hidden: \d+ nodes\. [\d,]+ of [\d,]+ nodes hidden, in 1 pack\.$/.test(R.hidPack.status) && R.hidPack.focusKept && /^all \d+ hidden$/.test(R.hidPack.count) && R.hidPack.reset === false,
    "Enter on the arrow expands the pack, says so, and explains later nodes": R.expanded.aria === "true" && R.expanded.rows === R.before.visible && /adds later will be hidden too/.test(R.expanded.note) && R.expanded.focusKept,
    "one node ticked in a hidden pack shows again; the pack box is mixed": R.oneBack.visible === 1 && R.oneBack.search && R.oneBack.menu && !R.oneBack.snap && R.oneBack.mixed === true && /^1 of \d+ shown$/.test(R.oneBack.count),
    "search lists only matching nodes, under their packs": R.search.rows > 0 && R.search.allMatch && R.search.packs.length >= 1,
    "a search with no match says so": /Nothing matches "zzzz-nothing"/.test(R.none),
    "Show: Hidden lists only packs with something hidden": R.onlyHidden.length === 1 && R.onlyHidden[0] === R.before.title,
    "Escape closes it": R.closed.gone,
    "after a reload the choice is still applied": R.afterReload.visible === 1 && R.afterReload.search && R.afterReload.snap === false && R.afterReload.setting?.[PACK]?.hidden === true,
    "Show everything puts all of it back and clears the setting": R.reset.visible === R.before.visible && JSON.stringify(R.reset.setting) === "{}" && /^Every node is shown again\./.test(R.reset.status),
    "one copy runs, however many are installed: one extension, one filter": R.hidPack.copies[0] === 1 && R.hidPack.copies[1] === 1 && R.reset.copies[1] === 0,
    "no page errors": errors.length === 0,
  };
  let bad = 0; for (const [k, v] of Object.entries(c)) { console.log(`${v ? "PASS" : "FAIL"}   ${k}`); if (!v) bad++; }
  if (bad) console.log(JSON.stringify({ R, errors }, null, 1));
  console.log(`\n${Object.keys(c).length - bad}/${Object.keys(c).length} ${bad ? "FAIL" : "PASS"}`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
